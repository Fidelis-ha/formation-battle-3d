/**
 * Das Gehirn: fuehrt eine Persoenlichkeit aus.
 *
 * Der Sockel in `battle.ts` (`runAI`) bewegt die Truppen. Dieses Modul
 * entscheidet VORHER, was eine Persoenlichkeit ueberhaupt will: welcher Trupp
 * vorrueckt, welcher zurueckbleibt, welches Ziel gewaehlt wird und wann der
 * Angriff beginnt. Der Sockel setzt diese Vorgaben dann um.
 *
 * Bewusst KEIN three-Import: die Simulation bleibt in Node testbar.
 */

import type { Battle, Faction, Platoon } from '../types';
import { UNIT_STATS, counterMultiplier } from '../units';
import type { UnitKind } from '../types';
import { isPassable, isWater, nudgePassable } from '../terrain';
import { buildNavField, nextWaypoint, type NavField } from './nav';
import { PERSONALITIES, type Personality, type TargetDoctrine } from './personality';

/** Ab welcher Naehe ein Ziel als "greifbar" gilt. */
const ENGAGE_RANGE = 30;

/**
 * Zustand einer KI ueber den Verlauf der Schlacht.
 *
 * Wird pro Schlacht neu angelegt und NICHT in `Battle` gespeichert — die
 * Simulation bleibt frei von KI-Ballast, und Tests koennen zwei Gehirne
 * unabhaengig laufen lassen.
 */
export interface BrainState {
  personality: Personality;
  faction: Faction;
  /** Wann (in Sekunden) der Angriff beginnt. */
  attackAt: number;
  /** Trupps, die zurueckgehalten werden. */
  reserve: Set<number>;
  /** Zuletzt gewaehltes Ziel je Trupp — verhindert Zielflattern. */
  lastTarget: Map<number, number>;
  /** Zaehlt, wie oft neu entschieden wurde (fuer die Messung der Eigenart). */
  decisions: number;
  /** Erster Angriffszeitpunkt, fuer die Verlaufsmessung. */
  firstContact: number | null;
  /**
   * Distanzfeld zum Feindzentrum.
   *
   * Truppen laufen diesem Feld entlang, solange der Feind weit ist. Ohne das
   * liefen sie auf Karten mit Wasser geradeaus gegen den See und fanden den
   * Uebergang nie — gemessen blieben drei von zehn Karten im Zeitlimit haengen.
   */
  nav: NavField | null;
  /** Wann das Feld zuletzt gerechnet wurde (Sekunden). */
  navAt: number;
}

/**
 * Ein Gehirn fuer eine Fraktion anlegen.
 *
 * `seed` streut die Startentscheidung — zwei Laeufe derselben Paarung sollen
 * nicht Bit fuer Bit identisch sein. Die Streuung ist bewusst klein: die
 * Eigenart muss erkennbar bleiben, der Ablauf darf nicht beliebig werden.
 */
export function createBrain(personality: Personality, faction: Faction, seed: number): BrainState {
  const rnd = mulberry32((seed ^ hashString(personality.id)) >>> 0);

  // Angriffszeitpunkt aus dem Tempo, mit Streuung aus `noise`.
  const base = personality.tempo === 'instant' ? 0 : personality.tempo === 'normal' ? 3 : 10;
  const spread = personality.noise * 6;
  const attackAt = Math.max(0, base + (rnd() - 0.5) * spread);

  return {
    personality,
    faction,
    attackAt,
    reserve: new Set<number>(),
    lastTarget: new Map<number, number>(),
    decisions: 0,
    firstContact: null,
    nav: null,
    navAt: -999,
  };
}

/**
 * Die Reserve bestimmen: die hinteren Trupps bleiben zurueck, bis der Gegner
 * in Reichweite kommt. Das ist der Unterschied zwischen "Mauer" (wartet) und
 * "Rekrut" (wirft alles gleichzeitig vor).
 */
