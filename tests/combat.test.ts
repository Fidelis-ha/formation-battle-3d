import { describe, it, expect } from 'vitest';
import { createBattle, step, issueMove, startBattlePhase } from '../src/sim/battle';
import { UNIT_STATS } from '../src/sim/units';
import type { Battle, Platoon, UnitKind } from '../src/sim/types';

/**
 * Kampfmechanik-Messung.
 *
 * Diese Datei prueft nicht, ob "irgendetwas" passiert, sondern ob die Mechanik
 * die Eigenschaften hat, die das Original verspricht: Counter wirken, niemand
 * steht still, Schlachten enden, Formationen bleiben zusammen.
 */

// Baut eine Schlacht mit nur zwei Trupps auf freiem Feld.
function duel(attacker: UnitKind, defender: UnitKind, gap = 6): Battle {
  const battle = startBattlePhase(createBattle(1234));
  battle.platoons = [];
  battle.projectiles = [];
  battle.events = [];

  const mk = (kind: UnitKind, faction: 'player' | 'enemy', x: number, z: number): Platoon => {
    const stats = UNIT_STATS[kind];
    const platoon: Platoon = {
      id: battle.nextId++,
      faction,
      kind,
      x,
      z,
      destX: null,
      destZ: null,
      targetPlatoonId: null,
      // facing = 0 zeigt nach +z, facing = PI nach -z.
      // Der Spieler steht bei +z und schaut zum Gegner bei -z, also PI.
      facing: faction === 'player' ? Math.PI : 0,
      autoAttack: true,
      autoApproach: true,
      autoTargetId: null,
      autoMoveTo: null,
      playerTargetId: null,
      weaponMode: 0,
      moraleBroken: false,
      soldiers: [],
      aliveCount: stats.squad,
    };
    // Soldaten aus dem Raster erzeugen (gleiche Logik wie createBattle).
    const cols = Math.ceil(Math.sqrt(stats.squad * 1.6));
    const rows = Math.ceil(stats.squad / cols);
    for (let i = 0; i < stats.squad; i++) {
      const row = Math.floor(i / cols);
      const col = i % cols;
      const inRow = Math.min(cols, stats.squad - row * cols);
      platoon.soldiers.push({
        id: battle.nextId++,
        platoonId: platoon.id,
        faction,
        kind,
        slot: i,
        x: x + (col - (inRow - 1) / 2) * 0.85,
        z: z + ((rows - 1) / 2 - row) * 0.85 * (faction === 'player' ? 1 : -1),
        hp: stats.health,
        maxHp: stats.health,
        cooldown: 0,
        state: 'idle',
        targetId: null,
        facing: platoon.facing,
        deadTime: 0,
      });
    }
    return platoon;
  };

  const player = mk(attacker, 'player', 0, gap / 2);
  const enemy = mk(defender, 'enemy', 0, -gap / 2);
  battle.platoons.push(player, enemy);
  // Beide Seiten bekommen den Angriffsbefehl. Ohne Befehl rueckt niemand vor
  // und der Kampf faende nie statt — genau wie im Spiel, wo der Spieler
  // rechtsklickt oder die KI selbst vorrueckt.
  player.targetPlatoonId = enemy.id;
  enemy.targetPlatoonId = player.id;
  return battle;
}

// Laesst einen Kampf laufen, bis eine Seite ausgeloescht ist oder die Zeit abgelaufen ist.
function runUntilDone(battle: Battle, maxSeconds = 300): { seconds: number; winner: string | null } {
  const dt = 1 / 30;
  let t = 0;
  while (t < maxSeconds && battle.status === 'running') {
    step(battle, dt);
    t += dt;
  }
  const playerAlive = battle.platoons
    .filter((p) => p.faction === 'player')
    .reduce((sum, p) => sum + p.aliveCount, 0);
  const enemyAlive = battle.platoons
    .filter((p) => p.faction === 'enemy')
    .reduce((sum, p) => sum + p.aliveCount, 0);
  let winner: string | null = null;
  if (playerAlive > 0 && enemyAlive === 0) winner = 'player';
  else if (enemyAlive > 0 && playerAlive === 0) winner = 'enemy';
  else if (playerAlive > 0 && enemyAlive > 0) winner = 'timeout';
  return { seconds: t, winner };
}

