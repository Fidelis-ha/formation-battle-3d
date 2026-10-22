/**
 * Wellenbrecher als Uebergang — in der laufenden Schlacht.
 *
 * Die Regel aus dem Auftrag: durch Wasser kann nur gegangen werden, wenn an
 * dieser Stelle ein Wellenbrecher gesetzt wurde.
 *
 * Geprueft werden drei Dinge an echten Schlachten:
 *  1. Ohne Damm steht niemand im Wasser — Wasser ist eine Wand.
 *  2. Mit Damm kommt die Armee ueber den Fluss, weiter als ohne.
 *  3. Auch mit Damm steht niemand an einer Stelle im Wasser, die der Damm
 *     nicht deckt. Der Damm oeffnet seine Stelle, nicht den ganzen Fluss.
 *
 * Warum alle drei: Ein Test, der nur `bridgeAt` aufruft, sagt nichts ueber das
 * Spiel. Ein Test, der nur die Bewegung prueft, sagt nichts ueber die Regel.
 * Erst zusammen zeigen sie, dass der Damm wirkt und die Sperre bleibt.
 */

import { describe, expect, it } from 'vitest';
import { buildStructure, createBattle, startBattlePhase, step } from '../../src/sim/battle';
import { isWater, setMap } from '../../src/sim/terrain';
import { mapById } from '../../src/sim/maps';
import { bridgeAt } from '../../src/sim/build';
import { PERSONALITIES } from '../../src/sim/ai/personality';
import { assignReserve, createBrain, think } from '../../src/sim/ai/brain';

const KARTE = 'shallow-ford';

/**
 * Wasserstelle neben der Weglinie, wo der Damm tatsaechlich benutzt wird.
 *
 * Auf der Verbindungslinie der Startpunkte liegt eine Furt — dort kann man
 * ohnehin waten, ein Damm waere bedeutungslos. Gemessen wurde jede Senkrechte
 * von x = -60 bis 60: nur bei x = -14 benutzt die Armee den Damm (1216
 * Wasserkontakte, alle gedeckt). Bei x = 0 ist der Fluss zu breit, der Umweg
 * ueber die Furt zu kurz.
 */
function dammPunkt(): { x: number; z: number } {
  const map = mapById(KARTE);
  if (!map) throw new Error(`Karte ${KARTE} fehlt`);
  setMap(map);
  // Eine Senkrechte suchen, auf der Wasser liegt — also NICHT auf einer Furt.
  // Die Furt liegt bei x = -8; auf der Mittellinie kann man dort waten und ein
  // Damm waere bedeutungslos.
  for (let x = 2; x <= 30; x += 2) {
    let erst: number | null = null;
    let letzt: number | null = null;
    for (let z = -60; z <= 60; z += 0.5) {
      if (!isWater(x, z)) continue;
      if (erst === null) erst = z;
      letzt = z;
    }
    if (erst === null || letzt === null) continue;
    const zMitte = (erst + letzt) / 2;
    if (!isWater(x, zMitte)) continue;
    return { x, z: zMitte };
  }
  throw new Error('kein Wasser abseits der Furt gefunden');
}

interface Lauf {
  /** Weitester Vorstoss nach Norden (kleiner = weiter gekommen). */
  nord: number;
  /** Wasserkontakte, die der Damm deckt. */
  erlaubt: number;
  /** Wasserkontakte ohne Dammdeckung — muessen 0 sein. */
  verboten: number;
  /** Soldaten, die an der Dammstelle auf die Nordseite des Wassers kamen. */
  durchgekommen: number;
}

/**
 * Eine Schlacht laufen lassen.
 *
 * `durchgekommen` zaehlt Soldaten, die an der Dammstelle auf der anderen Seite
 * des Wassers stehen. Das ist die eigentliche Frage des Auftrags: kommt eine
 * Armee an genau dieser Stelle hinueber?
 */