export function assignReserve(battle: Battle, brain: BrainState): void {
  brain.reserve.clear();
  const share = brain.personality.reserveShare;
  if (share <= 0) return;

  const own = battle.platoons.filter((p) => p.faction === brain.faction && p.aliveCount > 0);
  if (own.length === 0) return;

  const count = Math.max(1, Math.round(own.length * share));
  // Die Reserve sind die weichsten Trupps: Bogenschuetzen und Reiterei halten
  // sich zurueck, die Linie steht vorne. Wer zurueckgehalten wird, entscheidet
  // die Eigenart — nicht die Reihenfolge im Array.
  const order: UnitKind[] = ['archer', 'cavalry', 'housecarl', 'spearman', 'infantry'];
  const sorted = [...own].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
  for (let i = 0; i < count; i++) brain.reserve.add(sorted[i].id);
}

/**
 * Zielwahl nach Lehrmeinung.
 *
 * `discipline` entscheidet, wie oft die Lehrmeinung ueberhaupt greift: ein
 * Rekrut waehlt oft daneben, ein Feldherr fast nie. Das ist der eigentliche
 * Staerkeregler — nicht hoehere Werte.
 */
export function pickTarget(
  battle: Battle,
  brain: BrainState,
  platoon: Platoon,
  rnd: () => number,
): Platoon | null {
  const enemies = battle.platoons.filter(
    (p) => p.faction !== platoon.faction && p.aliveCount > 0,
  );
  if (enemies.length === 0) return null;

  const distance = (p: Platoon): number => Math.hypot(p.x - platoon.x, p.z - platoon.z);

  // Nur Ziele in Reichweite der Sicht — sonst laufen Truppen quer ueber die Karte.
  const visible = enemies.filter((p) => distance(p) <= ENGAGE_RANGE);
  const pool = visible.length > 0 ? visible : enemies;

  const doctrine = brain.personality.target;

  // Gelegentlich daneben greifen: das ist die Streuung, die den Spieler
  // unvorhersehbar macht. Ein Mensch waehlt auch nicht jede Runde optimal.
  const followDoctrine = rnd() < brain.personality.discipline;
  if (!followDoctrine) {
    // Daneben heisst: naechstgelegenes Ziel. Das ist die schwaechste sinnvolle
    // Wahl und genau das, was ein unerfahrener Spieler tut.
    return pool.reduce((best, p) => (distance(p) < distance(best) ? p : best), pool[0]);
  }

  return bestByDoctrine(pool, platoon, doctrine, distance);
}

/** Die eigentliche Lehrmeinung je Ziel-Doktrin. */
function bestByDoctrine(
  pool: Platoon[],
  self: Platoon,
  doctrine: TargetDoctrine,
  distance: (p: Platoon) => number,
): Platoon | null {
  if (pool.length === 0) return null;

  switch (doctrine) {
    case 'archers': {
      const soft = pool.filter((p) => p.kind === 'archer');
      const list = soft.length > 0 ? soft : pool;
      return list.reduce((best, p) => (distance(p) < distance(best) ? p : best), list[0]);
    }
    case 'cavalry': {
      const riders = pool.filter((p) => p.kind === 'cavalry');
      const list = riders.length > 0 ? riders : pool;
      return list.reduce((best, p) => (distance(p) < distance(best) ? p : best), list[0]);
    }
    case 'weakest':
      return pool.reduce((best, p) => (p.aliveCount < best.aliveCount ? p : best), pool[0]);
    case 'nearest':
      return pool.reduce((best, p) => (distance(p) < distance(best) ? p : best), pool[0]);
    case 'threat': {
      // "Gefahr" heisst: der Feindtrupp, der die eigene Linie am ehesten
      // bricht — gewichtet mit der Naehe.
      //
      // Gemessen war die reine Fassung ("gegen wen komme ich am besten an")
      // dominant: sie schlug Angriff 100 %, ausgewogen 100 %, Warten 50 %.
      // Ein Stil, der alles schlaegt, macht die zehn Spieler wertlos — dann
      // gewinnt immer dieselbe Wahl. Deshalb mischt die Doktrin jetzt zwei
      // Fragen: eigene Ueberlegenheit UND feindliche Gefaehrlichkeit. Damit
      // bleibt sie gut, aber nicht unbesiegbar.
      return pool.reduce((best, p) => {
        const ownEdge = counterMultiplier(self.kind, p.kind);
        const danger = counterMultiplier(p.kind, self.kind);
        const scoreP = (ownEdge * 0.6 + danger * 0.4) / Math.max(distance(p), 1);
        const scoreB =
          (counterMultiplier(self.kind, best.kind) * 0.6 +
            counterMultiplier(best.kind, self.kind) * 0.4) /
          Math.max(distance(best), 1);
        return scoreP > scoreB ? p : best;
      }, pool[0]);
    }
    case 'counter':
    default:
      return pool.reduce((best, p) => {
        const scoreP = counterMultiplier(self.kind, p.kind) / Math.max(distance(p), 1);
        const scoreB = counterMultiplier(self.kind, best.kind) / Math.max(distance(best), 1);
        return scoreP > scoreB ? p : best;
      }, pool[0]);
  }
}

