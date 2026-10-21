import { describe, expect, it } from 'vitest';
import { createBattle, drainEvents, step, DAMAGE_SCALE } from '../src/sim/battle';
import { formationSlots, formationWidth } from '../src/sim/formation';
import type { Battle, Soldier } from '../src/sim/types';
import { counterMultiplier } from '../src/sim/units';

function totalHp(battle: Battle): number {
  let sum = 0;
  for (const platoon of battle.platoons) {
    for (const soldier of platoon.soldiers) sum += Math.max(0, soldier.hp);
  }
  return sum;
}

function soldierById(battle: Battle, id: number): Soldier | undefined {
  for (const platoon of battle.platoons) {
    const found = platoon.soldiers.find((s) => s.id === id);
    if (found) return found;
  }
  return undefined;
}

function rotate(x: number, z: number, facing: number): { x: number; z: number } {
  const c = Math.cos(facing);
  const s = Math.sin(facing);
  return { x: x * c + z * s, z: -x * s + z * c };
}

describe('counterMultiplier', () => {
  it('bildet die Matrix aus SPEC Abschnitt 3 ab', () => {
    expect(counterMultiplier('spearman', 'cavalry')).toBe(3.0);
    expect(counterMultiplier('cavalry', 'archer')).toBe(2.5);
    expect(counterMultiplier('cavalry', 'housecarl')).toBe(1.6);
    expect(counterMultiplier('archer', 'housecarl')).toBe(0.7);
    expect(counterMultiplier('archer', 'cavalry')).toBe(1.2);
    expect(counterMultiplier('infantry', 'archer')).toBe(2.0);
    expect(counterMultiplier('housecarl', 'infantry')).toBe(1.3);
    expect(counterMultiplier('archer', 'spearman')).toBe(1.0);
    expect(counterMultiplier('cavalry', 'infantry')).toBe(1.0);
    expect(counterMultiplier('spearman', 'infantry')).toBe(1.0);
  });
});

describe('formation', () => {
  it('erzeugt 20 Slots und die Breite aus SPEC Abschnitt 5', () => {
    const slots = formationSlots(20);
    expect(slots).toHaveLength(20);
    expect(formationWidth(20)).toBe(Math.ceil(Math.sqrt(20 * 1.6)));
  });
});

describe('createBattle', () => {
  it('baut 10 Trupps mit 280 Soldaten', () => {
    const battle = createBattle(42);
    expect(battle.platoons).toHaveLength(10);
    expect(battle.platoons.filter((p) => p.faction === 'player')).toHaveLength(5);
    expect(battle.platoons.filter((p) => p.faction === 'enemy')).toHaveLength(5);
    const soldiers = battle.platoons.reduce((n, p) => n + p.soldiers.length, 0);
    expect(soldiers).toBe(280);
    expect(battle.status).toBe('running');
  });
});

describe('Determinismus', () => {
  it('liefert bei gleichem Seed nach 60 Schritten gleiche HP-Summen', () => {
    const a = createBattle(1234);
    const b = createBattle(1234);
    for (let i = 0; i < 60; i++) {
      step(a, 0.25);
      step(b, 0.25);
    }
    expect(totalHp(a)).toBe(totalHp(b));
    expect(a.projectiles.length).toBe(b.projectiles.length);
    expect(a.events.length).toBe(b.events.length);
  });
});

describe('Eigenbeschuss', () => {
  it('zielt nach 30 s nie auf die eigene Fraktion', () => {
    const battle = createBattle(77);
    for (let i = 0; i < 300; i++) {
      step(battle, 0.1);
      for (const projectile of battle.projectiles) {
        const target = soldierById(battle, projectile.targetId);
        expect(target).toBeDefined();
        if (target) expect(target.faction).not.toBe(projectile.faction);
      }
    }
  });

  it('lässt benachbarte eigene Trupps nicht aufeinander schießen', () => {
    const battle = createBattle(78);
    const players = battle.platoons.filter((p) => p.faction === 'player');
    const infantry = players.find((p) => p.kind === 'infantry');
    const spearman = players.find((p) => p.kind === 'spearman');
    expect(infantry).toBeDefined();
    expect(spearman).toBeDefined();

    for (const enemy of battle.platoons.filter((p) => p.faction === 'enemy')) {
      enemy.x = 55;
      enemy.z = 55;
      enemy.destX = null;
      enemy.destZ = null;
    }
    if (infantry) {
      infantry.x = 0;
      infantry.z = 0;
    }
    if (spearman) {
      spearman.x = 1.2;
      spearman.z = 0;
    }

    const before = totalHp(battle);
    for (let i = 0; i < 50; i++) step(battle, 0.1);
    expect(totalHp(battle)).toBe(before);
    const hits = drainEvents(battle).filter((e) => e.type === 'hit');
    expect(hits).toHaveLength(0);
  });
});

