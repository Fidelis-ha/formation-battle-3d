/**
 * Die zehn KI-Spieler.
 *
 * Jeder Spieler ist eine Persoenlichkeit: eine Eigenart, die im Kampf spuerbar
 * wird, und ein Staerkegrad, der sich aus dieser Eigenart ergibt — nicht aus
 * besseren Werten. Alle kaempfen mit denselben Einheiten und denselben Regeln.
 *
 * Aufbau: `runAI` in battle.ts ist der Sockel (Bewegung, Zielsuche, Kontakt).
 * Eine Persoenlichkeit setzt Parameter darauf. Dadurch entstehen Unterschiede
 * aus Entscheidungen, nicht aus Cheats.
 *
 * Dieses Modul importiert bewusst KEIN three — die Simulation bleibt in Node
 * testbar.
 */

import type { UnitKind } from '../types';

/** Welche Trupps zuerst nach vorne gehen. */
export type Aggression = 'rush' | 'balanced' | 'wait';

/** Wie der Gegner ausgewaehlt wird. */
export type TargetDoctrine =
  /** Nur der beste Konter zaehlt (Multiplikator / Distanz). */
  | 'counter'
  /** Immer auf Bogenschuetzen — die weichsten Ziele. */
  | 'archers'
  /** Immer auf den schwaechsten Trupp — nacheinander abraeumen. */
  | 'weakest'
  /** Immer auf den naechsten — schneller Kontakt. */
  | 'nearest'
  /** Immer auf Reiterei — wer die Reiterei bricht, gewinnt das Feld. */
  | 'cavalry'
  /** Auf den Trupp, der der eigenen Aufstellung am gefaehrlichsten ist. */
  | 'threat';

/** Wie die Armee aufgeteilt wird. */
export type FormationDoctrine =
  /** Alles in einer Linie, geschlossen. */
  | 'line'
  /** Zwei Haelften, greifen von zwei Seiten an. */
  | 'pincer'
  /** Eine starke Mitte, Fluegel zurueckhaltend. */
  | 'hammer'
  /** Zurueckhaltend, dann geballt. */
  | 'reserve';

/** Wann der Angriff beginnt. */
export type TempoDoctrine =
  /** Sofort. */
  | 'instant'
  /** Nach kurzer Sammlung. */
  | 'normal'
  /** Erst wenn der Gegner kommt. */
  | 'patient';

export interface Personality {
  /** Eindeutiger Schluessel, auch fuer i18n und Speichern. */
  id: string;
  /** Anzeigename (deutsch). */
  name: string;
  /** Ein Satz, der die Eigenart beschreibt (deutsch). */
  trait: string;
  /** Staerkestufe 1..10, aufsteigend. Nur fuer die Anzeige und Kampagne. */
  level: number;

  aggression: Aggression;
  target: TargetDoctrine;
  formation: FormationDoctrine;
  tempo: TempoDoctrine;

  /**
   * Wie gut der Spieler den Konter erkennt.
   * 0 = waehlt zufaellig, 1 = waehlt immer den besten Konter.
   * Das ist der eigentliche Staerkeregler: ein guter Spieler trifft die
   * bessere Wahl oefter, er kaempft nicht mit staerkeren Einheiten.
   */
  discipline: number;

  /** Wie stark der Spieler auf geaendertes Schlachtenglueck reagiert (0..1). */
  adaptivity: number;

  /** Streuung der Entscheidungen (0 = immer gleich, 1 = sehr sprunghaft). */
  noise: number;

  /** Trupps, die zurueckgehalten werden (Anteil 0..1 der Armee). */
  reserveShare: number;
}

/**
 * Die zehn Spieler, aufsteigend nach Staerke.
 *
 * Die Staerke ergibt sich aus drei Dingen: wie gut der Konter erkannt wird
 * (discipline), wie sauber die Truppen gebuendelt werden (formation) und wie
 * gut auf Verluste reagiert wird (adaptivity). Der Rekrut ist nicht schwach,
 * weil seine Werte schlecht sind, sondern weil er planlos angreift.
 */