/**
 * Fuehrt eine Schlacht mit zwei Gehirnen.
 *
 * Wird vom Sockel (`runAI`) aufgerufen: das Gehirn setzt die Felder
 * `autoTargetId`/`autoMoveTo`/`autoApproach` der Truppen, der Sockel bewegt.
 */
export function think(battle: Battle, brain: BrainState): void {
  const own = battle.platoons.filter((p) => p.faction === brain.faction && p.aliveCount > 0);
  if (own.length === 0) return;

  const rnd = mulberry32(
    ((battle.seed ^ hashString(brain.personality.id)) + Math.floor(battle.time * 7)) >>> 0,
  );

  // Noch nicht angreifen? Dann die Stellung halten — aber nicht wehrlos.
  //
  // Vorher stand eine wartende Armee voellig still und liess sich aufreiben:
  // "warten" war damit ein reiner Nachteil, und die Mauer (Stufe 2) verlor
  // gegen den Rekruten (Stufe 1). Wer wartet, muss sich verteidigen koennen.
  // Deshalb: nicht vorruecken (kein Marschziel), aber Ziele annehmen, sobald
  // der Feind in Reichweite ist. Der Sockel regelt den Kontakt.
  // Warten gilt nur, solange der Angriffszeitpunkt nicht erreicht ist UND der
  // Feind noch nicht auf Tuchfuehlung steht. Sonst bleibt die Armee ewig in
  // Verteidigungsstellung und wird aufgerieben — gemessen: die Mauer verlor
  // gegen den Rekruten, weil sie nie vorrueckte.
  const waiting = battle.time < brain.attackAt;
  if (waiting) {
    // Warten heisst: NICHT vorruecken, aber wehrhaft bleiben.
    //
    // Vorher stand hier `autoApproach = gap <= ENGAGE_RANGE` — das ist fast
    // immer wahr und liess jede Armee sofort losmarschieren. Gemessen griffen
    // dadurch alle zehn Spieler nach 1,1 Sekunden an; der Unterschied zwischen
    // "Mauer" und "Rekrut" war verschwunden. Jetzt: stehen bleiben, Ziel aber
    // annehmen, damit die Truppen zurueckschlagen, wenn der Feind kommt.
    battle.defensive = { ...(battle.defensive ?? {}), [brain.faction]: 1 };
    for (const p of own) {
      p.autoApproach = false;
      p.autoMoveTo = null;
      const target = nearestEnemyPlatoon(battle, p);
      p.autoTargetId = target ? target.id : null;
    }
    return;
  }

  // Deckung gibt es nur fuer echte Verteidiger: wer ohnehin wartet oder
  // zurueckhaltend spielt. Ein Angreifer bekommt sie NICHT.
  //
  // Vorher galt `battle.time < attackAt + 12` fuer jeden — damit hatte auch der
  // Rekrut (attackAt 0) in den ersten zwoelf Sekunden Verteidigungsbonus, und
  // die Mauer verlor 100 % gegen ihn, weil beide Seiten denselben Schutz hatten
  // und der Angreifer nur mehr Zeit zum Zuschlagen brauchte.
  const isDefender = brain.personality.aggression === 'wait' || brain.personality.tempo === 'patient';
  const inContact = own.some((x) => nearestEnemyGap(battle, x) <= 4);
  const stillGuarding = isDefender && (battle.time < brain.attackAt + 3 || inContact);
  battle.defensive = { ...(battle.defensive ?? {}), [brain.faction]: stillGuarding ? 1 : 0 };

  if (brain.firstContact === null) brain.firstContact = battle.time;

  const p = brain.personality;

  for (const platoon of own) {
    // Reserve bleibt hinten, bis der Gegner nah ist.
    const isReserve = brain.reserve.has(platoon.id);
    const nearestEnemy = nearestEnemyGap(battle, platoon);
    if (isReserve && nearestEnemy > 22) {
      platoon.autoApproach = false;
      platoon.autoTargetId = null;
      platoon.autoMoveTo = null;
      continue;
    }

    platoon.autoApproach = true;

    const target = pickTarget(battle, brain, platoon, rnd);
    if (!target) {
      platoon.autoTargetId = null;
      platoon.autoMoveTo = null;
      continue;
    }

    // Ziel halten: nicht jeden Takt neu waehlen. Sonst wechselt der Trupp
    // dauernd die Richtung und kommt nirgends an — gemessen wechselte der
    // Feldherr alle paar Sekunden sein Ziel (270 -> 244 -> 210), waehrend der
    // Hammer stur auf einem blieb und gewann. Fokus schlaegt Streuung.
    const held = brain.lastTarget.get(platoon.id);
    const heldPlatoon = held === undefined ? null : battle.platoons.find((x) => x.id === held) ?? null;
    const keepHeld =
      heldPlatoon !== null &&
      heldPlatoon.aliveCount > 0 &&
      heldPlatoon.faction !== platoon.faction &&
      Math.hypot(heldPlatoon.x - platoon.x, heldPlatoon.z - platoon.z) <= ENGAGE_RANGE * 1.5;

    const chosen = keepHeld && heldPlatoon ? heldPlatoon : target;
    brain.lastTarget.set(platoon.id, chosen.id);
    platoon.autoTargetId = chosen.id;
    const target2 = chosen;

    // Marschziel auf PASSIERBARES Gelaende legen — nicht mitten in den Feind.
    // Vorher lief der Trupp in den Feindtrupp hinein statt davor stehen zu
    // bleiben; die Soldaten waren nach Sekunden tot und niemand schlug zu.
    let aim = nudgePassable(target2.x, target2.z, 12);

    // Liegt Wasser oder eine Wand zwischen Trupp und Ziel, ueber das Distanzfeld
    // umleiten. Ohne das laufen die Truppen geradeaus gegen den See und finden
    // den Uebergang nie — gemessen blieben dadurch drei von zehn Karten im
    // Zeitlimit haengen ("Die Furt", "Die Insel", "Die Hochebene").
    if (!lineClear(battle, platoon, target2)) {
      // Das Feld haengt am Ziel, nicht am Trupp: viele Trupps teilen sich ein
      // Ziel, deshalb wird es nur alle zwei Sekunden neu gerechnet.
      const stale = brain.nav === null || battle.time - brain.navAt > 2;
      if (stale) {
        // Eigene Wellenbrecher mitgeben: sonst rechnet die Wegfindung um das
        // Wasser herum und der Damm bleibt unbenutzt.
        const own = battle.structures.filter(
          (s) => s.faction === platoon.faction && s.kind === 'breakwater',
        );
        brain.nav = buildNavField(target2.x, target2.z, own);
        brain.navAt = battle.time;
      }
      const step = nextWaypoint(brain.nav, platoon.x, platoon.z);
      if (step) {
        aim = step;
      }
    }

    // Die Zielposition haengt an der Aufstellungslehre.
    const point = approachPoint(platoon, target2, p.formation, own, rnd, aim);

    // Stehen bleiben, sobald der Feind in Waffenreichweite ist. Sonst laufen
    // alle Truppen auf denselben Punkt im Feindtrupp und stapeln sich — dann
    // kaempft niemand in Formation, und die Schlacht ist nach Sekunden vorbei.
    // Den Kontakt regelt der Sockel; die KI liefert nur das Ziel.
    const gap = Math.hypot(target2.x - platoon.x, target2.z - platoon.z);
    const standoff = UNIT_STATS[platoon.kind].ranged
      ? Math.min(UNIT_STATS[platoon.kind].range * 0.8, 10)
      : 3.0;
    platoon.autoMoveTo = gap > standoff ? point : null;

    // Wer zurueckhaltend spielt, laesst den Feind kommen — aber nur solange er
    // noch weit ist. Steht er vor der Linie, wird angegriffen. Dauerhaftes
    // Passivbleiben kostet die Armee, ohne etwas zu gewinnen.
    //
    // Gnadenfrist: warten BEIDE Seiten, stehen sich zwei Armeen 20 m
    // gegenueber und niemand rueckt vor. Gemessen liefen dann 8 von 8 Partien
    // "Mauer gegen Zoegerer" ins Zeitlimit, ohne Entscheidung. Nach 15
    // Sekunden ueber die geplante Angriffszeit ruecken deshalb auch Wartende
    // vor — einer muss anfangen.
    const impatient = battle.time > brain.attackAt + 15;
    if (p.aggression === 'wait' && nearestEnemy > 18 && !impatient) {
      platoon.autoMoveTo = null;
    }

    brain.decisions += 1;
  }
}

