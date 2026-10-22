/**
 * Bauphase: Verteidigungsanlagen mit Rohstoffen bauen, bevor die Schlacht
 * beginnt.
 *
 * Diese Datei ist reine Logik (kein `three`), damit sie testbar bleibt und der
 * Renderer nur die fertigen Anlagen zeichnet.
 *
 * Auslegung des Auftrags: Marc nennt "Mauern ... oder Welle ... oder andere
 * Belagerungs- oder Verteidigungsanlagen". "Welle" ist hier als **Wellenbrecher**
 * gelesen (Verteidigungsanlage im Fluss) — passend zur Aufzaehlung mit Mauer
 * und Anlagen. Steht so im Issue #13.
 */

import { FIELD_HALF, heightAt, isWater, slopeAt, isPassable } from './terrain';
import type { Faction, Structure } from './types';

export type StructureKind = 'wall' | 'palisade' | 'breakwater' | 'tower';

export interface StructureSpec {
  kind: StructureKind;
  /** Kosten in Rohstoffen. */
  cost: number;
  /** Hoehe fuer das Bild. */
  height: number;
  /** Breite in Metern (fuer Sperre und Darstellung). */
  width: number;
  /** Blockiert Bewegung vollstaendig? */
  blocks: boolean;
  /** Nur im Wasser baubar? */
  waterOnly: boolean;
  /** Zusatz-Reichweite fuer Fernkampf in der Naehe. */
  rangeBonus: number;
}

export const STRUCTURE_SPECS: Record<StructureKind, StructureSpec> = {
  // Mauer: teuer, sperrt ganz.
  wall: { kind: 'wall', cost: 30, height: 2.2, width: 4.0, blocks: true, waterOnly: false, rangeBonus: 0 },
  // Palisade: billig, sperrt ganz, niedriger.
  palisade: { kind: 'palisade', cost: 14, height: 1.5, width: 3.4, blocks: true, waterOnly: false, rangeBonus: 0 },
  // Wellenbrecher: nur im Wasser, und er OEFFNET den Uebergang.
  //
  // Vorher sperrte er ihn — das war die Gegenrichtung. Ein Wellenbrecher ist
  // eine Bruecke: an dieser Stelle kann eine Armee durch das Wasser. Ohne ihn
  // ist Wasser unpassierbar.
  breakwater: { kind: 'breakwater', cost: 22, height: 1.2, width: 5.0, blocks: false, waterOnly: true, rangeBonus: 0 },
  // Wachturm: sperrt nicht, gibt Bogenschuetzen in der Naehe mehr Reichweite.
  tower: { kind: 'tower', cost: 26, height: 4.5, width: 2.4, blocks: false, waterOnly: false, rangeBonus: 5 },
};

// `Structure` kommt aus types.ts — eine zweite Fassung hier haette bedeutet,
// dass ein Wellenbrecher mit Spannweite in dem einen Modul als fehlerhaft gilt
// und in dem anderen nicht.
export type { Structure } from './types';

/** Rohstoffe zu Beginn der Bauphase. */
export const START_RESOURCES = 70;

/** Dauer der Bauphase in Sekunden. */
export const BUILD_PHASE_SECONDS = 45;

/** Abstand, in dem zwei Anlagen nicht uebereinander stehen duerfen. */
const MIN_SPACING = 2.6;

/**
 * Darf hier gebaut werden? Gibt `null` zurueck, wenn ja, sonst den Grund.
 * Der Grund ist ein i18n-Schluessel.
 */
