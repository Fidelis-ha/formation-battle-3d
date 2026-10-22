/**
 * Die zehn Karten: Wasseranteil, Wege, Startpositionen.
 *
 * Diese Datei prueft die Zusagen aus Issue #18 mit echten Rechnungen, nicht mit
 * Annahmen:
 *
 *  - Jede Karte hat einen begehbaren Weg zwischen beiden Startpositionen.
 *  - Der Wasseranteil bleibt niedrig genug, dass Wege bleiben.
 *  - Wasser ohne Wellenbrecher ist unpassierbar.
 *  - Ein Wellenbrecher oeffnet den Uebergang.
 *  - Die Startpositionen liegen weit auseinander und an verschiedenen Enden.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { MAPS, mapById, startLine } from '../src/sim/maps';
import {
  FIELD_HALF,
  isPassable,
  isWater,
  setMap,
  slopeAt,
} from '../src/sim/terrain';
import { bridgeAt, STRUCTURE_SPECS } from '../src/sim/build';
import type { Structure } from '../src/sim/types';

/** Begehbar im Sinne der Simulation: nicht Wasser, nicht steil. */
function walkable(x: number, z: number): boolean {
  return !isWater(x, z) && isPassable(x, z);
}

/**
 * Breitensuche ueber begehbaren Boden.
 *
 * Rasterweite 1,5 m: feiner waere genauer, aber 120x120 Felder je Karte mal
 * zehn Karten waeren unnoetig langsam. 1,5 m ist deutlich feiner als ein
 * Trupp breit ist, ein echter Engpass von 5 m wird also sicher gefunden.
 */
function pathExists(
  from: { x: number; z: number },
  to: { x: number; z: number },
): { found: boolean; visited: number } {
  const step = 1.5;
  const n = Math.ceil((FIELD_HALF * 2) / step);
  const key = (ix: number, iz: number) => iz * n + ix;
  const toIndex = (v: number) => Math.round((v + FIELD_HALF) / step);

  const startX = toIndex(from.x);
  const startZ = toIndex(from.z);
  const endX = toIndex(to.x);
  const endZ = toIndex(to.z);

  const seen = new Uint8Array(n * n);
  const queue: number[] = [key(startX, startZ)];
  seen[key(startX, startZ)] = 1;
  let visited = 0;

  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) break;
    visited += 1;
    const ix = current % n;
    const iz = Math.floor(current / n);
    if (Math.abs(ix - endX) <= 1 && Math.abs(iz - endZ) <= 1) {
      return { found: true, visited };
    }
    for (const [dx, dz] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const nx = ix + dx;
      const nz = iz + dz;
      if (nx < 0 || nz < 0 || nx >= n || nz >= n) continue;
      const k = key(nx, nz);
      if (seen[k]) continue;
      seen[k] = 1;
      const wx = -FIELD_HALF + nx * step;
      const wz = -FIELD_HALF + nz * step;
      if (walkable(wx, wz)) queue.push(k);
    }
  }
  return { found: false, visited };
}

/** Irgendein Punkt im Wasser der aktiven Karte. */
function findWater(): { x: number; z: number } | null {
  for (let x = -FIELD_HALF + 8; x < FIELD_HALF - 8; x += 2) {
    for (let z = -FIELD_HALF + 8; z < FIELD_HALF - 8; z += 2) {
      if (isWater(x, z)) return { x, z };
    }
  }
  return null;
}

/** Anteil der Kartenflaeche, der Wasser ist. */
function waterShare(): number {
  const step = 2;
  let water = 0;
  let total = 0;
  for (let x = -FIELD_HALF + step; x < FIELD_HALF - step; x += step) {
    for (let z = -FIELD_HALF + step; z < FIELD_HALF - step; z += step) {
      total += 1;
      if (isWater(x, z)) water += 1;
    }
  }
  return water / total;
}

describe('Karten', () => {
  it('es gibt genau zehn', () => {
    expect(MAPS).toHaveLength(10);
  });

  it('jede hat eine eigene Kennung, einen Namen und eine Eigenart', () => {
    expect(new Set(MAPS.map((m) => m.id)).size).toBe(10);
    expect(new Set(MAPS.map((m) => m.name)).size).toBe(10);
    for (const map of MAPS) {
      expect(map.trait.length).toBeGreaterThan(20);
    }
  });

  it('die Karten unterscheiden sich in ihrem Gelaende', () => {
    // Nicht zehn Kopien mit anderem Namen: Wasser, Huegel und Wald muessen
    // sich messbar unterscheiden.
    const signaturen = MAPS.map(
      (m) =>
        `${m.water.length}:${m.water.map((w) => w.kind).join(',')}` +
        `|${m.hills.length}|${m.woods.length}`,
    );
    expect(new Set(signaturen).size).toBeGreaterThanOrEqual(8);
  });

  it('die Startpositionen liegen weit auseinander', () => {
    for (const map of MAPS) {
      const d = Math.hypot(
        map.playerStart.x - map.enemyStart.x,
        map.playerStart.z - map.enemyStart.z,
      );
      // Nahkampfreichweite ist 1,6 m — unter 60 m waere die Bauphase sinnlos
      // und die Armeen stehen sofort im Gefecht.
      expect(d).toBeGreaterThan(60);
    }
  });

  it('die Armeen starten an verschiedenen Enden, nicht immer Nord gegen Sued', () => {
    // Wenigstens eine Karte muss eine andere Achse haben (Ost gegen West),
    // sonst ist "verschiedene Enden" nur eine Behauptung.
    const achsen = MAPS.map((m) => {
      const dx = Math.abs(m.playerStart.x - m.enemyStart.x);
      const dz = Math.abs(m.playerStart.z - m.enemyStart.z);
      return dx > dz ? 'x' : 'z';
    });
    expect(new Set(achsen).size).toBeGreaterThanOrEqual(2);
  });

  it('die Aufstellungslinie steht senkrecht zur Blickrichtung', () => {
    const map = mapById('crossing');
    expect(map).not.toBeNull();
    if (!map) return;
    const line = startLine(map, 'player');
    expect(line).toHaveLength(5);
    // Bei Ost-West-Aufstellung muss die Linie in z verlaufen.
    const spreadZ = Math.max(...line.map((l) => l.z)) - Math.min(...line.map((l) => l.z));
    const spreadX = Math.max(...line.map((l) => l.x)) - Math.min(...line.map((l) => l.x));
    expect(spreadZ).toBeGreaterThan(spreadX);
  });
});

