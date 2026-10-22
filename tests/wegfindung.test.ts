/**
 * Wegfindung und Wasser.
 *
 * Geprueft wird die Mechanik dort, wo sie entschieden wird: im Distanzfeld.
 * Ob eine Armee den Damm dann tatsaechlich benutzt, prueft
 * `wellenbrecher.test.ts` an einer laufenden Schlacht — das gehoert nicht
 * hierher, weil die KI auch dann um Wasser herumlaeuft, wenn das kuerzer ist.
 *
 * Drei Aussagen:
 *  1. Ohne Damm ist eine Wasserstelle im Feld unerreichbar.
 *  2. Mit Damm ist dieselbe Stelle erreichbar.
 *  3. Ein Weg beruehrt Wasser nie ausserhalb des Damms.
 */

import { describe, expect, it } from 'vitest';
import { buildNavField, nextWaypoint, UNREACHABLE } from '../src/sim/ai/nav';
import { isWater, setMap } from '../src/sim/terrain';
import { mapById } from '../src/sim/maps';
import { BREAKWATER_WALK_HALF_WIDTH } from '../src/sim/build';

const KARTE = 'shallow-ford';

/** Kantenlaenge einer Rasterzelle — muss zur Rasterung in `nav.ts` passen. */
const CELL = 2;
const SIZE = 90;

/** Abstandswert einer Weltposition im Feld. */
function feldWert(dist: Uint16Array, x: number, z: number): number {
  const ix = Math.max(0, Math.min(SIZE - 1, Math.round((x + 90) / CELL)));
  const iz = Math.max(0, Math.min(SIZE - 1, Math.round((z + 90) / CELL)));
  return dist[iz * SIZE + ix];
}

/**
 * Mitte einer Wasserflaeche, die NICHT auf einer Furt liegt.
 *
 * Auf der Weglinie zwischen den Startpunkten liegt bei dieser Karte eine Furt —
 * dort kann man ohnehin waten, ein Damm waere bedeutungslos. Gesucht wird
 * deshalb eine senkrechte Linie, auf der das Wasser wirklich eine Wand ist.
 */
function dammPunkt(): { x: number; z: number } {
  const map = mapById(KARTE);
  if (!map) throw new Error(`Karte ${KARTE} fehlt`);
  setMap(map);
  for (let x = -60; x <= 60; x += 2) {
    // Wasserbereich auf dieser Senkrechten suchen.
    let erst: number | null = null;
    let letzt: number | null = null;
    for (let z = -60; z <= 60; z += 1) {
      if (!isWater(x, z)) continue;
      if (erst === null) erst = z;
      letzt = z;
    }
    if (erst === null || letzt === null) continue;
    const zMitte = (erst + letzt) / 2;
    if (!isWater(x, zMitte)) continue;
    return { x, z: zMitte };
  }
  throw new Error('kein Wasser abseits der Furten gefunden');
}

describe('Wegfindung kennt den Wellenbrecher', () => {
  it('ohne Damm ist die Wasserstelle unerreichbar', () => {
    const punkt = dammPunkt();
    expect(isWater(punkt.x, punkt.z)).toBe(true);
    const feld = buildNavField(0, -50, []);
    expect(feldWert(feld.dist, punkt.x, punkt.z)).toBe(UNREACHABLE);
  });

  it('mit Damm ist dieselbe Stelle erreichbar', () => {
    const punkt = dammPunkt();
    const feld = buildNavField(0, -50, [punkt]);
    const wert = feldWert(feld.dist, punkt.x, punkt.z);
    expect(wert, 'die Dammstelle bleibt gesperrt').not.toBe(UNREACHABLE);
    expect(wert).toBeGreaterThan(0);
  });

  it('ein Weg beruehrt Wasser nur im Bereich des Damms', () => {
    const punkt = dammPunkt();
    // Karte erneut setzen: `dammPunkt` hat sie gesetzt, aber die Zwischen-
    // speicher sollen frisch sein.
    setMap(mapById(KARTE)!);
    const feld = buildNavField(0, -50, [punkt]);

    let x = 0;
    let z = 50;
    const wasserPunkte: { x: number; z: number }[] = [];
    for (let schritt = 0; schritt < 400; schritt++) {
      const weiter = nextWaypoint(feld, x, z);
      if (!weiter) break;
      x = weiter.x;
      z = weiter.z;
      if (isWater(x, z)) wasserPunkte.push({ x, z });
      if (Math.hypot(x - 0, z + 50) < 3) break;
    }

    // Wo der Weg Wasser beruehrt, muss es der Damm sein. Beruehrt er keines,
    // ist die Aussage trotzdem richtig — dann ging es aussen herum.
    const reach = BREAKWATER_WALK_HALF_WIDTH + CELL;
    for (const p of wasserPunkte) {
      const abstand = Math.hypot(p.x - punkt.x, p.z - punkt.z);
      expect(
        abstand,
        `Wasserpunkt ${p.x}/${p.z} liegt ${abstand.toFixed(1)} m vom Damm`,
      ).toBeLessThanOrEqual(reach);
    }
    // Und der Weg kommt an.
    expect(Math.hypot(x - 0, z + 50)).toBeLessThan(6);
  });
});