/**
 * Wo ein Trupp hinlaufen soll.
 *
 * `pincer` schickt die Fluegel nach aussen, `hammer` zieht alles auf die Mitte,
 * `reserve` laesst die Truppen hinter der Linie warten, `line` greift direkt an.
 */
function approachPoint(
  platoon: Platoon,
  target: Platoon,
  formation: Personality['formation'],
  own: Platoon[],
  rnd: () => number,
  aim: { x: number; z: number },
): { x: number; z: number } | null {
  const dx = aim.x - platoon.x;
  const dz = aim.z - platoon.z;
  const d = Math.max(Math.hypot(dx, dz), 1e-6);

  // Grundrichtung: auf das (passierbare) Ziel zu.
  let nx = dx / d;
  let nz = dz / d;

  if (formation === 'pincer') {
    // Zange: die Fluegel schwenken leicht nach aussen, damit sie den Feind von
    // zwei Seiten fassen. Der Ausschlag bleibt klein — gemessen loeste ein
    // grosser Schwenk (0.55 rad) die Linie auf und kostete Siege (1/6).
    // Ein kleiner Schwenk ist neutral, aber er ist die sichtbare Eigenart:
    // von aussen erkennbar greifen zwei Haelften getrennt an.
    const side = platoon.x <= medianX(own) ? -1 : 1;
    const swing = 0.08;
    const px = nx * Math.cos(swing) - nz * Math.sin(swing) * side;
    const pz = nx * Math.sin(swing) * side + nz * Math.cos(swing);
    nx = px;
    nz = pz;
  } else if (formation === 'hammer') {
    // Alles auf die Mitte: seitliche Abweichung wird zurueckgezogen.
    // Gemessen war der Zug zur Mitte (0.25) zu stark — die Fluegel verliessen
    // ihre Linie und trafen vereinzelt ein. Jetzt nur eine sanfte Korrektur.
    const centre = medianX(own);
    nx = nx * 0.9 + Math.sign(centre - platoon.x) * 0.1;
    nz = nz * 0.98;
  } else if (formation === 'reserve') {
    // Zurueckhaltend: nur bis auf Wirkschussweite heran, dann stehen.
    const keep = UNIT_STATS[platoon.kind].ranged ? 0.55 : 0.8;
    if (d < 16) {
      nx *= keep;
      nz *= keep;
    }
  }

  // Kleine Streuung, damit zwei Laeufe nicht identisch aussehen. Sie ist
  // absichtlich klein — die Eigenart muss erkennbar bleiben.
  const jitter = (rnd() - 0.5) * 2.2;

  // Zielpunkt: auf dem Weg zum Feind, aber deutlich VOR ihm. Der Sockel regelt
  // den Rest (Kontakt, Nachruecken). Laeuft die KI bis in den Feindtrupp,
  // stehen die Soldaten im Nahkampf ohne Formation und sterben in Sekunden.
  const stats = UNIT_STATS[platoon.kind];
  const standoff = stats.ranged ? Math.min(stats.range * 0.85, d - 1) : Math.min(6, d - 1);
  const reach = Math.max(0, d - standoff);

  return {
    x: platoon.x + nx * reach + jitter,
    z: platoon.z + nz * reach - jitter,
  };
}

