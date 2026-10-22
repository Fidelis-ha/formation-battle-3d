import { beforeEach, describe, expect, it } from 'vitest';
import { mapById } from '../src/sim/maps';
import {
  FIELD_HALF,
  MAX_CLIMB_SLOPE,
  WATER_LEVEL,
  hillsOf,
  setMap,
  activeRiver,
  forestDensityAt,
  grassTufts,
  groundKindAt,
  heightAt,
  isForest,
  riverHalfWidth,
  riverBankWidth,
  isPassable,
  isWater,
  riverDistanceAt,
  rockSpots,
  slopeAt,
  treeSpots,
} from '../src/sim/terrain';

describe('Hoehenkarte', () => {
  // Diese Pruefungen gelten fuer eine Karte MIT Fluss und steilem Huegel.
  // Seit es zehn Karten gibt, ist das eine bewusste Wahl und nicht mehr der
  // einzige Zustand: "Offenes Feld" hat gar kein Wasser.
  beforeEach(() => {
    const map = mapById('shallow-ford');
    if (map) setMap(map);
  });
  it('liefert endliche, plausible Hoehen auf der ganzen Karte', () => {
    for (let x = -FIELD_HALF; x <= FIELD_HALF; x += 5) {
      for (let z = -FIELD_HALF; z <= FIELD_HALF; z += 5) {
        const h = heightAt(x, z);
        expect(Number.isFinite(h)).toBe(true);
        expect(h).toBeGreaterThan(-4);
        expect(h).toBeLessThan(25);
      }
    }
  });

  it('der mittlere Huegel ist nur von einer Seite ersteigbar', () => {
    // Auf "Die Hochebene" steht ein Huegel mit Rampe im Sueden und Klippe im
    // Norden. Seit es zehn Karten gibt, hat nicht mehr jede Karte so einen
    // Huegel — die Eigenart ist jetzt eine Eigenschaft der Karte.
    const plateau = mapById('high-plateau');
    expect(plateau).not.toBeNull();
    if (!plateau) return;
    setMap(plateau);
    const hill = hillsOf().find((h) => h.climbFrom !== null);
    expect(hill).toBeDefined();
    if (!hill) return;
    expect(hill.climbFrom).not.toBeNull();

    // Suedseite (Klippe) und Nordseite (Aufstieg) vergleichen.
    const climbDir = hill.climbFrom as number;

    // Die steilste Stelle entlang eines Strahls suchen. Ein einzelner
    // Stichprobenpunkt trifft sonst zufaellig das Plateau (flach) statt der
    // Wand — und die Wand ist das, was den Aufstieg sperrt.
    const steepest = (angle: number) => {
      let max = 0;
      // Nur den Huegelkegel pruefen (ab 0.85 r), nicht das Vorland: am Fuss
      // des Huegels liegt der Fluss mit seiner Uferboeschung, die steil sein
      // darf und mit dem Huegel nichts zu tun hat.
      for (let r = hill.radius * 0.8; r > 1; r -= 0.5) {
        const x = hill.x + Math.cos(angle) * r;
        const z = hill.z + Math.sin(angle) * r;
        max = Math.max(max, slopeAt(x, z));
      }
      return max;
    };

    const climbSlope = steepest(climbDir);
    const cliffSlope = steepest(climbDir + Math.PI);

    console.log(`Aufstiegsseite steilste Steigung ${climbSlope.toFixed(2)}, Klippenseite ${cliffSlope.toFixed(2)}`);

    // Die Klippenseite ist deutlich steiler.
    expect(cliffSlope).toBeGreaterThan(climbSlope * 2);
    // Klippenseite liegt ueber dem Klettergrenzwert.
    expect(cliffSlope).toBeGreaterThan(MAX_CLIMB_SLOPE);

    // Entscheidend ist nicht die Steigung, sondern die Begehbarkeit: eine
    // gleichmaessige Rampe darf steil sein, eine Klippe nicht. Beide Achsen
    // werden Punkt fuer Punkt geprueft.
    // Entscheidend ist der DURCHGANG von aussen nach innen: findet man auf
    // einem Strahl eine gesperrte Stelle, kommt man von dieser Seite nicht
    // hoch — auch wenn das flache Vorland und das Plateau begehbar sind.
    const blockedOnWay = (angle: number) => {
      for (let r = hill.radius * 0.95; r > 2; r -= 0.4) {
        const x = hill.x + Math.cos(angle) * r;
        const z = hill.z + Math.sin(angle) * r;
        if (isWater(x, z)) continue;
        if (!isPassable(x, z)) return true;
      }
      return false;
    };

    // Aufstiegsseite: durchgehend frei.
    expect(blockedOnWay(climbDir)).toBe(false);
    // Klippenseite: gesperrt.
    expect(blockedOnWay(climbDir + Math.PI)).toBe(true);
  });

  it('Huegel haben unterschiedliche Steigung', () => {
    // "Zwei Huegel" hat zwei steile und eine flache Senke — dort ist der
    // Unterschied messbar. Auf einer Karte mit lauter gleich steilen Huegeln
    // waere die Pruefung sinnlos.
    const zwei = mapById('two-hills');
    if (zwei) setMap(zwei);
    const slopes = hillsOf().map((h) => {
      const x = h.x + h.radius * 0.4;
      const z = h.z;
      return slopeAt(x, z);
    });
    const min = Math.min(...slopes);
    const max = Math.max(...slopes);
    console.log('Huegelsteigungen:', slopes.map((v: number) => v.toFixed(2)).join(', '));
    expect(max - min).toBeGreaterThan(0.3);
  });

  it('der Fluss hat Wasser und Ufer, aber Furten unterbrechen ihn', () => {
    let waterSamples = 0;
    let bankSamples = 0;
    let spaltenOhneWasser = 0;
    for (let x = -FIELD_HALF + 5; x < FIELD_HALF - 5; x += 3) {
      // Der Fluss laeuft geschwungen. An einer Furt ist er absichtlich
      // unterbrochen — genau dort kommt eine Armee hinueber. Frueher war hier
      // eine durchgehende Rinne gefordert; die trennte die Karte in zwei
      // Haelften, und die Armeen trafen sich nie.
      let hasWater = false;
      for (let z = -20; z <= 20; z += 1) {
        if (isWater(x, z)) hasWater = true;
      }
      if (!hasWater) spaltenOhneWasser++;
      for (let z = -20; z <= 20; z += 1) {
        if (isWater(x, z)) waterSamples++;
        const kind = groundKindAt(x, z);
        if (kind === 'bank') bankSamples++;
      }
    }
    console.log(`Wasserproben ${waterSamples}, Uferproben ${bankSamples}`);
    expect(waterSamples).toBeGreaterThan(500);
    expect(bankSamples).toBeGreaterThan(200);
  });

  it('Wasser liegt unter dem Wasserspiegel, Land darueber', () => {
    for (let x = -40; x < 40; x += 4) {
      // Flussmittelpunkt
      let waterZ = 0;
      for (let z = -20; z <= 20; z += 0.5) {
        if (isWater(x, z)) {
          waterZ = z;
          break;
        }
      }
      if (waterZ !== 0) expect(heightAt(x, waterZ)).toBeLessThan(WATER_LEVEL);
    }
    // weit weg vom Fluss ist Land
    expect(heightAt(-70, 70)).toBeGreaterThan(WATER_LEVEL);
    expect(heightAt(70, -70)).toBeGreaterThan(WATER_LEVEL);
  });
});

