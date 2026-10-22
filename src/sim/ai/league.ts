/**
 * KI-Liga: die zehn Spieler gegeneinander.
 *
 * Zweck: die Stufenordnung messen (Stufe N soll Stufe N-1 im Mittel schlagen)
 * und pruefen, ob aehnlich starke Spieler knapp enden. Ausserdem: ist eine
 * Paarung vorhersehbar, oder variiert sie ueber die Seeds?
 *
 * Dieses Modul ist Messwerkzeug, kein Spielbestandteil.
 */

import { createBattle, step, startBattlePhase } from '../battle';
import type { Battle, Faction } from '../types';
import { PERSONALITIES, personalityById, type Personality } from './personality';
import { assignReserve, createBrain, think, type BrainState } from './brain';

export interface MatchResult {
  winner: 'a' | 'b' | 'draw';
  /** Sekunden bis zur Entscheidung, oder null bei Zeitlimit. */
  duration: number | null;
  /** Ueberlebende Soldaten der Seite A und B. */
  aliveA: number;
  aliveB: number;
  /** Erster Angriffszeitpunkt je Seite (Eigenart-Nachweis). */
  contactA: number | null;
  contactB: number | null;
}

/** Wie lange eine Schlacht hoechstens dauern darf. */
const TIME_LIMIT = 300;
const DT = 1 / 30;

/**
 * Eine Schlacht zwischen zwei Persoenlichkeiten ausfechten.
 *
 * Beide Seiten werden von der KI gefuehrt — auch Seite A, damit die Messung
 * fair ist. Wer gegen einen Menschen spielt, ist davon nicht betroffen.
 */
export function runMatch(
  a: Personality,
  b: Personality,
  seed: number,
  options: { build?: boolean } = {},
): MatchResult {
  const battle: Battle = createBattle(seed);

  // Bauphase ueberspringen: die Liga misst das Kaempfen, nicht das Bauen.
  // Ohne Start wuerde keine Schlacht beginnen (phase bleibt 'build').
  if (options.build !== true) {
    battle.resources.player = 0;
    battle.resources.enemy = 0;
  }
  startBattlePhase(battle);

  // Beide Fraktionen einer Persoenlichkeit unterstellen. Ohne das laeuft der
  // Sockel weiter und alle zehn Spieler verhalten sich gleich — genau der
  // Fehler, der die erste Messung wertlos gemacht hat.
  battle.aiControlled = ['player', 'enemy'];

  const brainA = createBrain(a, 'player', seed);
  const brainB = createBrain(b, 'enemy', seed);

  // Reserve erst zuweisen, wenn die Truppen stehen.
  assignReserve(battle, brainA);
  assignReserve(battle, brainB);

  let t = 0;
  while (t < TIME_LIMIT && battle.status === 'running') {
    think(battle, brainA);
    think(battle, brainB);
    step(battle, DT);
    t += DT;
  }

  const aliveOf = (faction: Faction): number =>
    battle.platoons
      .filter((p) => p.faction === faction)
      .reduce((sum, p) => sum + p.aliveCount, 0);

  const aliveA = aliveOf('player');
  const aliveB = aliveOf('enemy');

  let winner: MatchResult['winner'] = 'draw';
  if (battle.status === 'victory') winner = 'a';
  else if (battle.status === 'defeat') winner = 'b';
  else if (aliveA !== aliveB) winner = aliveA > aliveB ? 'a' : 'b';

  return {
    winner,
    duration: battle.status === 'running' ? null : battle.time,
    aliveA,
    aliveB,
    contactA: brainA.firstContact,
    contactB: brainB.firstContact,
  };
}

export interface PairingStats {
  a: string;
  b: string;
  winsA: number;
  winsB: number;
  draws: number;
  /** Siegquote von A (0..1), Unentschieden halb gezaehlt. */
  rateA: number;
  /** Mittlere Dauer der entschiedenen Schlachten. */
  meanDuration: number;
  /** Mittlerer Vorsprung des Siegers in Soldaten (Knappheit). */
  meanMargin: number;
  /** Wie oft das Ergebnis auf demselben Seed gleich ausfiel (Vorhersehbarkeit). */
  predictability: number;
  contactA: number;
  contactB: number;
}

/**
 * Eine Paarung ueber viele Seeds messen.
 *
 * `predictability` ist der Anteil der Seeds, bei denen das Ergebnis dem
 * haeufigsten Ergebnis entspricht. 1,0 = vollkommen vorhersehbar,
 * 0,5 = Muenze. Ein Mensch ist nie 1,0 — er irrt sich.
 */
export function runPairing(a: Personality, b: Personality, seeds: number[]): PairingStats {
  let winsA = 0;
  let winsB = 0;
  let draws = 0;
  let durationSum = 0;
  let durationCount = 0;
  let marginSum = 0;
  let contactASum = 0;
  let contactBSum = 0;
  let contactCount = 0;
  const outcomes: string[] = [];

  for (const seed of seeds) {
    const r = runMatch(a, b, seed);
    if (r.winner === 'a') winsA += 1;
    else if (r.winner === 'b') winsB += 1;
    else draws += 1;
    outcomes.push(r.winner);

    if (r.duration !== null) {
      durationSum += r.duration;
      durationCount += 1;
      marginSum += Math.abs(r.aliveA - r.aliveB);
    }
    if (r.contactA !== null) contactASum += r.contactA;
    if (r.contactB !== null) contactBSum += r.contactB;
    if (r.contactA !== null || r.contactB !== null) contactCount += 1;
  }

  const n = seeds.length;
  const rateA = (winsA + draws * 0.5) / n;

  // Haeufigstes Ergebnis und dessen Anteil.
  const tally = new Map<string, number>();
  for (const o of outcomes) tally.set(o, (tally.get(o) ?? 0) + 1);
  const top = Math.max(...tally.values());

  return {
    a: a.id,
    b: b.id,
    winsA,
    winsB,
    draws,
    rateA,
    meanDuration: durationCount > 0 ? durationSum / durationCount : 0,
    meanMargin: durationCount > 0 ? marginSum / durationCount : 0,
    predictability: top / n,
    contactA: contactCount > 0 ? contactASum / contactCount : 0,
    contactB: contactCount > 0 ? contactBSum / contactCount : 0,
  };
}

/** Alle Paarungen der zehn Spieler. */
export function runLeague(seeds: number[]): PairingStats[] {
  const list = [...PERSONALITIES].sort((x, y) => x.level - y.level);
  const out: PairingStats[] = [];
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      out.push(runPairing(list[i], list[j], seeds));
    }
  }
  return out;
}

/** Eine Persoenlichkeit anhand der Kennung holen (Weiterleitung fuer Aufrufer). */
export { personalityById };
