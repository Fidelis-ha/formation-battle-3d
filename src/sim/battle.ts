import { formationSlots, formationWidth, FORMATION_SPACING } from './formation';
import type {
  Battle,
  BattleEvent,
  Faction,
  Platoon,
  Projectile,
  Soldier,
  UnitKind,
} from './types';
import { counterMultiplier, UNIT_STATS } from './units';
import { heightAt, isForest, isPassable, isWater, slopeAt, nudgePassable } from './terrain';
import {
  BUILD_PHASE_SECONDS,
  START_RESOURCES,
  STRUCTURE_SPECS,
  blockedByStructure,
  enemyBuildPlan,
  placementError,
  towerRangeBonus,
  type StructureKind as BuildKind,
} from './build';

const WORLD_HALF = 60;
const MELEE_RANGE = 1.6;
const SIGHT = 24;
const AI_INTERVAL = 0.5;
const PROJECTILE_FLIGHT = 0.35;
const PROJECTILE_HEIGHT = 2.5;
const CHARGE_COOLDOWN = 3;
const ARRIVE_TOLERANCE = 0.6;

interface Runtime {
  rng: number;
  aiTimer: number;
  chargeReady: Map<number, number>;
  speeds: Map<number, number>;
}

const runtimes = new WeakMap<Battle, Runtime>();

function runtime(battle: Battle): Runtime {
  let r = runtimes.get(battle);
  if (!r) {
    r = {
      rng: battle.seed >>> 0,
      aiTimer: 0,
      chargeReady: new Map<number, number>(),
      speeds: new Map<number, number>(),
    };
    runtimes.set(battle, r);
  }
  return r;
}