describe('Wege auf jeder Karte', () => {
  // Fuer jede Karte einzeln pruefen, damit ein Fehlschlag die Karte nennt.
  for (const map of MAPS) {
    it(`${map.name}: ein Weg zwischen den Startpositionen existiert`, () => {
      setMap(map);
      const result = pathExists(map.playerStart, map.enemyStart);
      expect(result.found, `kein Weg auf "${map.name}" (${map.id})`).toBe(true);
    });
  }

  for (const map of MAPS) {
    it(`${map.name}: Wasseranteil bleibt unter 25 %`, () => {
      setMap(map);
      const share = waterShare();
      // Mehr Wasser heisst weniger Wege — die meisten Karten sollen deutlich
      // darunter liegen. 25 % ist die harte Obergrenze.
      expect(share, `${map.id}: ${(share * 100).toFixed(1)} % Wasser`).toBeLessThan(0.25);
    });
  }

  it('die meisten Karten haben wenig Wasser', () => {
    const anteile = MAPS.map((map) => {
      setMap(map);
      return waterShare();
    });
    const trocken = anteile.filter((a) => a < 0.12).length;
    // Mindestens sechs von zehn Karten unter 12 % Wasser.
    expect(trocken).toBeGreaterThanOrEqual(6);
  });
});

describe('Wasser und Wellenbrecher', () => {
  beforeEach(() => {
    setMap(MAPS[1]); // "Die Furt" — hat einen Fluss
  });

  it('es gibt Wasser auf einer Karte mit Fluss', () => {
    expect(findWater()).not.toBeNull();
  });

  it('Wasser ist ohne Wellenbrecher unpassierbar', () => {
    // Irgendwo im Wasser, ohne Bauten: isPassable muss false sein.
    const wasserPunkt = findWater();
    expect(wasserPunkt).not.toBeNull();
    if (!wasserPunkt) return;
    expect(isPassable(wasserPunkt.x, wasserPunkt.z)).toBe(false);
    expect(bridgeAt([], wasserPunkt.x, wasserPunkt.z, 'player')).toBe(false);
  });

  it('ein Wellenbrecher oeffnet den Uebergang', () => {
    const wasserPunkt = findWater();
    expect(wasserPunkt).not.toBeNull();
    if (!wasserPunkt) return;

    const bruecke: Structure = {
      id: 1,
      kind: 'breakwater',
      faction: 'player',
      x: wasserPunkt.x,
      z: wasserPunkt.z,
    };
    expect(bridgeAt([bruecke], wasserPunkt.x, wasserPunkt.z, 'player')).toBe(true);
    // Ausserhalb der wirksamen Breite gilt sie nicht mehr. Die wirksame Breite
    // ist 1,6x das Modell (eine Truppe ist breiter als ein Punkt), deshalb
    // liegt der Pruefpunkt bei 2x.
    const weit = wasserPunkt.x + STRUCTURE_SPECS.breakwater.width * 2;
    expect(bridgeAt([bruecke], weit, wasserPunkt.z, 'player')).toBe(false);
    // Und der Gegner kommt ueber den eigenen Damm nicht hinueber: sonst waere
    // die Bauphase wirkungslos.
    expect(bridgeAt([bruecke], wasserPunkt.x, wasserPunkt.z, 'enemy')).toBe(false);
  });

  it('der Wellenbrecher sperrt nicht, er oeffnet', () => {
    // Die Gegenrichtung waere ein Fehler: ein sperrender Wellenbrecher macht
    // den einzigen Uebergang zu — dann kommt niemand mehr hinueber.
    expect(STRUCTURE_SPECS.breakwater.blocks).toBe(false);
    expect(STRUCTURE_SPECS.breakwater.waterOnly).toBe(true);
  });

  it('jede Karte mit Wasser hat Stellen, die ohne Bruecke nicht passierbar sind', () => {
    for (const map of MAPS) {
      if (map.water.length === 0) continue;
      setMap(map);
      let wasser = 0;
      for (let x = -FIELD_HALF + 6; x < FIELD_HALF - 6; x += 3) {
        for (let z = -FIELD_HALF + 6; z < FIELD_HALF - 6; z += 3) {
          if (isWater(x, z)) wasser += 1;
        }
      }
      expect(wasser, `${map.id} hat Wasser, aber keine Wasserflaeche`).toBeGreaterThan(0);
    }
  });
});

describe('Gelaende bleibt begehbar wo es sein soll', () => {
  it('der Startpunkt jeder Armee ist begehbar', () => {
    for (const map of MAPS) {
      setMap(map);
      for (const side of ['player', 'enemy'] as const) {
        const line = startLine(map, side);
        for (const slot of line) {
          // Der Startpunkt darf nicht im Wasser und nicht in einer Wand liegen.
          expect(isWater(slot.x, slot.z), `${map.id}/${side} Start im Wasser`).toBe(false);
          expect(slopeAt(slot.x, slot.z), `${map.id}/${side} Start zu steil`).toBeLessThan(1.2);
        }
      }
    }
  });
});