export const PERSONALITIES: Personality[] = [
  {
    id: 'recruit',
    name: 'Der Rekrut',
    trait: 'Wirft alles gleichzeitig nach vorne, ohne auf den Konter zu achten.',
    level: 1,
    aggression: 'rush',
    target: 'nearest',
    formation: 'line',
    tempo: 'instant',
    discipline: 0.05,
    adaptivity: 0.05,
    noise: 0.5,
    reserveShare: 0,
  },
  {
    id: 'wall',
    name: 'Die Mauer',
    trait: 'Stellt sich hin und laesst kommen. Wer anrennt, bricht sich.',
    level: 2,
    aggression: 'wait',
    target: 'nearest',
    formation: 'line',
    tempo: 'patient',
    discipline: 0.18,
    adaptivity: 0.15,
    noise: 0.42,
    reserveShare: 0.2,
  },
  {
    id: 'spearmaster',
    name: 'Der Speermeister',
    trait: 'Speere gegen Reiterei — alles andere ist ihm gleich.',
    level: 3,
    aggression: 'balanced',
    target: 'cavalry',
    formation: 'line',
    tempo: 'normal',
    // Etwas staerker als die Mauer, aber klar unter dem Reiter: gemessen lag er
    // mit 0.32 gleichauf mit Stufe 2, weil "nur Reiterei jagen" vier Fuenftel
    // der feindlichen Armee ignoriert.
    discipline: 0.42,
    adaptivity: 0.3,
    noise: 0.32,
    reserveShare: 0.1,
  },
  {
    id: 'rider',
    name: 'Die Reiterin',
    trait: 'Reiterei zuerst, immer auf die Bogenschuetzen.',
    level: 4,
    aggression: 'rush',
    target: 'archers',
    formation: 'hammer',
    // Sofort los: gemessen gewann die Reiterin mit sofortigem Angriff auf die
    // Bogenschuetzen 6/6 gegen dieselbe Basis, mit spaeterem Angriff nur 4/6.
    // Ihre Staerke ist der fruehe Stoss, nicht das Abwarten.
    tempo: 'instant',
    discipline: 0.44,
    adaptivity: 0.32,
    noise: 0.3,
    reserveShare: 0,
  },
  {
    id: 'tactician',
    name: 'Der Taktiker',
    trait: 'Waehlt den Konter und greift gebuendelt an.',
    level: 7,
    aggression: 'balanced',
    target: 'counter',
    formation: 'line',
    tempo: 'normal',
    discipline: 0.52,
    adaptivity: 0.42,
    noise: 0.27,
    reserveShare: 0.1,
  },
  {
    id: 'pincer',
    name: 'Die Zangenbewegung',
    trait: 'Teilt die Armee und greift von zwei Seiten an.',
    level: 6,
    aggression: 'balanced',
    target: 'counter',
    formation: 'pincer',
    tempo: 'normal',
    discipline: 0.7,
    adaptivity: 0.62,
    noise: 0.22,
    reserveShare: 0.1,
  },
  {
    id: 'delayer',
    name: 'Der Zoegerer',
    trait: 'Wartet lange — und schlaegt dann geballt zu.',
    level: 5,
    aggression: 'wait',
    target: 'counter',
    formation: 'line',
    tempo: 'patient',
    // Gemessen 85 % mit 0.76 — Warten plus hohe Disziplin war die staerkste
    // Kombination im Feld. Zurueckgenommen, damit Stufe 7 zwischen Taktiker
    // (5) und Hammer (8) liegt und nicht darueber.
    discipline: 0.58,
    adaptivity: 0.45,
    noise: 0.26,
    reserveShare: 0.25,
  },
  {
    id: 'hammer',
    name: 'Der Hammer',
    trait: 'Alles auf einen Trupp, dann den naechsten. Kein Zersplittern.',
    level: 8,
    aggression: 'balanced',
    target: 'counter',
    formation: 'line',
    tempo: 'normal',
    // Korrektur nach Messung: "schwaechster zuerst" gewann nur 2 von 6 Partien
    // gegen dieselbe Basis — die Doktrin ist schwach, nicht stark. Der Hammer
    // bleibt trotzdem "alles auf einen Trupp": das leistet die Formation, nicht
    // die Zielwahl. Seine Staerke kommt aus hoher Disziplin.
    discipline: 0.8,
    adaptivity: 0.6,
    noise: 0.18,
    reserveShare: 0.1,
  },
  {
    id: 'spider',
    name: 'Die Spinne',
    trait: 'Haelt Abstand und lockt in die eigene Aufstellung.',
    level: 10,
    aggression: 'wait',
    target: 'threat',
    formation: 'line',
    tempo: 'normal',
    // Gemessen 96 % — 'threat' plus Abwarten war die staerkste Zielwahl.
    // Disziplin gesenkt, damit sie ueber dem Hammer liegt, aber unter dem
    // Feldherrn bleibt.
    discipline: 0.58,
    adaptivity: 0.55,
    noise: 0.27,
    reserveShare: 0.2,
  },
  {
    id: 'commander',
    name: 'Der Feldherr',
    trait: 'Passt sich an: nutzt Gelaende, Konter und Reserven zugleich.',
    level: 9,
    aggression: 'balanced',
    target: 'counter',
    formation: 'line',
    tempo: 'normal',
    discipline: 0.97,
    adaptivity: 0.85,
    noise: 0.12,
    reserveShare: 0.15,
  },
];

/** Persoenlichkeit anhand der Kennung holen. */
export function personalityById(id: string): Personality | null {
  return PERSONALITIES.find((p) => p.id === id) ?? null;
}

/**
 * Die Staerke einer Persoenlichkeit als eine Zahl (0..1).
 *
 * Dient nur der Kalibrierung und der Anzeige. Sie ist bewusst aus den
 * Verhaltenswerten zusammengesetzt und nicht frei waehlbar: wer sauberer
 * entscheidet und besser reagiert, ist staerker.
 */
export function strengthOf(p: Personality): number {
  const formationBonus =
    p.formation === 'pincer' ? 0.1 : p.formation === 'hammer' ? 0.08 : p.formation === 'reserve' ? 0.05 : 0;
  const tempoBonus = p.tempo === 'normal' ? 0.04 : p.tempo === 'patient' ? 0.02 : 0;
  return Math.min(1, p.discipline * 0.62 + p.adaptivity * 0.28 + formationBonus + tempoBonus);
}

/** Trupps, die zu einer Persoenlichkeit gehoeren (fuer die Reserve). */
export function reserveKinds(p: Personality, kinds: UnitKind[]): UnitKind[] {
  if (p.reserveShare <= 0) return [];
  const count = Math.max(1, Math.round(kinds.length * p.reserveShare));
  // Die Reserve sind die hinteren Trupps: Bogenschuetzen und Reiterei halten
  // sich zurueck, die Linie steht vorne.
  const order: UnitKind[] = ['archer', 'cavalry', 'housecarl', 'spearman', 'infantry'];
  return order.filter((k) => kinds.includes(k)).slice(0, count);
}