export function placementError(
  structures: Structure[],
  kind: StructureKind,
  x: number,
  z: number,
  faction: Faction,
  /** Stehende Trupps: dort darf nicht gebaut werden. */
  occupied: { x: number; z: number }[] = [],
): string | null {
  const spec = STRUCTURE_SPECS[kind];

  // Innerhalb der Karte
  if (Math.abs(x) > FIELD_HALF - 4 || Math.abs(z) > FIELD_HALF - 4) return 'tooSteep';

  // Nicht auf Fels oder Klippe
  if (slopeAt(x, z) > 0.55) return 'tooSteep';

  const water = isWater(x, z);
  if (spec.waterOnly && !water) return 'buildNeedsWater';
  if (!spec.waterOnly && water) return 'buildNoWater';

  // Nicht uebereinander
  for (const s of structures) {
    if (Math.hypot(s.x - x, s.z - z) < MIN_SPACING) return 'buildTooClose';
  }

  // Nicht auf einen stehenden Trupp bauen.
  for (const spot of occupied) {
    if (Math.hypot(spot.x - x, spot.z - z) < 5) return 'buildInFormation';
  }

  void faction;
  void heightAt;
  return null;
}

/**
 * Sperrt eine Anlage diese Stelle?
 *
 * Mauern und Palisaden sperren ALLE Truppen, auch die eigenen — sonst waere
 * eine Mauer wirkungslos, sobald die eigenen Truppen vorruecken (genau das war
 * der Fehler: der Trupp lief durch die eigene Palisade). Wer hinter einer
 * Mauer steht, muss sie umgehen oder durch eine Luecke gehen.
 */
export function blockedByStructure(structures: Structure[], x: number, z: number, faction: Faction): boolean {
  for (const s of structures) {
    const spec = STRUCTURE_SPECS[s.kind];
    if (!spec.blocks) continue;
    // Die eigene Anlage ist Deckung, kein Hindernis: die eigenen Truppen
    // stehen dahinter und ruecken durch. Der Gegner muss sie umgehen.
    // Wuerden Mauern beide Seiten sperren, waere jede Schlacht mit Mauer
    // unentscheidbar — beide Armeen stehen dann vor einer Wand.
    if (s.faction === faction) continue;
    // Etwas breiter als die halbe Breite: sonst bleibt zwischen zwei
    // Segmenten ein Haar-Riss, durch den eine Einheit schluepft.
    if (Math.hypot(s.x - x, s.z - z) < spec.width * 0.62) return true;
  }
  return false;
}

/**
 * Steht an dieser Stelle ein Wellenbrecher? Dann ist Wasser hier begehbar.
 *
 * Der Damm gehoert der Seite, die ihn gebaut hat: die eigene Armee geht
 * hinueber, die fremde nicht. Sonst waere eine Bruecke fuer beide Seiten da
 * und die Bauphase ohne jede Wirkung.
 */
export function bridgeAt(structures: Structure[], x: number, z: number, faction: Faction): boolean {
  for (const s of structures) {
    if (s.kind !== 'breakwater') continue;
    if (s.faction !== faction) continue;
    if (bridgeCovers(s, x, z)) return true;
  }
  return false;
}

/**
 * Halbe wirksame Breite eines Wellenbrechers.
 *
 * Eine Truppe ist breiter als ein Punkt; ein Damm in Modellbreite waere fuer
 * sie ein Haar-Riss, den sie nicht trifft. Deshalb 1,6-fach.
 *
 * Diese eine Zahl benutzen Wegfindung und Bewegung gemeinsam. Zwei getrennte
 * Werte waren die Ursache dafuer, dass die Wegfindung durch eine Stelle
 * rechnete, an der die Bewegung sperrte — die Truppe blieb stehen.
 */
export const BREAKWATER_HALF_WIDTH = (STRUCTURE_SPECS.breakwater.width * 1.6) / 2;

/**
 * Halbe Breite des Streifens, den ein Damm begehbar macht.
 *
 * Ein Trupp steht in Formation und ist rund 12 m breit (28 Soldaten, 7 Spalten
 * a 0,85 m Abstand). Ein Uebergang in Modellbreite laesst die aeusseren
 * Soldaten daneben ins Wasser treten — gemessen standen 40 Soldaten im Wasser,
 * obwohl der Damm da war, und der Trupp kam nicht hinueber.
 *
 * Der Damm ist ein Bauwerk, das eine Formation traegt; die Grafik zeigt ihn
 * schmaler, damit die Karte lesbar bleibt. Diese Breite ist der eine Wert, den
 * Wegfindung und Bewegung gemeinsam benutzen.
 */