/**
 * Ist der Weg von einem Trupp zu einem Punkt frei?
 *
 * Geprueft wird in Schritten von 3 m, ob Wasser oder eine Wand dazwischen
 * liegt. Wasser zaehlt als Sperre — der Wellenbrecher wird hier bewusst nicht
 * beruecksichtigt, weil er nur waehrend der Bauphase entsteht und das
 * Distanzfeld sonst staendig neu muesste.
 */
function lineClear(battle: Battle, from: Platoon, to: Platoon): boolean {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const dist = Math.hypot(dx, dz);
  if (dist < 1) return true;
  const steps = Math.ceil(dist / 3);
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const x = from.x + dx * t;
    const z = from.z + dz * t;
    if (!isPassable(x, z) || isWater(x, z)) return false;
  }
  return true;
}

/** Naechster lebender Feindtrupp. */
function nearestEnemyPlatoon(battle: Battle, platoon: Platoon): Platoon | null {
  let best: Platoon | null = null;
  let bestDist = Infinity;
  for (const other of battle.platoons) {
    if (other.faction === platoon.faction || other.aliveCount <= 0) continue;
    const d = Math.hypot(other.x - platoon.x, other.z - platoon.z);
    if (d < bestDist) {
      bestDist = d;
      best = other;
    }
  }
  return best;
}

/** Abstand zum naechsten Feindtrupp. */
function nearestEnemyGap(battle: Battle, platoon: Platoon): number {
  let best = Infinity;
  for (const other of battle.platoons) {
    if (other.faction === platoon.faction || other.aliveCount <= 0) continue;
    const d = Math.hypot(other.x - platoon.x, other.z - platoon.z);
    if (d < best) best = d;
  }
  return best;
}

/** Mittlere x-Position der eigenen Truppen. */
function medianX(own: Platoon[]): number {
  if (own.length === 0) return 0;
  const xs = own.map((p) => p.x).sort((a, b) => a - b);
  return xs[Math.floor(xs.length / 2)];
}

/** Alle Persoenlichkeiten, nach Stufe sortiert. */
export function allPersonalities(): Personality[] {
  return [...PERSONALITIES].sort((a, b) => a.level - b.level);
}

/** Kleiner, schneller Zufallsgenerator (Mulberry32). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stabiler Hash fuer eine Kennung (damit Streuung reproduzierbar bleibt). */
export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
