/**
 * Messwerkzeug: vollstandige Liga der zehn KI-Spieler.
 *
 * Aufruf: npx vite-node scripts/ai-liga.ts [seeds]
 *
 * Gibt eine JSON-Datei mit allen Paarungen aus, damit die Zahlen weiterverarbeitet
 * werden koennen, ohne sie aus Testausgaben zu klauben.
 */

import { writeFileSync } from 'node:fs';
import { runMatch } from '../src/sim/ai/league';
import { PERSONALITIES } from '../src/sim/ai/personality';

const SEEDS = [1, 7, 13, 42, 77, 99, 123, 500];
const OUT = '/opt/data/cache/scratch/ai-liga.json';

interface Row {
  a: string;
  b: string;
  winsA: number;
  winsB: number;
  draws: number;
  durations: number[];
  margins: number[];
  contactA: number[];
  contactB: number[];
  outcomes: string[];
}

const list = [...PERSONALITIES].sort((x, y) => x.level - y.level);
const rows: Row[] = [];

const started = Date.now();

for (let i = 0; i < list.length; i++) {
  for (let j = i + 1; j < list.length; j++) {
    const a = list[i];
    const b = list[j];
    const row: Row = {
      a: a.id,
      b: b.id,
      winsA: 0,
      winsB: 0,
      draws: 0,
      durations: [],
      margins: [],
      contactA: [],
      contactB: [],
      outcomes: [],
    };
    for (const seed of SEEDS) {
      const r = runMatch(a, b, seed);
      if (r.winner === 'a') row.winsA += 1;
      else if (r.winner === 'b') row.winsB += 1;
      else row.draws += 1;
      row.outcomes.push(r.winner);
      if (r.duration !== null) {
        row.durations.push(r.duration);
        row.margins.push(Math.abs(r.aliveA - r.aliveB));
      }
      if (r.contactA !== null) row.contactA.push(r.contactA);
      if (r.contactB !== null) row.contactB.push(r.contactB);
    }
    rows.push(row);
    const rate = (row.winsA + row.draws * 0.5) / SEEDS.length;
    console.log(
      `${a.id.padEnd(12)} vs ${b.id.padEnd(12)} ${(rate * 100).toFixed(0).padStart(3)}%  ` +
        `(${((Date.now() - started) / 1000).toFixed(0)}s)`,
    );
  }
}

// Rangliste: Siegquote je Spieler ueber alle Paarungen.
const table = new Map<string, { wins: number; played: number }>();
for (const p of list) table.set(p.id, { wins: 0, played: 0 });
for (const r of rows) {
  const sa = table.get(r.a);
  const sb = table.get(r.b);
  if (!sa || !sb) continue;
  const n = r.winsA + r.winsB + r.draws;
  sa.played += n;
  sb.played += n;
  sa.wins += r.winsA + r.draws * 0.5;
  sb.wins += r.winsB + r.draws * 0.5;
}

const ranking = [...table.entries()]
  .map(([id, v]) => ({
    id,
    level: list.find((p) => p.id === id)?.level ?? 0,
    quote: v.played > 0 ? v.wins / v.played : 0,
    wins: v.wins,
    played: v.played,
  }))
  .sort((x, y) => y.quote - x.quote);

writeFileSync(
  OUT,
  JSON.stringify(
    {
      seeds: SEEDS,
      rows: rows.map((r) => ({
        ...r,
        meanDuration: r.durations.length ? r.durations.reduce((s, v) => s + v, 0) / r.durations.length : 0,
        meanMargin: r.margins.length ? r.margins.reduce((s, v) => s + v, 0) / r.margins.length : 0,
        meanContactA: r.contactA.length ? r.contactA.reduce((s, v) => s + v, 0) / r.contactA.length : 0,
        meanContactB: r.contactB.length ? r.contactB.reduce((s, v) => s + v, 0) / r.contactB.length : 0,
      })),
      ranking,
    },
    null,
    2,
  ),
);

console.log('\n--- Rangliste ---');
for (const r of ranking) {
  console.log(`  L${String(r.level).padStart(2)} ${r.id.padEnd(12)} ${(r.quote * 100).toFixed(0).padStart(3)}%`);
}
console.log(`\nGeschrieben: ${OUT}  (${((Date.now() - started) / 1000).toFixed(0)}s)`);