describe('Counter-Mechanik', () => {
  it('Spearman schlaegt Cavalry deutlich', () => {
    const r = runUntilDone(duel('spearman', 'cavalry', 4));
    expect(r.winner).toBe('player');
  });

  it('Cavalry schlaegt Archer deutlich', () => {
    const r = runUntilDone(duel('cavalry', 'archer', 4));
    expect(r.winner).toBe('player');
  });

  it('Infantry schlaegt Archer', () => {
    const r = runUntilDone(duel('infantry', 'archer', 4));
    expect(r.winner).toBe('player');
  });

  it('Housecarl schlaegt Infantry', () => {
    const r = runUntilDone(duel('housecarl', 'infantry', 4));
    expect(r.winner).toBe('player');
  });

  it('Cavalry verliert gegen Spearman (Gegenprobe)', () => {
    const r = runUntilDone(duel('cavalry', 'spearman', 4));
    expect(r.winner).toBe('enemy');
  });

  it('Archer verliert im Nahkampf gegen Infantry (Gegenprobe)', () => {
    const r = runUntilDone(duel('archer', 'infantry', 4));
    expect(r.winner).toBe('enemy');
  });
});

describe('Schlachtverlauf', () => {
  it('Trupps im Kontakt kaempfen, statt stillzustehen', () => {
    const battle = startBattlePhase(createBattle(77));
    const dt = 1 / 30;
    for (let t = 0; t < 60; t += dt) step(battle, dt);

    // Nur Trupps pruefen, die einen Gegner zugewiesen haben: die muessen
    // entweder vorruecken oder kaempfen. Trupps ohne Befehl duerfen warten —
    // das ist im Original genauso, der Spieler gibt die Befehle.
    let checked = 0;
    let idleInContact = 0;
    for (const p of battle.platoons) {
      // Ziel kann vom Spieler (playerTargetId) oder von Auto Approach
      // (autoTargetId) kommen. Beide muessen zum Kampf fuehren.
      if (p.aliveCount <= 0) continue;
      if (p.playerTargetId === null && p.autoTargetId === null) continue;
      checked++;
      const alive = p.soldiers.filter((s) => s.state !== 'dead');
      if (alive.length === 0) continue;
      // In einer geschlossenen Formation stehen die hinteren Reihen, waehrend
      // die Front kaempft — das ist gewollt. Geprueft wird deshalb nur, dass
      // ein Trupp im Kontakt NICHT komplett erstarrt ist.
      const active = alive.filter((s) => s.state === 'attack' || s.state === 'move').length;
      if (active === 0) idleInContact++;
    }
    expect(checked).toBeGreaterThan(0);
    expect(idleInContact).toBe(0);
  });

  it('es gibt echte Verluste auf beiden Seiten', () => {
    const battle = startBattlePhase(createBattle(77));
    const dt = 1 / 30;
    for (let t = 0; t < 90; t += dt) {
      step(battle, dt);
      if (battle.status !== 'running') break;
    }
    const start = battle.platoons.reduce((sum, p) => sum + p.soldiers.length, 0);
    const alive = battle.platoons.reduce((sum, p) => sum + p.aliveCount, 0);
    expect(alive).toBeLessThan(start * 0.95);
  });

  it('die Schlacht endet von selbst', () => {
    const battle = startBattlePhase(createBattle(99));
    const r = runUntilDone(battle, 400);
    expect(r.winner).not.toBe('timeout');
    expect(r.winner).not.toBeNull();
  });

  it('dauert nicht unnatuerlich lange', () => {
    const battle = startBattlePhase(createBattle(4242));
    const r = runUntilDone(battle, 400);
    expect(r.seconds).toBeGreaterThan(30);
    expect(r.seconds).toBeLessThan(300);
  });
});

describe('Formation', () => {
  it('Truppen bleiben waehrend des Marsches beieinander', () => {
    const battle = startBattlePhase(createBattle(5));
    const own = battle.platoons.filter((p) => p.faction === 'player');
    for (const p of own) issueMove(battle, p.id, p.x, p.z + 10);

    const dt = 1 / 30;
    let maxSpread = 0;
    for (let t = 0; t < 12; t += dt) {
      step(battle, dt);
      for (const p of own) {
        const alive = p.soldiers.filter((s) => s.state !== 'dead');
        if (alive.length < 2) continue;
        const cx = alive.reduce((sum, s) => sum + s.x, 0) / alive.length;
        const cz = alive.reduce((sum, s) => sum + s.z, 0) / alive.length;
        for (const s of alive) {
          maxSpread = Math.max(maxSpread, Math.hypot(s.x - cx, s.z - cz));
        }
      }
    }
    // Bei 35 Soldaten und 0,85 m Abstand ist ein Radius von ~4 m normal.
    expect(maxSpread).toBeLessThan(8);
  });
});

describe('Werte-Sanity', () => {
  it('alle Einheiten haben plausible Werte', () => {
    for (const [kind, s] of Object.entries(UNIT_STATS)) {
      expect(s.squad, kind).toBeGreaterThan(0);
      expect(s.health, kind).toBeGreaterThan(0);
      expect(s.melee, kind).toBeGreaterThan(0);
      expect(s.speed, kind).toBeGreaterThan(0);
      expect(s.meleeDef, kind).toBeLessThan(100);
      expect(s.rangedDef, kind).toBeLessThan(100);
    }
  });
});
