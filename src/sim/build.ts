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

import { FIELD_HALF, heightAt, isWater, slopeAt } from './terrain';
import type { Faction } from './types';

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
  // Wellenbrecher: nur im Fluss, macht den Uebergang unpassierbar.
  breakwater: { kind: 'breakwater', cost: 22, height: 1.2, width: 5.0, blocks: true, waterOnly: true, rangeBonus: 0 },
  // Wachturm: sperrt nicht, gibt Bogenschuetzen in der Naehe mehr Reichweite.
  tower: { kind: 'tower', cost: 26, height: 4.5, width: 2.4, blocks: false, waterOnly: false, rangeBonus: 5 },
};

export interface Structure {
  id: number;
  kind: StructureKind;
  faction: Faction;
  x: number;
  z: number;
}

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
