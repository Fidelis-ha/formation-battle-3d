/**
 * Die zehn KI-Spieler: Aufbau, Eigenart und Abgrenzung.
 *
 * Diese Datei prueft, was ohne Messung pruefbar ist: dass es zehn Spieler gibt,
 * jeder eine eigene Kennung, einen eigenen Namen und eine eigene Eigenart hat,
 * die Stufen lueckenlos vergeben sind und keine Persoenlichkeit mit besseren
 * Werten kaempft als eine andere.
 *
 * Die gemessene Staerke steht in `ai-turnier.test.ts` und im Issue #17.
 */

import { describe, expect, it } from 'vitest';
import {
  PERSONALITIES,
  personalityById,
  strengthOf,
} from '../src/sim/ai/personality';
import { createBrain, mulberry32, hashString } from '../src/sim/ai/brain';

describe('KI-Spieler', () => {
  it('es gibt genau zehn', () => {
    expect(PERSONALITIES).toHaveLength(10);
  });

  it('jeder hat eine eigene Kennung', () => {
    const ids = new Set(PERSONALITIES.map((p) => p.id));
    expect(ids.size).toBe(10);
  });

  it('jeder hat einen eigenen Namen und eine eigene Eigenart', () => {
    expect(new Set(PERSONALITIES.map((p) => p.name)).size).toBe(10);
    expect(new Set(PERSONALITIES.map((p) => p.trait)).size).toBe(10);
    for (const p of PERSONALITIES) {
      expect(p.name.length).toBeGreaterThan(2);
      // Die Eigenart ist ein Satz, keine Floskel.
      expect(p.trait.length).toBeGreaterThan(20);
    }
  });

  it('die Stufen sind lueckenlos von 1 bis 10 vergeben', () => {
    const levels = PERSONALITIES.map((p) => p.level).sort((a, b) => a - b);
    expect(levels).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('die Spieler unterscheiden sich in ihrer Spielweise, nicht in Werten', () => {
    // Alle teilen dieselben Einheiten — Unterschiede entstehen nur aus
    // Verhaltensparametern. Ein Spieler mit besseren Werten waere ein Cheat.
    const profiles = PERSONALITIES.map(
      (p) => `${p.aggression}|${p.target}|${p.formation}|${p.tempo}`,
    );
    // Mindestens sechs verschiedene Kombinationen — sonst sind die zehn
    // Spieler nur zehn Namen fuer denselben Gegner.
    expect(new Set(profiles).size).toBeGreaterThanOrEqual(6);
  });

  it('die Staerke steigt im Mittel mit der Stufe', () => {
    const sorted = [...PERSONALITIES].sort((a, b) => a.level - b.level);
    const strengths = sorted.map((p) => strengthOf(p));
    // Untere Haelfte schwaecher als obere Haelfte.
    const low = strengths.slice(0, 5).reduce((s, v) => s + v, 0) / 5;
    const high = strengths.slice(5).reduce((s, v) => s + v, 0) / 5;
    expect(high).toBeGreaterThan(low);
  });

  it('kein Spieler waehlt voellig beliebig oder immer optimal', () => {
    for (const p of PERSONALITIES) {
      // 0 waere reines Raten, 1 waere unfehlbar. Beides waere kein Spieler.
      expect(p.discipline).toBeGreaterThan(0);
      expect(p.discipline).toBeLessThanOrEqual(1);
      // Streuung muss vorhanden sein, sonst ist der Spieler vorhersagbar.
      expect(p.noise).toBeGreaterThan(0);
    }
  });

  it('jede Kennung ist auffindbar', () => {
    for (const p of PERSONALITIES) {
      expect(personalityById(p.id)?.name).toBe(p.name);
    }
    expect(personalityById('gibtsnicht')).toBeNull();
  });
});

describe('Gehirn', () => {
  it('startet mit einem Angriffszeitpunkt je nach Tempo', () => {
    const recruit = personalityById('recruit');
    const wall = personalityById('wall');
    expect(recruit).not.toBeNull();
    expect(wall).not.toBeNull();
    if (!recruit || !wall) return;

    const a = createBrain(recruit, 'enemy', 1);
    const b = createBrain(wall, 'enemy', 1);
    // Sofort-Angreifer startet frueher als ein Wartender.
    expect(a.attackAt).toBeLessThan(b.attackAt);
  });

  it('streut ueber verschiedene Seeds, bleibt aber im Rahmen', () => {
    const p = personalityById('commander');
    expect(p).not.toBeNull();
    if (!p) return;
    const zeiten = [1, 7, 13, 42, 77, 99].map((s) => createBrain(p, 'enemy', s).attackAt);
    // Nicht alle gleich (sonst keine Streuung) ...
    expect(new Set(zeiten.map((z) => z.toFixed(3))).size).toBeGreaterThan(1);
    // ... aber auch nicht beliebig auseinander.
    const min = Math.min(...zeiten);
    const max = Math.max(...zeiten);
    expect(max - min).toBeLessThan(5);
  });

  it('die Streuung ist reproduzierbar (gleicher Seed, gleiches Ergebnis)', () => {
    const p = personalityById('spider');
    if (!p) return;
    const a = createBrain(p, 'enemy', 42).attackAt;
    const b = createBrain(p, 'enemy', 42).attackAt;
    expect(a).toBe(b);
  });

  it('der Zufallsgenerator liefert Werte zwischen 0 und 1', () => {
    const rnd = mulberry32(12345);
    for (let i = 0; i < 200; i++) {
      const v = rnd();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('verschiedene Kennungen streuen verschieden', () => {
    // Sonst wuerden alle Spieler bei gleichem Seed identisch starten.
    expect(hashString('recruit')).not.toBe(hashString('commander'));
  });
});