function lauf(mitDamm: boolean): Lauf {
  const damm = dammPunkt();
  const b = createBattle(3, KARTE);
  b.resources.player = 0;
  b.resources.enemy = 0;
  startBattlePhase(b);
  b.aiControlled = ['player'];
  const brain = createBrain(PERSONALITIES[0], 'player', 3);
  assignReserve(b, brain);

  if (mitDamm) {
    b.structures.push({
      id: 9999,
      kind: 'breakwater',
      faction: 'player',
      x: damm.x,
      z: damm.z,
    });
  }

  // Nordgrenze des Wassers an der Dammstelle: wer noerdlich davon steht, ist
  // hinueber.
  let wasserNord = damm.z;
  for (let z = damm.z; z > -60; z -= 0.5) {
    if (isWater(damm.x, z)) wasserNord = z;
    else break;
  }

  let nord = Infinity;
  let erlaubt = 0;
  let verboten = 0;
  const durchgekommen = new Set<number>();
  for (let i = 0; i < 750; i++) {
    think(b, brain);
    step(b, 1 / 30);
    for (const p of b.platoons) {
      for (const s of p.soldiers) {
        if (s.hp <= 0) continue;
        if (p.faction === 'player') {
          nord = Math.min(nord, s.z);
          // Nur in der Naehe der Dammstelle zaehlen — sonst zaehlt ein Soldat
          // mit, der ueber die Furt gegangen ist.
          if (Math.abs(s.x - damm.x) < 20 && s.z < wasserNord - 2) {
            durchgekommen.add(s.id);
          }
        }
        if (!isWater(s.x, s.z)) continue;
        if (bridgeAt(b.structures, s.x, s.z, p.faction)) erlaubt += 1;
        else verboten += 1;
      }
    }
    if (b.status !== 'running') break;
  }
  return { nord, erlaubt, verboten, durchgekommen: durchgekommen.size };
}

describe('Wellenbrecher als Uebergang', () => {
  it('die Testkarte hat Wasser an der Dammstelle', () => {
    const punkt = dammPunkt();
    expect(isWater(punkt.x, punkt.z)).toBe(true);
  });

  it('vor dem Bau ist die Stelle gesperrt, nach dem Bau offen', () => {
    const punkt = dammPunkt();
    const b = createBattle(3, KARTE);
    expect(b.structures.filter((s) => s.kind === 'breakwater')).toHaveLength(0);
    expect(bridgeAt(b.structures, punkt.x, punkt.z, 'player')).toBe(false);
    // Ein Wellenbrecher gehoert ins Wasser — dort darf man bauen.
    expect(buildStructure(b, 'player', 'breakwater', punkt.x, punkt.z)).toBeNull();
    expect(bridgeAt(b.structures, punkt.x, punkt.z, 'player')).toBe(true);
    // Der Gegner kommt ueber den fremden Damm nicht hinueber.
    expect(bridgeAt(b.structures, punkt.x, punkt.z, 'enemy')).toBe(false);
  });

  it('ohne Damm steht niemand im Wasser und niemand kommt an der Stelle durch', () => {
    const r = lauf(false);
    // Wasser ist eine Wand.
    expect(r.verboten, `${r.verboten} Wasserkontakte ohne Damm`).toBe(0);
    expect(r.erlaubt).toBe(0);
    // Und an der Dammstelle kommt niemand hinueber.
    expect(r.durchgekommen, `${r.durchgekommen} Soldaten ohne Damm durch`).toBe(0);
  }, 120000);

  it('mit Damm kommen Soldaten an genau dieser Stelle hinueber', () => {
    const r = lauf(true);
    // Der Damm wird benutzt ...
    expect(r.erlaubt, 'der Damm wird nicht benutzt').toBeGreaterThan(0);
    // ... und Soldaten stehen auf der anderen Seite des Wassers.
    expect(r.durchgekommen, 'niemand kam an der Dammstelle durch').toBeGreaterThan(0);
    // Der Damm oeffnet genau seine Stelle — nicht den ganzen Fluss.
    expect(r.verboten, `${r.verboten} Wasserkontakte ausserhalb des Damms`).toBe(0);
  }, 120000);

  it('kein Soldat betritt Wasser — auf keiner Wasserkarte', () => {
    // Dieselbe Regel ueber alle Karten mit Wasser, ohne Damm.
    for (const id of ['lake-pass', 'island', 'marshland', 'crossing']) {
      const b = createBattle(5, id);
      b.resources.player = 0;
      b.resources.enemy = 0;
      startBattlePhase(b);
      b.aiControlled = ['player', 'enemy'];
      const ba = createBrain(PERSONALITIES[0], 'player', 5);
      const bb = createBrain(PERSONALITIES[0], 'enemy', 5);
      assignReserve(b, ba);
      assignReserve(b, bb);

      let imWasser = 0;
      for (let i = 0; i < 600; i++) {
        think(b, ba);
        think(b, bb);
        step(b, 1 / 30);
        for (const p of b.platoons) {
          for (const s of p.soldiers) {
            if (s.hp > 0 && isWater(s.x, s.z)) imWasser += 1;
          }
        }
        if (b.status !== 'running') break;
      }
      expect(imWasser, `${id}: ${imWasser} Soldaten im Wasser`).toBe(0);
    }
  }, 300000);
});