export const BREAKWATER_WALK_HALF_WIDTH = 8;


/**
 * Liegt dieser Punkt auf dem Damm?
 *
 * Geprueft wird gegen die Spannweite (Ufer A nach Ufer B), nicht gegen einen
 * Kreis um den Mittelpunkt: ein Damm ist ein Streifen, kein Fleck.
 */
export function bridgeCovers(s: Structure, x: number, z: number): boolean {
  const halfW = BREAKWATER_WALK_HALF_WIDTH;
  // Die Spannweite wird einmal beim Bau festgehalten und danach von Wegfindung
  // UND Bewegung benutzt. Ohne das rechnete die Wegfindung bis ans Ende der
  // Spannweite, waehrend die Bewegung nur einen Kreis um den Mittelpunkt
  // zuliess — die Truppe lief bis an den Rand dieses Kreises und blieb stehen.
  // Gemessen: mit Damm kam die Armee nur bis z = 8,9, ohne Damm bis z = -5,2.
  // Ohne gespeicherte Spannweite wird sie berechnet: sonst wuerde die Bewegung
  // einen anderen Daemmel meinen als die Wegfindung.
  // Alle Achsen, auf denen der Damm Ufer erreicht. Bei einem runden See ist das
  // ein Kreuz: nur so kommt eine Armee sowohl von Norden als auch von Osten
  // hinueber.
  const spans = s.span ? [s.span, ...bridgeSpansAt(s.x, s.z)] : bridgeSpansAt(s.x, s.z);
  for (const span of spans) {
    // Abstand zur Damm-Linie (Ufer A nach Ufer B). Der Damm ist ein Streifen,
    // kein Kreis: nur so reicht er von Ufer zu Ufer.
    const dx = span.bx - span.ax;
    const dz = span.bz - span.az;
    const len2 = dx * dx + dz * dz;
    if (len2 < 0.0001) continue;
    // Projektion auf die Damm-Achse, auf die Laenge begrenzt.
    let t = ((x - span.ax) * dx + (z - span.az) * dz) / len2;
    t = Math.max(0, Math.min(1, t));
    const px = span.ax + dx * t;
    const pz = span.az + dz * t;
    if (Math.hypot(x - px, z - pz) <= halfW) return true;
  }
  // Kein Ufer in Reichweite: dieser Damm reicht nicht hinueber und oeffnet
  // nichts. Ein Damm, der mitten im Wasser endet, waere sonst eine Falle.
  return false;
}

/**
 * Die Uferpunkte eines Wellenbrechers an dieser Stelle — je Achse.
 *
 * Ein Damm ist kein Kreis: er spannt sich von Ufer zu Ufer. Wird er irgendwo ins
 * Wasser gesetzt, sucht diese Funktion in beide Richtungen das naechste Land.
 *
 * Zurueck kommen ALLE Achsen, auf denen beide Seiten Land erreichen — nicht nur
 * die kuerzeste. Der Unterschied ist wichtig: bei einem runden See ist die
 * Ost-West-Spannweite kuerzer als die Nord-Sued-Spannweite, die Truppen laufen
 * aber von Norden nach Sueden. Mit nur der kuerzesten Achse war der Damm ein
 * Streifen quer zur Laufrichtung, und die Armee blieb mitten im Wasser stehen
 * (gemessen: mit Damm kam sie nur bis z = 6,9 statt bis z = -11,0).
 */
/**
 * Laengste Spannweite, die ein Wellenbrecher noch ueberbrueckt.
 *
 * Ein Damm ist ein Bauwerk fuer eine schmale Furt, keinen 50-m-See. Ohne Grenze
 * haette ein einziger Damm einen ganzen See in Kreuzform ueberspannt — begehbar,
 * aber unsinnig. Wo das Wasser breiter ist, geht man aussen herum.
 */
const MAX_DAM_SPAN = 30;