describe('Siegbedingung', () => {
  it('setzt status victory, wenn alle Gegner tot sind', () => {
    const battle = createBattle(5);
    for (const platoon of battle.platoons) {
      if (platoon.faction !== 'enemy') continue;
      for (const soldier of platoon.soldiers) {
        soldier.hp = 0;
        soldier.state = 'dead';
      }
      platoon.aliveCount = 0;
    }

    step(battle, 1 / 60);
    expect(battle.status).toBe('victory');
    const events = drainEvents(battle);
    expect(events.some((e) => e.type === 'end' && e.status === 'victory')).toBe(true);
  });
});

describe('Schadensformel', () => {
  it('bleibt mit fixem Seed im erwarteten Fenster', () => {
    const battle = createBattle(2024);
    const playerPlatoon = battle.platoons.find(
      (p) => p.faction === 'player' && p.kind === 'infantry',
    );
    const enemyPlatoon = battle.platoons.find(
      (p) => p.faction === 'enemy' && p.kind === 'archer',
    );
    expect(playerPlatoon).toBeDefined();
    expect(enemyPlatoon).toBeDefined();
    if (!playerPlatoon || !enemyPlatoon) return;

    const attacker = playerPlatoon.soldiers[0];
    const target = enemyPlatoon.soldiers[0];

    for (const platoon of battle.platoons) {
      for (const soldier of platoon.soldiers) {
        if (soldier.id !== attacker.id && soldier.id !== target.id) {
          soldier.hp = 0;
          soldier.state = 'dead';
        }
      }
      platoon.aliveCount = platoon.soldiers.filter(
        (s) => s.id === attacker.id || s.id === target.id,
      ).length;
    }

    attacker.hp = attacker.maxHp;
    attacker.state = 'idle';
    attacker.cooldown = 0;
    target.hp = target.maxHp;
    target.state = 'idle';
    target.cooldown = 0;

    // Beide Soldaten stehen exakt auf ihren Slots, 1,2 m auseinander.
    const enemySlot = formationSlots(20)[0];
    enemyPlatoon.facing = 0;
    enemyPlatoon.x = -enemySlot.x;
    enemyPlatoon.z = -enemySlot.z;
    enemyPlatoon.destX = null;
    enemyPlatoon.destZ = null;
    enemyPlatoon.targetPlatoonId = null;
    target.x = 0;
    target.z = 0;
    target.facing = 0;

    const playerSlot = formationSlots(33)[0];
    const rotated = rotate(playerSlot.x, playerSlot.z, Math.PI);
    playerPlatoon.facing = Math.PI;
    playerPlatoon.x = -rotated.x;
    playerPlatoon.z = 1.2 - rotated.z;
    playerPlatoon.destX = null;
    playerPlatoon.destZ = null;
    playerPlatoon.targetPlatoonId = null;
    attacker.x = 0;
    attacker.z = 1.2;
    attacker.facing = Math.PI;

    step(battle, 1 / 60);
    const hits = drainEvents(battle).filter(
      (e) => e.type === 'hit' && e.soldierId === target.id,
    );
    expect(hits.length).toBeGreaterThan(0);

    // 13 * DAMAGE_SCALE * 2.0 * [0.85..1.15] * (1 - 5/100)
    // DAMAGE_SCALE haelt die Schlachtdauer im Rahmen des Originals (~2 Minuten);
    // ohne ihn waere eine 5v5-Schlacht nach 33 Sekunden vorbei.
    const min = 13 * DAMAGE_SCALE * 2.0 * 0.85 * 0.95;
    const max = 13 * DAMAGE_SCALE * 2.0 * 1.15 * 0.95;
    for (const hit of hits) {
      if (hit.type !== 'hit') continue;
      expect(hit.damage).toBeGreaterThanOrEqual(min);
      expect(hit.damage).toBeLessThanOrEqual(max);
    }
  });
});