// mulberry32, Zustand pro Battle.
function random(battle: Battle): number {
  const r = runtime(battle);
  r.rng = (r.rng + 0x6d2b79f5) >>> 0;
  let t = Math.imul(r.rng ^ (r.rng >>> 15), 1 | r.rng);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function randomRange(battle: Battle, min: number, max: number): number {
  return min + (max - min) * random(battle);
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

function rotateSlot(slot: { x: number; z: number }, facing: number): { x: number; z: number } {
  const c = Math.cos(facing);
  const s = Math.sin(facing);
  return { x: slot.x * c + slot.z * s, z: -slot.x * s + slot.z * c };
}

function isAlive(soldier: Soldier): boolean {
  return soldier.state !== 'dead' && soldier.hp > 0;
}

function platoonById(battle: Battle, id: number): Platoon | undefined {
  return battle.platoons.find((p) => p.id === id);
}

function soldierById(battle: Battle, id: number): Soldier | undefined {
  for (const platoon of battle.platoons) {
    const found = platoon.soldiers.find((s) => s.id === id);
    if (found) return found;
  }
  return undefined;
}

function weaponFor(platoon: Platoon): { range: number; ranged: boolean } {
  const stats = UNIT_STATS[platoon.kind];
  if (platoon.kind === 'archer' && platoon.weaponMode === 1) {
    return { range: MELEE_RANGE, ranged: false };
  }
  return { range: stats.range, ranged: stats.ranged };
}

// Kampftempo. Die Werte aus dem Original sind Schadenspunkte pro Treffer, aber
// ohne die Original-Formel ist die Schlussfolgerung "ein Treffer pro Sekunde"
// zu schnell: die Schlacht waere nach 33 Sekunden vorbei. Das Original laesst
// dem Spieler Zeit fuer Befehle und Flankenbewegungen. Deshalb kaempfen die
// Soldaten mit einer festen Kadenz und richten nur einen Teil des Schadens an.
const ATTACK_INTERVAL = 1.15;
export const DAMAGE_SCALE = 0.42;

function attackInterval(kind: UnitKind): number {
  // Bogenschuetzen schiessen langsamer, dafuer mit Wucht.
  return kind === 'archer' ? ATTACK_INTERVAL * 1.5 : ATTACK_INTERVAL;
}

// Abstand der TRUPP-MITTELPUNKTE, bei dem die Frontreihen Kontakt haben.
// Die Waffenreichweite gilt pro Soldat: die vorderste Reihe steht eine halbe
// Formationstiefe vor dem Mittelpunkt. Beide Trupps haben Tiefe, deshalb ist
// der Kontaktabstand NICHT die Waffenreichweite, sondern Tiefe + Tiefe + Rest.
const CONTACT_GAP = 0.9;

function formationHalfDepth(platoon: Platoon): number {
  const stats = UNIT_STATS[platoon.kind];
  const cols = Math.max(1, Math.ceil(Math.sqrt(stats.squad * 1.6)));
  const rows = Math.ceil(stats.squad / cols);
  return ((rows - 1) / 2) * 0.85;
}

function engageDistance(platoon: Platoon, target?: Platoon): number {
  const weapon = weaponFor(platoon);
  const ownDepth = formationHalfDepth(platoon);
  const targetDepth = target ? formationHalfDepth(target) : 0;
  if (weapon.ranged) {
    // Fernkampf: auf Wirkschussweite heran, aber nicht bis zum Kontakt.
    // Ein Bogenschuetze soll stehen bleiben, sobald die vorderste Reihe trifft.
    return Math.max(ownDepth + targetDepth + CONTACT_GAP + 1.0, weapon.range * 0.55);
  }
  // Nahkampf: heran bis die Frontreihen sich beruehren. Der Zuschlag deckt
  // das Raster ab (Soldaten stehen nicht exakt auf ihrem Platz) und die
  // Kontakt-Toleranz der Waffenreichweite.
  return ownDepth + targetDepth + CONTACT_GAP + CONTACT_TOLERANCE;
}

function isBackAttack(attacker: Soldier, target: Soldier): boolean {
  const forwardX = Math.sin(target.facing);
  const forwardZ = Math.cos(target.facing);
  const dx = attacker.x - target.x;
  const dz = attacker.z - target.z;
  const len = Math.hypot(dx, dz);
  if (len < 1e-6) return false;
  const dot = (dx / len) * forwardX + (dz / len) * forwardZ;
  return dot < -0.5;
}

function applyDamage(battle: Battle, target: Soldier, damage: number): void {
  // Gedeckte Stellung: wer steht und den Feind kommen laesst, nimmt weniger
  // Schaden. Zentral hier, weil sowohl Nahkampf als auch Geschosse durch diese
  // Funktion laufen — vorher stand der Bonus in performAttack und wirkte auf
  // Fernkampf ueberhaupt nicht (Geschosse tragen ihren Schaden schon mit sich).
  //
  // Der Wert ist gemessen, nicht geschaetzt: bei sonst identischen Spielern
  // gewann "warten" gegen "ausgewogen" mit 12 % Deckung 2/6, mit 20 % 4/6 und
  // mit 28 % 5/6. 18 % ist der Punkt, an dem Warten ein Vorteil bleibt, ohne
  // die Schlacht zu entscheiden.
  const guard = battle.defensive?.[target.faction] ?? 0;
  if (guard > 0) damage *= 1 - Math.min(0.18, guard * 0.18);

  if (!isAlive(target)) return;
  target.hp -= damage;
  battle.events.push({
    type: 'hit',
    soldierId: target.id,
    damage,
    x: target.x,
    z: target.z,
  });
  if (target.hp <= 0) {
    target.hp = 0;
    target.state = 'dead';
    target.deadTime = 0;
    const platoon = platoonById(battle, target.platoonId);
    if (platoon) platoon.aliveCount = Math.max(0, platoon.aliveCount - 1);
    battle.events.push({
      type: 'death',
      soldierId: target.id,
      x: target.x,
      z: target.z,
      faction: target.faction,
    });
  }
}

function nearestInPlatoon(
  soldier: Soldier,
  targetPlatoon: Platoon,
  rangeSq: number,
): Soldier | null {
  let best: Soldier | null = null;
  let bestD = Infinity;
  for (const other of targetPlatoon.soldiers) {
    if (!isAlive(other)) continue;
    const dx = other.x - soldier.x;
    const dz = other.z - soldier.z;
    const d = dx * dx + dz * dz;
    if (d <= rangeSq && d < bestD) {
      bestD = d;
      best = other;
    }
  }
  return best;
}

function chooseTarget(
  battle: Battle,
  soldier: Soldier,
  platoon: Platoon,
  weapon: { range: number; ranged: boolean },
): Soldier | null {
  if (!platoon.autoAttack && platoon.targetPlatoonId === null) return null;

  // Kontakt-Toleranz: Soldaten bleiben durch das Raster leicht ausserhalb der
  // exakten Reichweite stehen (1.62 m bei 1.6 m). Ohne diese Toleranz greift
  // die Front nie an und die Schlacht bleibt stehen.
  // Hoehenvorteil erweitert das Schussfeld: von oben sieht man weiter.
  const ownHeight = heightAt(soldier.x, soldier.z);
  const heightBonus = weapon.ranged ? Math.min(6, Math.max(0, ownHeight) * 0.45) : 0;
  const towerBonus = weapon.ranged ? towerRangeBonus(battle.structures, soldier.x, soldier.z, platoon.faction) : 0;
  const reach = weapon.range + CONTACT_TOLERANCE + heightBonus + towerBonus;
  const rangeSq = reach * reach;
  // Zuerst das vom Spieler befohlene Ziel, dann das von Auto Approach
  // gewaehlte. Vorher wurde nur targetPlatoonId geprueft — dadurch ignorierten
  // alle Truppen ihre Automatik und nur die Frontreihe kaempfte.
  const orderedId = platoon.playerTargetId ?? platoon.autoTargetId;
  if (orderedId !== null) {
    const targetPlatoon = platoonById(battle, orderedId);
    if (targetPlatoon && targetPlatoon.aliveCount > 0) {
      const preferred = nearestInPlatoon(soldier, targetPlatoon, rangeSq);
      if (preferred) return preferred;
    }
  }

  if (!platoon.autoAttack) return null;

  let best: Soldier | null = null;
  let bestD = Infinity;
  for (const other of battle.platoons) {
    if (other.faction === platoon.faction || other.aliveCount <= 0) continue;
    for (const candidate of other.soldiers) {
      if (!isAlive(candidate)) continue;
      const dx = candidate.x - soldier.x;
      const dz = candidate.z - soldier.z;
      const d = dx * dx + dz * dz;
      if (d <= rangeSq && d < bestD) {
        bestD = d;
        best = candidate;
      }
    }
  }
  return best;
}

function performAttack(
  battle: Battle,
  attacker: Soldier,
  target: Soldier,
  platoon: Platoon,
  weapon: { range: number; ranged: boolean },
): void {
  const stats = UNIT_STATS[platoon.kind];
  const targetStats = UNIT_STATS[target.kind];
  const dist = Math.hypot(target.x - attacker.x, target.z - attacker.z);
  const ranged = weapon.ranged && dist > MELEE_RANGE;

  // Fernkampf nutzt den Ranged-Wert, Nahkampf den Melee-Wert. Das Original
  // fuehrt beide getrennt (MeleeDamage / RangedDamage im Unit-Panel).
  const baseDamage = ranged && stats.rangedDamage > 0 ? stats.rangedDamage : stats.melee;
  let damage =
    baseDamage *
    DAMAGE_SCALE *
    counterMultiplier(platoon.kind, target.kind) *
    randomRange(battle, 0.85, 1.15);
  const defense = ranged ? targetStats.rangedDef : targetStats.meleeDef;
  damage *= 1 - defense / 100;


  // Hoehenvorteil (Vorbild Total War): wer hoeher steht, schiesst weiter und
  // haerter. Der Wert ist pro Meter Hoehenunterschied begrenzt, damit ein
  // Huegel ein Vorteil bleibt und keine Entscheidung.
  const heightDiff = heightAt(attacker.x, attacker.z) - heightAt(target.x, target.z);
  if (ranged && heightDiff > 0.5) {
    damage *= 1 + Math.min(0.35, heightDiff * 0.035);
  } else if (ranged && heightDiff < -0.5) {
    damage *= 1 - Math.min(0.2, -heightDiff * 0.02);
  }

  if (isBackAttack(attacker, target)) damage *= 1.5;

  if (stats.mounted) {
    const r = runtime(battle);
    const speed = r.speeds.get(attacker.id) ?? 0;
    const readyAt = r.chargeReady.get(attacker.id) ?? 0;
    if (speed > stats.speed * 0.8 && battle.time >= readyAt) {
      damage *= 1.8;
      r.chargeReady.set(attacker.id, battle.time + CHARGE_COOLDOWN);
    }
  }

  // Archer im Kontakt: Fernkampf-Malus.
  if (stats.ranged && platoon.weaponMode === 0 && dist <= MELEE_RANGE) {
    damage *= 0.4;
  }

  if (ranged) {
    const projectile: Projectile = {
      id: battle.nextId++,
      x: attacker.x,
      z: attacker.z,
      tx: target.x,
      tz: target.z,
      y: 0,
      t: 0,
      dur: PROJECTILE_FLIGHT,
      damage,
      faction: attacker.faction,
      targetId: target.id,
    };
    battle.projectiles.push(projectile);
    battle.events.push({
      type: 'shot',
      fromX: attacker.x,
      fromZ: attacker.z,
      toX: target.x,
      toZ: target.z,
      faction: attacker.faction,
    });
  } else {
    applyDamage(battle, target, damage);
  }
}

/**
 * Einen Schritt gehen und dabei Hindernissen ausweichen.
 *
 * Geradeaus auf das Ziel zu laufen reicht nicht: eine Mauer oder eine Klippe
 * stoppt die Einheit dann fuer immer und die Schlacht steht still. Deshalb
 * wird bei einem Hindernis die Richtung schrittweise gedreht, bis ein freier
 * Weg gefunden ist — die Einheit laeuft so am Hindernis entlang.
 */
function stepAround(
  battle: Battle,
  faction: Faction,
  fromX: number,
  fromZ: number,
  toX: number,
  toZ: number,
): { x: number; z: number; moved: boolean } {
  const dx = toX - fromX;
  const dz = toZ - fromZ;
  const d = Math.hypot(dx, dz);
  if (d < 1e-9) return { x: fromX, z: fromZ, moved: false };

  const free = (px: number, pz: number): boolean => {
    if (blockedByStructure(battle.structures, px, pz, faction)) return false;
    if (isWater(px, pz)) return true;
    return isPassable(px, pz);
  };

  // Erst geradeaus, dann in wachsenden Winkeln nach beiden Seiten.
  const angles = [0, 0.4, -0.4, 0.8, -0.8, 1.2, -1.2, 1.6, -1.6, 2.0, -2.0];
  for (const a of angles) {
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    const ux = (dx / d) * cos - (dz / d) * sin;
    const uz = (dx / d) * sin + (dz / d) * cos;
    const nx = fromX + ux * d;
    const nz = fromZ + uz * d;
    if (free(nx, nz)) return { x: nx, z: nz, moved: true };
  }
  return { x: fromX, z: fromZ, moved: false };
}

function movePlatoons(battle: Battle, dt: number): void {
  for (const platoon of battle.platoons) {
    if (platoon.aliveCount <= 0) continue;
    const stats = UNIT_STATS[platoon.kind];

    // Spielerbefehl hat Vorrang, sonst gilt die Eigenbewegung aus Auto Approach.
    let targetX = platoon.destX;
    let targetZ = platoon.destZ;
    // Ein gesetzter Angriffsbefehl des Spielers schlaegt die Automatik. Vorher
    // gewann `autoMoveTo` gegen `playerTargetId`: der Trupp lief woandershin,
    // obwohl der Spieler angegriffen hatte — die "kluegere" Strategie war
    // dadurch schlechter als gar keine.
    const hasPlayerAttack = platoon.playerTargetId !== null;
    if (targetX === null && targetZ === null && !hasPlayerAttack && platoon.autoMoveTo) {
      targetX = platoon.autoMoveTo.x;
      targetZ = platoon.autoMoveTo.z;
    }

    if (
      targetX === null &&
      targetZ === null &&
      platoon.targetPlatoonId !== null &&
      !platoon.moraleBroken
    ) {
      const targetPlatoon = platoonById(battle, platoon.targetPlatoonId);
      if (targetPlatoon && targetPlatoon.aliveCount > 0) {
        const d = Math.hypot(targetPlatoon.x - platoon.x, targetPlatoon.z - platoon.z);
        if (d > engageDistance(platoon, targetPlatoon)) {
          targetX = targetPlatoon.x;
          targetZ = targetPlatoon.z;
        }
      }
    }

    if (targetX !== null && targetZ !== null) {
      const dx = targetX - platoon.x;
      const dz = targetZ - platoon.z;
      const d = Math.hypot(dx, dz);
      if (d <= ARRIVE_TOLERANCE) {
        platoon.destX = null;
        platoon.destZ = null;
      } else {
        const stepDist = Math.min(stats.speed * dt, d);
        const step = stepAround(
          battle,
          platoon.faction,
          platoon.x,
          platoon.z,
          platoon.x + (dx / d) * stepDist,
          platoon.z + (dz / d) * stepDist,
        );
        if (step.moved) {
          platoon.x = step.x;
          platoon.z = step.z;
          platoon.facing = Math.atan2(dx, dz);
        }
        if (d - stepDist <= ARRIVE_TOLERANCE) {
          platoon.destX = null;
          platoon.destZ = null;
        }
      }
    }

    // Truppen halten Abstand zueinander. Ohne das stapeln sich mehrere Trupps
    // auf demselben Punkt (alle laufen auf denselben Feind zu), die Soldaten
    // stehen ineinander und keiner kommt in Reichweite — die Schlacht steht.
    for (const other of battle.platoons) {
      if (other === platoon || other.aliveCount <= 0) continue;
      if (other.faction !== platoon.faction) continue;
      const dx = platoon.x - other.x;
      const dz = platoon.z - other.z;
      const d = Math.hypot(dx, dz);
      const minGap = 5.5;
      if (d > 1e-6 && d < minGap) {
        const push = (minGap - d) * 0.5;
        platoon.x += (dx / d) * push;
        platoon.z += (dz / d) * push;
      }
    }

    // Truppbewegung ueber unpassierbares Gelaende: an der Klippe entlang
    // rutschen statt dagegen zu laufen.
    const safe = nudgePassable(platoon.x, platoon.z);
    platoon.x = clamp(safe.x, -WORLD_HALF, WORLD_HALF);
    platoon.z = clamp(safe.z, -WORLD_HALF, WORLD_HALF);

    // Der Truppmittelpunkt darf den Soldaten nicht davonlaufen. Vorher bewegte
    // er sich mit voller Geschwindigkeit, waehrend das Gelaende die Soldaten
    // bremste — nach einigen Sekunden stand der Mittelpunkt am Kartenrand und
    // die Soldaten weit dahinter, die Schlacht lief nie zu Ende.
    // Korrektur: bleibt der Schwerpunkt der Soldaten zu weit zurueck, wird der
    // Mittelpunkt nachgezogen.
    let cx = 0;
    let cz = 0;
    let n = 0;
    for (const soldier of platoon.soldiers) {
      if (!isAlive(soldier)) continue;
      cx += soldier.x;
      cz += soldier.z;
      n += 1;
    }
    if (n > 0) {
      cx /= n;
      cz /= n;
      const drift = Math.hypot(cx - platoon.x, cz - platoon.z);
      const limit = formationWidth(stats.squad) + FORMATION_SPACING * 2;
      if (drift > limit) {
        // Nur so weit nachziehen, dass die Formation wieder zusammenpasst.
        const pull = drift - limit;
        const ux = (cx - platoon.x) / drift;
        const uz = (cz - platoon.z) / drift;
        platoon.x += ux * pull;
        platoon.z += uz * pull;
      }
    }
  }
}

function nearestEnemySoldier(
  battle: Battle,
  soldier: Soldier,
  targetPlatoon: Platoon,
): Soldier | null {
  let best: Soldier | null = null;
  let bestD = Infinity;
  for (const other of targetPlatoon.soldiers) {
    if (!isAlive(other)) continue;
    const d = Math.hypot(other.x - soldier.x, other.z - soldier.z);
    if (d < bestD) {
      bestD = d;
      best = other;
    }
  }
  return best;
}

// Ein Soldat darf sich hoechstens so weit vom Truppmittelpunkt entfernen.
// Das haelt die Formation zusammen, laesst aber die vorderen Reihen Kontakt
// aufnehmen, waehrend die hinteren nachruecken.
// Gelaende bremst. Werte angelehnt an die Vorbilder (Total War, Bannerlord):
// Wasser und Unterholz kosten am meisten Tempo, ein Hang je nach Steigung.
const SPEED_WATER = 0.45;
const SPEED_FOREST = 0.7;
const SPEED_SLOPE_FACTOR = 0.22;

/** Tempo-Faktor am Punkt (1 = ungebremst). */
function terrainSpeedAt(x: number, z: number): number {
  if (isWater(x, z)) return SPEED_WATER;
  let f = 1;
  if (isForest(x, z)) f *= SPEED_FOREST;
  const slope = slopeAt(x, z);
  if (slope > 0.12) f *= Math.max(0.35, 1 - (slope - 0.12) * SPEED_SLOPE_FACTOR * 4);
  return f;
}

const MAX_LEASH = 9;
// Wie weit ein Soldat von seinem Rasterplatz hoechstens nach vorne rueckt.
// Begrenzt, damit die Reihe geschlossen bleibt und nur die Front Kontakt holt.
const CONTACT_PUSH = 2.4;
// Zuschlag auf die Waffenreichweite, damit Kontakt zuverlaessig zustande kommt.
const CONTACT_TOLERANCE = 0.45;

function updateSoldiers(battle: Battle, dt: number): void {
  const r = runtime(battle);
  for (const platoon of battle.platoons) {
    if (platoon.aliveCount <= 0) continue;
    const stats = UNIT_STATS[platoon.kind];
    const weapon = weaponFor(platoon);
    const slots = formationSlots(stats.squad);

    // Gegnertrupp, auf den dieser Trupp zielt. Beide Quellen zaehlen:
    // Spielerbefehl (playerTargetId) und Automatik (autoTargetId). Vorher
    // wurde nur targetPlatoonId gelesen — dadurch ignorierten alle Truppen
    // ihre Automatik und nur die Frontreihe kaempfte.
    const engagedId = platoon.playerTargetId ?? platoon.autoTargetId;
    const engaged =
      engagedId !== null && !platoon.moraleBroken
        ? platoonById(battle, engagedId)
        : undefined;

    // Formation schliesst auf: faellt die Frontreihe, ruecken die Ueberlebenden
    // in die vorderen Slots nach. Ohne das bleiben nach dem ersten Gefecht nur
    // noch Soldaten in hinteren Rastern uebrig, die den Feind nie erreichen —
    // die Schlacht steht dann still.
    const alive = platoon.soldiers.filter(isAlive).sort((a, b) => a.slot - b.slot);
    const compactSlot = new Map<number, number>();
    for (let i = 0; i < alive.length; i++) compactSlot.set(alive[i].id, i);

    for (const soldier of platoon.soldiers) {
      if (!isAlive(soldier)) continue;
      if (soldier.cooldown > 0) soldier.cooldown = Math.max(0, soldier.cooldown - dt);

      const slotIndex = compactSlot.get(soldier.id) ?? soldier.slot;
      const slot = slots[slotIndex] ?? { x: 0, z: 0 };
      const rotated = rotateSlot(slot, platoon.facing);
      const slotX = platoon.x + rotated.x;
      const slotZ = platoon.z + rotated.z;

      const target = chooseTarget(battle, soldier, platoon, weapon);
      soldier.targetId = target ? target.id : null;

      // Zielpunkt bestimmen.
      // Grundfall: zurueck auf den Formationsplatz.
      let goalX = slotX;
      let goalZ = slotZ;

      if (engaged && engaged.aliveCount > 0) {
        const nearest = nearestEnemySoldier(battle, soldier, engaged);
        if (nearest) {
          if (target) {
            // Im Kontakt: an der Slot-Position kaempfen, nicht dort, wo der
            // Soldat zufaellig steht. Sonst rutschen alle Soldaten zum selben
            // Feind und die Formation kollabiert zu einem Haufen.
            goalX = slotX;
            goalZ = slotZ;
          } else {
            // Ausserhalb der Reichweite: vom SLOT aus in Richtung Feind
            // vorruecken, hoechstens bis zur Waffenreichweite.
            const dx = nearest.x - slotX;
            const dz = nearest.z - slotZ;
            const d = Math.hypot(dx, dz);
            if (d > 1e-6) {
              const standoff = weapon.range * 0.8;
              const advance = Math.min(Math.max(d - standoff, 0), CONTACT_PUSH);
              goalX = slotX + (dx / d) * advance;
              goalZ = slotZ + (dz / d) * advance;
            }
          }
        }
      }

      // Leine gilt relativ zum SLOT, nicht zum Truppmittelpunkt. Sonst kann
      // ein Soldat, dessen Rasterplatz weit aussen liegt, nicht nachruecken
      // und die Schlacht bleibt bei zwei uebrigen Kae mpfern stehen.
      const offX = goalX - slotX;
      const offZ = goalZ - slotZ;
      const off = Math.hypot(offX, offZ);
      if (off > MAX_LEASH) {
        goalX = slotX + (offX / off) * MAX_LEASH;
        goalZ = slotZ + (offZ / off) * MAX_LEASH;
      }

      const dx = goalX - soldier.x;
      const dz = goalZ - soldier.z;
      const d = Math.hypot(dx, dz);

      const oldX = soldier.x;
      const oldZ = soldier.z;
      let moved = false;
      if (d > 0.02) {
        // Tempo haengt vom Untergrund ab (Fluss, Wald, Hang).
        const terrain = terrainSpeedAt(soldier.x, soldier.z);
        const stepDist = Math.min(stats.speed * terrain * dt, d);
        const nextX = soldier.x + (dx / d) * stepDist;
        const nextZ = soldier.z + (dz / d) * stepDist;
        // Klippen und Wasser sperren: der Soldat bleibt stehen, statt
        // hindurchzulaufen. Eine Truppe kann so nicht ueber eine Klippe
        // steigen — genau der Punkt aus dem Auftrag.
        // Gebaute Anlagen sperren zusaetzlich (Mauer, Palisade, Wellenbrecher).
        const blocked = blockedByStructure(battle.structures, nextX, nextZ, platoon.faction);
        const terrainOk = isPassable(nextX, nextZ) || isWater(nextX, nextZ);
        if (!blocked && terrainOk) {
          soldier.x = nextX;
          soldier.z = nextZ;
          moved = stepDist > 1e-6;
        } else {
          // Ausweichen: seitlich am Hindernis entlang, damit die Einheit nicht
          // davor stehen bleibt (sonst verstopft eine Mauer die ganze Schlacht).
          const perpX = -(dz / d);
          const perpZ = dx / d;
          for (const dir of [1, -1]) {
            const sx = soldier.x + perpX * stepDist * dir;
            const sz = soldier.z + perpZ * stepDist * dir;
            const sBlocked = blockedByStructure(battle.structures, sx, sz, platoon.faction);
            if (!sBlocked && (isPassable(sx, sz) || isWater(sx, sz))) {
              soldier.x = sx;
              soldier.z = sz;
              moved = true;
              break;
            }
          }
          if (!moved) moved = false;
        }
      }
      const realDist = Math.hypot(soldier.x - oldX, soldier.z - oldZ);
      r.speeds.set(soldier.id, dt > 0 ? realDist / dt : 0);

      if (target) {
        soldier.facing = Math.atan2(target.x - soldier.x, target.z - soldier.z);
        if (soldier.cooldown <= 0) {
          performAttack(battle, soldier, target, platoon, weapon);
          soldier.cooldown = attackInterval(platoon.kind);
          soldier.state = 'attack';
        } else {
          soldier.state = moved ? 'move' : 'attack';
        }
      } else {
        soldier.facing = platoon.facing;
        soldier.state = moved ? 'move' : 'idle';
      }

      soldier.x = clamp(soldier.x, -WORLD_HALF, WORLD_HALF);
      soldier.z = clamp(soldier.z, -WORLD_HALF, WORLD_HALF);
    }
  }
}

function updateProjectiles(battle: Battle, dt: number): void {
  const remaining: Projectile[] = [];
  for (const projectile of battle.projectiles) {
    projectile.t += dt;
    if (projectile.t >= projectile.dur) {
      const target = soldierById(battle, projectile.targetId);
      if (target && isAlive(target)) {
        applyDamage(battle, target, projectile.damage);
      }
    } else {
      projectile.y =
        Math.sin(Math.PI * Math.min(1, projectile.t / projectile.dur)) * PROJECTILE_HEIGHT;
      remaining.push(projectile);
    }
  }
  battle.projectiles = remaining;
}

function updateDead(battle: Battle, dt: number): void {
  for (const platoon of battle.platoons) {
    for (const soldier of platoon.soldiers) {
      if (soldier.state === 'dead') soldier.deadTime += dt;
    }
  }
}

// Abstand zwischen der naechsten lebenden eigenen Einheit und der naechsten
// lebenden Einheit des Zieltrupps.
function nearestGapToPlatoon(platoon: Platoon, target: Platoon): number {
  let best = Infinity;
  for (const a of platoon.soldiers) {
    if (!isAlive(a)) continue;
    for (const b of target.soldiers) {
      if (!isAlive(b)) continue;
      const d = Math.hypot(a.x - b.x, a.z - b.z);
      if (d < best) best = d;
    }
  }
  return best;
}

// Ab dieser Distanz gilt Kontakt: Waffenreichweite plus Toleranz.
function weaponReachFor(platoon: Platoon): number {
  const weapon = weaponFor(platoon);
  return weapon.range + CONTACT_TOLERANCE;
}

function nearestEnemyPlatoon(battle: Battle, platoon: Platoon): Platoon | null {
  let best: Platoon | null = null;
  let bestD = Infinity;
  for (const other of battle.platoons) {
    if (other.faction === platoon.faction || other.aliveCount <= 0) continue;
    const d = Math.hypot(other.x - platoon.x, other.z - platoon.z);
    if (d < bestD) {
      bestD = d;
      best = other;
    }
  }
  return best;
}

// Ein Trupp entscheidet selbst, wen er angeht und ob er vorrueckt.
// Fuer beide Seiten gleich: die KI steuert die Gegenseite, beim Spieler greift
// dieselbe Logik, solange er keinen eigenen Befehl gegeben hat (Auto Approach).
function runAI(battle: Battle): void {
  const r = runtime(battle);
  for (const platoon of battle.platoons) {
    if (platoon.aliveCount <= 0) continue;
    const isEnemy = platoon.faction === 'enemy';
    // Fuer diese Fraktion fuehrt eine KI-Persoenlichkeit (src/sim/ai). Der
    // Sockel darf ihre Entscheidungen nicht ueberschreiben — sonst ist jede
    // Eigenart wirkungslos und alle zehn Spieler verhalten sich gleich.
    if (battle.aiControlled?.includes(platoon.faction)) continue;
    if (!isEnemy && !platoon.autoApproach) continue;
    // Ein ausdruecklicher Befehl des Spielers hat Vorrang: wer ein Marschziel
    // oder Angriffsziel gesetzt hat, wird nicht umdirigiert.
    if (!isEnemy && (platoon.destX !== null || platoon.destZ !== null)) continue;
    // Beim Spieler zaehlt nur das explizit gesetzte Angriffsziel. Sonst wuerde
    // Auto Approach die Konter-Wahl des Spielers sofort ueberschreiben und die
    // Strategie waere wirkungslos.
    const hasPlayerOrder = !isEnemy && platoon.playerTargetId !== null;
    if (hasPlayerOrder) continue;
    const stats = UNIT_STATS[platoon.kind];

    let best: Platoon | null = null;
    let bestDist = Infinity;
    let bestScore = -Infinity;
    for (const other of battle.platoons) {
      if (other.faction === platoon.faction || other.aliveCount <= 0) continue;
      const d = Math.hypot(other.x - platoon.x, other.z - platoon.z);
      if (d > SIGHT) continue;
      const score = counterMultiplier(platoon.kind, other.kind) / Math.max(d, 1);
      if (score > bestScore) {
        bestScore = score;
        bestDist = d;
        best = other;
      }
    }

    if (!best) {
      // Kein Gegner in Sicht: auf den naechstgelegenen Feind vorruecken,
      // nicht nur zur Kartenmitte (sonst erstarren beide Seiten).
      const nearest = nearestEnemyPlatoon(battle, platoon);
      if (nearest) {
        // Kein Gegner in Sicht heisst nicht "stehen bleiben": auf den
        // naechstgelegenen Feind zumarschieren, bis er in Sicht kommt.
        // Das Ziel wird auf passierbares Gelaende gelegt, sonst laufen die
        // Truppen in Waende und Kartenraender.
        platoon.autoTargetId = nearest.id;
        platoon.autoMoveTo = nudgePassable(nearest.x, nearest.z, 12);
      } else {
        platoon.autoTargetId = null;
        platoon.autoMoveTo = null;
      }
      continue;
    }

    platoon.autoTargetId = best.id;

    // Marschziel auf einen PASSIERBAREN Punkt legen. Vorher liefen Truppen
    // quer durch Wald und Klippen bis an den Kartenrand und blieben dort
    // haengen, weil ihr Ziel hinter unwegsamem Gelaende lag.
    const aim = nudgePassable(best.x, best.z, 12);

    if (platoon.kind === 'cavalry' && bestDist > 8) {
      platoon.autoMoveTo = aim;
      continue;
    }

    if (platoon.kind === 'archer') {
      // Bogenschützen rücken auf Wirkschussweite heran und bleiben dann stehen.
      //
      // Vorher wichen sie unter 6 m zurueck. Das war ein Fehler: die
      // Kavallerie ist schneller als ein Bogenschütze, also floh der Trupp
      // endlos bis an den Kartenrand und schoss nie. Ein Bogenschütze, der im
      // Nahkampf steht, hat den Nahkampf-Malus — das ist seine Strafe, nicht
      // eine Flucht bis ans Kartenende.
      platoon.autoMoveTo = bestDist > stats.range * 0.9 ? aim : null;
      continue;
    }

    // Kontakt an der WIRKLICHEN Frontreihe messen, nicht am Truppmittelpunkt.
    // Der Mittelpunkt liegt um die halbe Formationstiefe zurueck; danach
    // beurteilt stand der Trupp scheinbar im Kontakt, waehrend seine Front
    // 2.15 m entfernt war und niemand zuschlug.
    const frontGap = nearestGapToPlatoon(platoon, best);
    if (frontGap > weaponReachFor(platoon)) {
      platoon.autoMoveTo = aim;
    } else {
      platoon.autoMoveTo = null;
    }
  }
}

function syncAliveCounts(battle: Battle): void {
  for (const platoon of battle.platoons) {
    let alive = 0;
    for (const soldier of platoon.soldiers) {
      if (soldier.hp > 0) {
        if (soldier.state === 'dead') soldier.state = 'idle';
        alive++;
      } else if (soldier.state !== 'dead') {
        soldier.state = 'dead';
        soldier.deadTime = 0;
      }
    }
    platoon.aliveCount = alive;
  }
}

function checkEnd(battle: Battle): void {
  syncAliveCounts(battle);
  if (battle.status !== 'running') return;

  let playerAlive = 0;
  let enemyAlive = 0;
  for (const platoon of battle.platoons) {
    if (platoon.faction === 'player') playerAlive += platoon.aliveCount;
    else enemyAlive += platoon.aliveCount;
  }

  if (enemyAlive === 0) {
    battle.status = 'victory';
    battle.events.push({ type: 'end', status: 'victory' });
  } else if (playerAlive === 0) {
    battle.status = 'defeat';
    battle.events.push({ type: 'end', status: 'defeat' });
  }
}

export function createBattle(seed: number = 1): Battle {
  const battle: Battle = {
    platoons: [],
    projectiles: [],
    time: 0,
    status: 'running',
    seed: seed >>> 0,
    nextId: 1,
    events: [],
    // Die Schlacht beginnt in der Bauphase (#13).
    phase: 'build',
    buildTimeLeft: BUILD_PHASE_SECONDS,
    resources: { player: START_RESOURCES, enemy: START_RESOURCES },
    structures: [],
  };

  // Aufstellung wie im Original: eine geschlossene Schlachtlinie, keine
  // weit auseinandergezogenen Einzeltrupps. Abstand 7 m haelt die Trupps so
  // nah, dass sie als Linie wirken und sich gegenseitig decken.
  const xs = [-14, -7, 0, 7, 14];
  const kinds: UnitKind[] = ['archer', 'spearman', 'infantry', 'housecarl', 'cavalry'];

  for (let side = 0; side < 2; side++) {
    const faction: Faction = side === 0 ? 'player' : 'enemy';
    // Aufstellung: Beide Armeen stehen auf der freien Flaeche im Sueden der
    // Karte (z = 20..38). Noerdlich davon liegt der Huegel, noch weiter
    // noerdlich der Fluss. Der Gegner steht naeher am Huegel, der Spieler
    // im offenen Feld — das ergibt ein Gefecht mit Anhoehe in Reichweite.
    // Weiter auseinander als vorher: zwischen den Linien bleibt Platz fuer
    // die Bauphase (Mauern, Palisaden, Wellenbrecher). Ohne Abstand liegt
    // jede Anlage im Sperrbereich der Truppen.
    const z = side === 0 ? 38 : 18;
    const facing = side === 0 ? Math.PI : 0;

    for (let i = 0; i < kinds.length; i++) {
      const kind = kinds[i];
      const stats = UNIT_STATS[kind];
      const x = side === 0 ? xs[i] : xs[xs.length - 1 - i];
      const platoon: Platoon = {
        id: battle.nextId++,
        faction,
        kind,
        x,
        z,
        destX: null,
        destZ: null,
        targetPlatoonId: null,
        facing,
        autoAttack: true,
        autoApproach: true,
        autoTargetId: null,
        playerTargetId: null,
        autoMoveTo: null,
        weaponMode: 0,
        moraleBroken: false,
        soldiers: [],
        aliveCount: stats.squad,
      };

      const slots = formationSlots(stats.squad);
      for (let slotIndex = 0; slotIndex < slots.length; slotIndex++) {
        const rotated = rotateSlot(slots[slotIndex], facing);
        const soldier: Soldier = {
          id: battle.nextId++,
          platoonId: platoon.id,
          faction,
          kind,
          x: x + rotated.x,
          z: z + rotated.z,
          hp: stats.health,
          maxHp: stats.health,
          targetId: null,
          cooldown: 0,
          state: 'idle',
          facing,
          slot: slotIndex,
          deadTime: 0,
        };
        platoon.soldiers.push(soldier);
      }

      battle.platoons.push(platoon);
    }
  }

  runtime(battle);
  return battle;
}

export function step(battle: Battle, dt: number): void {
  if (battle.status !== 'running') return;
  if (!Number.isFinite(dt) || dt < 0) return;
  if (dt === 0) {
    checkEnd(battle);
    return;
  }

  // Bauphase: die Zeit laeuft, aber niemand bewegt sich. Erst wenn die Zeit
  // abgelaufen ist oder der Spieler die Schlacht startet, geht es los.
  if (battle.phase === 'build') {
    battle.buildTimeLeft = Math.max(0, battle.buildTimeLeft - dt);
    battle.time += dt;
    if (battle.buildTimeLeft <= 0) startBattlePhase(battle);
    return;
  }

  battle.time += dt;
  const r = runtime(battle);
  r.aiTimer += dt;
  if (r.aiTimer >= AI_INTERVAL) {
    r.aiTimer = 0;
    runAI(battle);
  }

  movePlatoons(battle, dt);
  updateSoldiers(battle, dt);
  updateProjectiles(battle, dt);
  updateDead(battle, dt);
  checkEnd(battle);
}

export function issueMove(battle: Battle, platoonId: number, x: number, z: number): void {
  const platoon = platoonById(battle, platoonId);
  if (!platoon) return;
  platoon.destX = clamp(x, -WORLD_HALF, WORLD_HALF);
  platoon.destZ = clamp(z, -WORLD_HALF, WORLD_HALF);
  platoon.targetPlatoonId = null;
  platoon.moraleBroken = false;
}

export function issueAttack(battle: Battle, platoonId: number, targetPlatoonId: number): void {
  const platoon = platoonById(battle, platoonId);
  const target = platoonById(battle, targetPlatoonId);
  if (!platoon || !target || platoon.faction === target.faction) return;
  platoon.playerTargetId = targetPlatoonId;
  platoon.targetPlatoonId = target.id;
  platoon.destX = null;
  platoon.destZ = null;
  platoon.moraleBroken = false;
}

export function toggleAutoApproach(battle: Battle, platoonId: number): boolean {
  const platoon = platoonById(battle, platoonId);
  if (!platoon) return false;
  platoon.autoApproach = !platoon.autoApproach;
  if (!platoon.autoApproach) {
    // Aus: der Trupp bleibt stehen, wo er ist.
    platoon.destX = null;
    platoon.destZ = null;
    platoon.targetPlatoonId = null;
  }
  return platoon.autoApproach;
}

export function toggleAutoAttack(battle: Battle, platoonId: number): boolean {
  const platoon = platoonById(battle, platoonId);
  if (!platoon) return false;
  platoon.autoAttack = !platoon.autoAttack;
  return platoon.autoAttack;
}

export function switchWeapon(battle: Battle, platoonId: number): number {
  const platoon = platoonById(battle, platoonId);
  if (!platoon) return 0;
  if (platoon.kind === 'archer' || platoon.kind === 'cavalry') {
    platoon.weaponMode = platoon.weaponMode === 0 ? 1 : 0;
  }
  return platoon.weaponMode;
}

export function platoonAt(
  battle: Battle,
  x: number,
  z: number,
  faction?: Faction,
): Platoon | null {
  let best: Platoon | null = null;
  let bestD = Infinity;

  for (const platoon of battle.platoons) {
    if (faction !== undefined && platoon.faction !== faction) continue;
    if (platoon.aliveCount <= 0) continue;

    const stats = UNIT_STATS[platoon.kind];
    const cols = formationWidth(stats.squad);
    const rows = Math.ceil(stats.squad / Math.max(1, cols));
    const halfW = ((cols - 1) * FORMATION_SPACING) / 2 + FORMATION_SPACING;
    const halfD = ((rows - 1) * FORMATION_SPACING) / 2 + FORMATION_SPACING;

    const dx = x - platoon.x;
    const dz = z - platoon.z;
    const c = Math.cos(platoon.facing);
    const s = Math.sin(platoon.facing);
    const localX = dx * c - dz * s;
    const localZ = dx * s + dz * c;

    if (Math.abs(localX) <= halfW && Math.abs(localZ) <= halfD) {
      const d = dx * dx + dz * dz;
      if (d < bestD) {
        bestD = d;
        best = platoon;
      }
    }
  }

  return best;
}

export function drainEvents(battle: Battle): BattleEvent[] {
  const events = battle.events.slice();
  battle.events.length = 0;
  return events;
}


// ------------------------------------------------------------------ Bauphase

/**
 * Eine Anlage bauen. Gibt `null` bei Erfolg zurueck, sonst den i18n-Schluessel
 * des Grundes (zu teuer, falscher Untergrund, zu nah an einer anderen Anlage).
 */
export function buildStructure(
  battle: Battle,
  faction: Faction,
  kind: BuildKind,
  x: number,
  z: number,
): string | null {
  if (battle.phase !== 'build') return 'buildOnlyInPhase';

  const spec = STRUCTURE_SPECS[kind];
  if (battle.resources[faction] < spec.cost) return 'notEnoughResources';

  const occupied = battle.platoons
    .filter((p) => p.aliveCount > 0)
    .map((p) => ({ x: p.x, z: p.z }));
  const error = placementError(battle.structures, kind, x, z, faction, occupied);
  if (error !== null) return error;

  battle.resources[faction] -= spec.cost;
  battle.structures.push({ id: battle.nextId++, kind, faction, x, z });
  battle.events.push({ type: 'build', kind, x, z, faction });
  return null;
}

/** Bauphase vorzeitig beenden und die Schlacht beginnen. Gibt die Schlacht zurueck. */
export function startBattlePhase(battle: Battle): Battle {
  if (battle.phase !== 'build') return battle;
  battle.phase = 'battle';
  battle.buildTimeLeft = 0;
  battle.time = 0;
  // Die Gegenseite baut ihre Verteidigung selbst — sonst waere die Bauphase
  // einseitig und der Spieler muesste nichts abwaegen.
  const occupied = battle.platoons
    .filter((p) => p.aliveCount > 0)
    .map((p) => ({ x: p.x, z: p.z }));
  for (const plan of enemyBuildPlan(battle.structures, occupied)) {
    const spec = STRUCTURE_SPECS[plan.kind];
    if (battle.resources.enemy < spec.cost) continue;
    if (placementError(battle.structures, plan.kind, plan.x, plan.z, 'enemy', occupied) !== null) continue;
    battle.resources.enemy -= spec.cost;
    battle.structures.push({ id: battle.nextId++, kind: plan.kind, faction: 'enemy', x: plan.x, z: plan.z });
  }
  battle.events.push({ type: 'phase', phase: 'battle' });
  return battle;
}