export function bridgeSpansAt(
  x: number,
  z: number,
): { ax: number; az: number; bx: number; bz: number }[] {
  /** Naechstes Land ab hier in eine Richtung. */
  const landIn = (dx: number, dz: number): { x: number; z: number; d: number } | null => {
    for (let d = 1; d <= 60; d += 0.5) {
      const px = x + dx * d;
      const pz = z + dz * d;
      if (!isWater(px, pz) && isPassable(px, pz)) return { x: px, z: pz, d };
    }
    return null;
  };

  const achsen: [number, number][] = [
    [0, 1],
    [1, 0],
  ];
  const spans: { ax: number; az: number; bx: number; bz: number }[] = [];
  for (const [dx, dz] of achsen) {
    const a = landIn(dx, dz);
    const b = landIn(-dx, -dz);
    if (!a || !b) continue;
    if (a.d + b.d > MAX_DAM_SPAN) continue;
    spans.push({ ax: a.x, az: a.z, bx: b.x, bz: b.z });
  }
  return spans;
}

/**
 * Die kuerzeste Spannweite (Rueckwaertskompatibel).
 *
 * Nur fuer Anzeige und alte Spielstaende — fuer die Begehbarkeit zaehlen alle
 * Achsen aus `bridgeSpansAt`.
 */
export function bridgeSpanAt(x: number, z: number): { ax: number; az: number; bx: number; bz: number } | null {
  const spans = bridgeSpansAt(x, z);
  if (spans.length === 0) return null;
  let best = spans[0];
  let bestLen = Math.hypot(best.bx - best.ax, best.bz - best.az);
  for (const s of spans) {
    const len = Math.hypot(s.bx - s.ax, s.bz - s.az);
    if (len < bestLen) {
      best = s;
      bestLen = len;
    }
  }
  return best;
}

/** Zusatz-Reichweite durch Wachtuerme der eigenen Seite in der Naehe. */
export function towerRangeBonus(structures: Structure[], x: number, z: number, faction: Faction): number {
  let bonus = 0;
  for (const s of structures) {
    if (s.faction !== faction) continue;
    const spec = STRUCTURE_SPECS[s.kind];
    if (spec.rangeBonus <= 0) continue;
    if (Math.hypot(s.x - x, s.z - z) < 12) bonus = Math.max(bonus, spec.rangeBonus);
  }
  return bonus;
}

/**
 * Die Gegenseite baut ebenfalls — sonst waere die Bauphase einseitig.
 * Sie setzt eine schlichte, aber sinnvolle Verteidigung: Palisaden vor der
 * eigenen Linie und einen Wachturm.
 */
export function enemyBuildPlan(
  structures: Structure[] = [],
  occupied: { x: number; z: number }[] = [],
): { kind: StructureKind; x: number; z: number }[] {
  const wanted: { kind: StructureKind; x: number; z: number }[] = [];

  // Vor der eigenen Linie (z = 20) eine Palisadenreihe, dahinter ein Turm.
  // Die genauen Punkte werden geprueft: liegt einer ungeeignet, wird er nach
  // aussen verschoben, statt ganz zu entfallen.
  const tried = [...structures];
  const place = (kind: StructureKind, x: number, z: number): void => {
    for (const offset of [0, 1.5, -1.5, 3, -3, 4.5, -4.5, 6, -6]) {
      const px = x + offset;
      if (placementError(tried, kind, px, z, 'enemy', occupied) !== null) continue;
      wanted.push({ kind, x: px, z });
      tried.push({ id: -1, kind, faction: 'enemy', x: px, z });
      return;
    }
  };

  // Bewusst KEINE geschlossene Mauer quer ueber das Feld: ohne Wegfindung
  // bleibt eine durchgehende Sperre stehen und die Schlacht wird unentscheidbar.
  // Der Gegner sichert stattdessen seine Flanken und stellt einen Turm auf.
  place('palisade', -16, 24);
  place('palisade', -13, 24);
  place('palisade', 16, 24);
  place('palisade', 13, 24);
  place('tower', 0, 26);
  return wanted;
}