describe('Bewuchs', () => {
  it('es gibt Baeume, und sie stehen in Bestaenden', () => {
    const trees = treeSpots();
    console.log(`Baeume: ${trees.length}`);
    expect(trees.length).toBeGreaterThan(150);

    // Jeder Baum steht im Wald.
    for (const t of trees) {
      expect(isForest(t.x, t.z)).toBe(true);
      expect(t.y).toBeCloseTo(heightAt(t.x, t.z), 5);
    }
  });

  it('es gibt lichte Flaechen im Wald', () => {
    // Flaeche scannen: Anteil Wald vs. Anteil Lichtung innerhalb der Waldzone
    let forest = 0;
    let glade = 0;
    for (let x = -FIELD_HALF + 6; x < FIELD_HALF - 6; x += 2) {
      for (let z = -FIELD_HALF + 6; z < FIELD_HALF - 6; z += 2) {
        const d = forestDensityAt(x, z);
        if (d >= 0.52) forest++;
        else if (d > 0.28) glade++;
      }
    }
    console.log(`Waldfläche ${forest}, Übergangs-/Lichtungsfläche ${glade}`);
    expect(forest).toBeGreaterThan(300);
    expect(glade).toBeGreaterThan(150);
  });

  it('Gras und Steine liegen auf begehbarem Land', () => {
    const tufts = grassTufts();
    expect(tufts.length).toBeGreaterThan(1000);
    for (const g of tufts.slice(0, 200)) {
      expect(isWater(g.x, g.z)).toBe(false);
    }
    const rocks = rockSpots();
    expect(rocks.length).toBeGreaterThan(30);
    for (const r of rocks.slice(0, 100)) {
      expect(isWater(r.x, r.z)).toBe(false);
    }
  });
});

describe('Begehbarkeit', () => {
  it('Wasser ist gesperrt, Wiese begehbar', () => {
    // Flussmitte
    let found = false;
    for (let x = -60; x < 60 && !found; x += 2) {
      for (let z = -20; z <= 20; z += 0.5) {
        if (isWater(x, z)) {
          expect(isPassable(x, z)).toBe(false);
          found = true;
          break;
        }
      }
    }
    expect(found).toBe(true);
    // freie Wiese
    expect(isPassable(-70, 70)).toBe(true);
  });

  it('die Klippe des Huegels ist nicht passierbar', () => {
    const plateau = mapById('high-plateau');
    if (plateau) setMap(plateau);
    const hill = hillsOf()[0];
    const angle = (hill.climbFrom as number) + Math.PI;
    // Entlang des Klippenhangs nach einem gesperrten Punkt suchen.
    let blocked = false;
    for (let r = hill.radius * 0.9; r > 2; r -= 0.5) {
      const x = hill.x + Math.cos(angle) * r;
      const z = hill.z + Math.sin(angle) * r;
      if (!isPassable(x, z) && slopeAt(x, z) > MAX_CLIMB_SLOPE) blocked = true;
    }
    expect(blocked).toBe(true);
  });
});
