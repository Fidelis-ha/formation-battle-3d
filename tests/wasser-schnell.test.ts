/**
 * Wasser und Wellenbrecher — schnelle Fassung fuer jeden Deploy.
 *
 * Die ausfuehrlichen Partien stehen in `tests/e2e/` und laufen nur mit
 * `npm run test:full`. Damit der Deploy die Regel aus dem Auftrag trotzdem
 * prueft, steht hier eine kurze Fassung.
 *
 * WICHTIG — eine Falle, in die die erste Fassung getappt ist: Bei 240 Schritten
 * erreichte auf keiner der fuenf Karten ein Soldat das Wasser. Der Test meldete
 * dann "0 verbotene und 0 erlaubte Wasserkontakte" und war damit gruen, ohne
 * irgendetwas zu beweisen. Ein Test, der auch bei kaputter Mechanik gruen
 * bleibt, ist schlimmer als kein Test.
 *
 * Deshalb: EINE Karte, dafuer lang genug (400 Schritte), und die Zusicherung,
 * dass der Damm auch wirklich benutzt wird (`erlaubt > 0`). Erst diese
 * Zusicherung macht "kein Wasser ausserhalb des Damms" zu einer Aussage.
 *
 * Gemessen auf "Der See": bei 400 Schritten 178 Wasserkontakte, alle gedeckt.
 */

import { describe, expect, it } from 'vitest';
import { createBattle, startBattlePhase, step } from '../src/sim/battle';
import { isWater, setMap } from '../src/sim/terrain';
import { MAPS, mapById } from '../src/sim/maps';
import { bridgeAt, bridgeSpanAt } from '../src/sim/build';
import { PERSONALITIES } from '../src/sim/ai/personality';
import { assignReserve, createBrain, think } from '../src/sim/ai/brain';

/** Karte, auf der die Truppen das Wasser frueh erreichen. */
const KARTE = 'lake-pass';

/** Schritte, bis die Armeen das Wasser erreichen (gemessen: ab ~400). */
const SCHRITTE = 400;

/** Erste Wasserstelle von der Kartenmitte aus. */
function dammStelle(): { x: number; z: number } {
  // Ohne gesetzte Karte liefert `isWater` immer false — dann findet die Suche
  // nichts und der Test scheitert mit einer irrefuehrenden Meldung.
  const map = mapById(KARTE);
  if (!map) throw new Error(`Karte ${KARTE} fehlt`);
  setMap(map);
  for (let x = -40; x <= 40; x += 2) {
    for (let z = -40; z <= 40; z += 2) {
      if (isWater(x, z)) return { x, z };
    }
  }
  throw new Error('kein Wasser gefunden');
}

/** Eine Schlacht laufen lassen und Wasserkontakte zaehlen. */
function lauf(mitDamm: boolean) {
  const stelle = dammStelle();
  const b = createBattle(5, KARTE);
  b.resources.player = 0;
  b.resources.enemy = 0;
  startBattlePhase(b);
  b.aiControlled = ['player', 'enemy'];
  const ba = createBrain(PERSONALITIES[0], 'player', 5);
  const bb = createBrain(PERSONALITIES[0], 'enemy', 5);
  assignReserve(b, ba);
  assignReserve(b, bb);
  if (mitDamm) {
    b.structures.push({
      id: 9999,
      kind: 'breakwater',
      faction: 'player',
      x: stelle.x,
      z: stelle.z,
    });
  }

  let verboten = 0;
  let erlaubt = 0;
  for (let i = 0; i < SCHRITTE; i++) {
    think(b, ba);
    think(b, bb);
    step(b, 1 / 30);
    for (const p of b.platoons) {
      for (const s of p.soldiers) {
        if (s.hp <= 0 || !isWater(s.x, s.z)) continue;
        if (bridgeAt(b.structures, s.x, s.z, p.faction)) erlaubt += 1;
        else verboten += 1;
      }
    }
    if (b.status !== 'running') break;
  }
  return { verboten, erlaubt };
}

describe('Wasser ist eine Wand', () => {
  it('ohne Damm betritt kein Soldat Wasser', () => {
    const r = lauf(false);
    expect(r.verboten, `${r.verboten} Soldaten im Wasser`).toBe(0);
    expect(r.erlaubt).toBe(0);
  }, 180000);

  it('mit Damm wird Wasser nur an der Dammstelle betreten', () => {
    const r = lauf(true);
    // Der Damm muss benutzt worden sein — sonst prueft der Rest nichts.
    expect(r.erlaubt, 'der Damm wurde nicht benutzt, die Pruefung waere leer').toBeGreaterThan(0);
    // Und ausserhalb des Damms bleibt Wasser gesperrt.
    expect(r.verboten, `${r.verboten} Soldaten ausserhalb des Damms im Wasser`).toBe(0);
  }, 180000);

  it('ein Damm reicht nur von Ufer zu Ufer', () => {
    const stelle = dammStelle();
    const span = bridgeSpanAt(stelle.x, stelle.z);
    expect(span, 'kein Ufer in Reichweite').not.toBeNull();
    if (!span) return;
    // Beide Enden muessen Land sein.
    expect(isWater(span.ax, span.az)).toBe(false);
    expect(isWater(span.bx, span.bz)).toBe(false);
    // Der Damm gehoert der bauenden Seite.
    const b = createBattle(5, KARTE);
    b.structures.push({
      id: 1,
      kind: 'breakwater',
      faction: 'player',
      x: stelle.x,
      z: stelle.z,
    });
    expect(bridgeAt(b.structures, stelle.x, stelle.z, 'player')).toBe(true);
    expect(bridgeAt(b.structures, stelle.x, stelle.z, 'enemy')).toBe(false);
  });
});

describe('Zehn Karten', () => {
  it('es gibt genau zehn, jede mit eigener Eigenart', () => {
    expect(MAPS).toHaveLength(10);
    expect(new Set(MAPS.map((m) => m.id)).size).toBe(10);
    for (const m of MAPS) {
      expect(m.trait.length, `${m.id} ohne Eigenart`).toBeGreaterThan(20);
    }
  });

  it('die Gegner starten an verschiedenen Enden', () => {
    for (const m of MAPS) {
      const abstand = Math.hypot(
        m.playerStart.x - m.enemyStart.x,
        m.playerStart.z - m.enemyStart.z,
      );
      expect(abstand, `${m.id}: Startpunkte zu nah`).toBeGreaterThan(80);
    }
    // Mindestens eine Karte geht nicht Nord-Sued, sondern Ost-West — sonst
    // waeren alle zehn gleich aufgebaut.
    const ostWest = MAPS.filter((m) => Math.abs(m.playerStart.x - m.enemyStart.x) > 60);
    expect(ostWest.length, 'keine Karte mit Ost-West-Start').toBeGreaterThan(0);
  });
});
