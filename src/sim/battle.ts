import { formationSlots, formationWidth, FORMATION_SPACING } from './formation';
import type {
  Battle,
  BattleEvent,
  Faction,
  Platoon,
  Projectile,
  Soldier,
  UnitKind,
} from './types';
import { counterMultiplier, UNIT_STATS } from './units';

const WORLD_HALF = 60;
const MELEE_RANGE = 1.6;
const SIGHT = 24;
const AI_INTERVAL = 0.5;
const PROJECTILE_FLIGHT = 0.35;
const PROJECTILE_HEIGHT = 2.5;
const CHARGE_COOLDOWN = 3;
const MORALE_LOSS = 0.7;
const ARRIVE_TOLERANCE = 0.6;

interface Runtime {
  rng: number;
  aiTimer: number;
  chargeReady: Map<number, number>;
  initialCounts: Map<number, number>;
  speeds: Map<number, number>;
  moraleUsed: Set<number>;
}

const runtimes = new WeakMap<Battle, Runtime>();

function runtime(battle: Battle): Runtime {
  let r = runtimes.get(battle);
  if (!r) {
    r = {
      rng: battle.seed >>> 0,
      aiTimer: 0,
      chargeReady: new Map<number, number>(),
      initialCounts: new Map<number, number>(),
      speeds: new Map<number, number>(),
      moraleUsed: new Set<number>(),
    };
    for (const platoon of battle.platoons) {
      r.initialCounts.set(platoon.id, platoon.soldiers.length);
    }
    runtimes.set(battle, r);
  }
  return r;
}

// mulberry32, Zustand pro Battle.
function random(battle: Battle): number {
  const r = runtime(battle);
  r.rng = (r.rng + 0x6d2b79f5) >>> 0;
  let t = Math.imul(r.rng ^ (r.rng >>> 15), 1 | r.rng);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function randomRange(battle: Battle, min: number, max: number): number {
  return min + (max - min) * random(battle);
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

function rotateSlot(slot: { x: number; z: number }, facing: number): { x: number; z: number } {
  const c = Math.cos(facing);
  const s = Math.sin(facing);
  return { x: slot.x * c + slot.z * s, z: -slot.x * s + slot.z * c };
}

function isAlive(soldier: Soldier): boolean {
  return soldier.state !== 'dead' && soldier.hp > 0;
}

function platoonById(battle: Battle, id: number): Platoon | undefined {
  return battle.platoons.find((p) => p.id === id);
}

function soldierById(battle: Battle, id: number): Soldier | undefined {
  for (const platoon of battle.platoons) {
    const found = platoon.soldiers.find((s) => s.id === id);
    if (found) return found;
  }
  return undefined;
}

function weaponFor(platoon: Platoon): { range: number; ranged: boolean } {
  const stats = UNIT_STATS[platoon.kind];
  if (platoon.kind === 'archer' && platoon.weaponMode === 1) {
    return { range: MELEE_RANGE, ranged: false };
  }
  return { range: stats.range, ranged: stats.ranged };
}

function attackInterval(kind: UnitKind): number {
  return kind === 'archer' ? 1.4 : 1;
}

// Abstand, bei dem ein Trupp stehen bleibt (Nahkampf mit Frontreihe im Kontakt).
function engageDistance(platoon: Platoon): number {
  const weapon = weaponFor(platoon);
  return weapon.ranged ? weapon.range : weapon.range + 2;
}

function isBackAttack(attacker: Soldier, target: Soldier): boolean {
  const forwardX = Math.sin(target.facing);
  const forwardZ = Math.cos(target.facing);
  const dx = attacker.x - target.x;
  const dz = attacker.z - target.z;
  const len = Math.hypot(dx, dz);
  if (len < 1e-6) return false;
  const dot = (dx / len) * forwardX + (dz / len) * forwardZ;
  return dot < -0.5;
}

function applyDamage(battle: Battle, target: Soldier, damage: number): void {
  if (!isAlive(target)) return;
  target.hp -= damage;
  battle.events.push({
    type: 'hit',
    soldierId: target.id,
    damage,
    x: target.x,
    z: target.z,
  });
  if (target.hp <= 0) {
    target.hp = 0;
    target.state = 'dead';
    target.deadTime = 0;
    const platoon = platoonById(battle, target.platoonId);
    if (platoon) platoon.aliveCount = Math.max(0, platoon.aliveCount - 1);
    battle.events.push({
      type: 'death',
      soldierId: target.id,
      x: target.x,
      z: target.z,
      faction: target.faction,
    });
  }
}

function nearestInPlatoon(
  soldier: Soldier,
  targetPlatoon: Platoon,
  rangeSq: number,
): Soldier | null {
  let best: Soldier | null = null;
  let bestD = Infinity;
  for (const other of targetPlatoon.soldiers) {
    if (!isAlive(other)) continue;
    const dx = other.x - soldier.x;
    const dz = other.z - soldier.z;
    const d = dx * dx + dz * dz;
    if (d <= rangeSq && d < bestD) {
      bestD = d;
      best = other;
    }
  }
  return best;
}

function chooseTarget(
  battle: Battle,
  soldier: Soldier,
  platoon: Platoon,
  weapon: { range: number; ranged: boolean },
): Soldier | null {
  if (!platoon.autoAttack && platoon.targetPlatoonId === null) return null;

  const rangeSq = weapon.range * weapon.range;
  if (platoon.targetPlatoonId !== null) {
    const targetPlatoon = platoonById(battle, platoon.targetPlatoonId);
    if (targetPlatoon && targetPlatoon.aliveCount > 0) {
      const preferred = nearestInPlatoon(soldier, targetPlatoon, rangeSq);
      if (preferred) return preferred;
    }
  }

  if (!platoon.autoAttack) return null;

  let best: Soldier | null = null;
  let bestD = Infinity;
  for (const other of battle.platoons) {
    if (other.faction === platoon.faction || other.aliveCount <= 0) continue;
    for (const candidate of other.soldiers) {
      if (!isAlive(candidate)) continue;
      const dx = candidate.x - soldier.x;
      const dz = candidate.z - soldier.z;
      const d = dx * dx + dz * dz;
      if (d <= rangeSq && d < bestD) {
        bestD = d;
        best = candidate;
      }
    }
  }
  return best;
}

function performAttack(
  battle: Battle,
  attacker: Soldier,
  target: Soldier,
  platoon: Platoon,
  weapon: { range: number; ranged: boolean },
): void {
  const stats = UNIT_STATS[platoon.kind];
  const targetStats = UNIT_STATS[target.kind];
  const dist = Math.hypot(target.x - attacker.x, target.z - attacker.z);
  const ranged = weapon.ranged && dist > MELEE_RANGE;

  let damage =
    stats.melee * counterMultiplier(platoon.kind, target.kind) * randomRange(battle, 0.85, 1.15);
  const defense = ranged ? targetStats.rangedDef : targetStats.meleeDef;
  damage *= 1 - defense / 100;

  if (isBackAttack(attacker, target)) damage *= 1.5;

  if (stats.mounted) {
    const r = runtime(battle);
    const speed = r.speeds.get(attacker.id) ?? 0;
    const readyAt = r.chargeReady.get(attacker.id) ?? 0;
    if (speed > stats.speed * 0.8 && battle.time >= readyAt) {
      damage *= 1.8;
      r.chargeReady.set(attacker.id, battle.time + CHARGE_COOLDOWN);
    }
  }

  // Archer im Kontakt: Fernkampf-Malus.
  if (stats.ranged && platoon.weaponMode === 0 && dist <= MELEE_RANGE) {
    damage *= 0.4;
  }

  if (ranged) {
    const projectile: Projectile = {
      id: battle.nextId++,
      x: attacker.x,
      z: attacker.z,
      tx: target.x,
      tz: target.z,
      y: 0,
      t: 0,
      dur: PROJECTILE_FLIGHT,
      damage,
      faction: attacker.faction,
      targetId: target.id,
    };
    battle.projectiles.push(projectile);
    battle.events.push({
      type: 'shot',
      fromX: attacker.x,
      fromZ: attacker.z,
      toX: target.x,
      toZ: target.z,
      faction: attacker.faction,
    });
  } else {
    applyDamage(battle, target, damage);
  }
}

function movePlatoons(battle: Battle, dt: number): void {
  for (const platoon of battle.platoons) {
    if (platoon.aliveCount <= 0) continue;
    const stats = UNIT_STATS[platoon.kind];

    let targetX = platoon.destX;
    let targetZ = platoon.destZ;

    if (
      targetX === null &&
      targetZ === null &&
      platoon.targetPlatoonId !== null &&
      !platoon.moraleBroken
    ) {
      const targetPlatoon = platoonById(battle, platoon.targetPlatoonId);
      if (targetPlatoon && targetPlatoon.aliveCount > 0) {
        const d = Math.hypot(targetPlatoon.x - platoon.x, targetPlatoon.z - platoon.z);
        if (d > engageDistance(platoon)) {
          targetX = targetPlatoon.x;
          targetZ = targetPlatoon.z;
        }
      }
    }

    if (targetX !== null && targetZ !== null) {
      const dx = targetX - platoon.x;
      const dz = targetZ - platoon.z;
      const d = Math.hypot(dx, dz);
      if (d <= ARRIVE_TOLERANCE) {
        platoon.destX = null;
        platoon.destZ = null;
      } else {
        const stepDist = Math.min(stats.speed * dt, d);
        platoon.x += (dx / d) * stepDist;
        platoon.z += (dz / d) * stepDist;
        platoon.facing = Math.atan2(dx, dz);
        if (d - stepDist <= ARRIVE_TOLERANCE) {
          platoon.destX = null;
          platoon.destZ = null;
        }
      }
    }

    platoon.x = clamp(platoon.x, -WORLD_HALF, WORLD_HALF);
    platoon.z = clamp(platoon.z, -WORLD_HALF, WORLD_HALF);
  }
}

function updateSoldiers(battle: Battle, dt: number): void {
  const r = runtime(battle);
  for (const platoon of battle.platoons) {
    if (platoon.aliveCount <= 0) continue;
    const stats = UNIT_STATS[platoon.kind];
    const weapon = weaponFor(platoon);
    const slots = formationSlots(stats.squad);

    for (const soldier of platoon.soldiers) {
      if (!isAlive(soldier)) continue;
      if (soldier.cooldown > 0) soldier.cooldown = Math.max(0, soldier.cooldown - dt);

      const slot = slots[soldier.slot] ?? { x: 0, z: 0 };
      const rotated = rotateSlot(slot, platoon.facing);
      const targetX = platoon.x + rotated.x;
      const targetZ = platoon.z + rotated.z;
      const dx = targetX - soldier.x;
      const dz = targetZ - soldier.z;
      const d = Math.hypot(dx, dz);

      const oldX = soldier.x;
      const oldZ = soldier.z;
      let moved = false;
      if (d > 0.05) {
        const stepDist = Math.min(stats.speed * dt, d);
        soldier.x += (dx / d) * stepDist;
        soldier.z += (dz / d) * stepDist;
        moved = stepDist > 1e-6;
      }
      const realDist = Math.hypot(soldier.x - oldX, soldier.z - oldZ);
      r.speeds.set(soldier.id, dt > 0 ? realDist / dt : 0);

      const target = chooseTarget(battle, soldier, platoon, weapon);
      soldier.targetId = target ? target.id : null;

      if (target) {
        soldier.facing = Math.atan2(target.x - soldier.x, target.z - soldier.z);
        if (soldier.cooldown <= 0) {
          performAttack(battle, soldier, target, platoon, weapon);
          soldier.cooldown = attackInterval(platoon.kind);
          soldier.state = 'attack';
        } else {
          soldier.state = moved ? 'move' : 'attack';
        }
      } else {
        soldier.facing = platoon.facing;
        soldier.state = moved ? 'move' : 'idle';
      }

      soldier.x = clamp(soldier.x, -WORLD_HALF, WORLD_HALF);
      soldier.z = clamp(soldier.z, -WORLD_HALF, WORLD_HALF);
    }
  }
}

function updateProjectiles(battle: Battle, dt: number): void {
  const remaining: Projectile[] = [];
  for (const projectile of battle.projectiles) {
    projectile.t += dt;
    if (projectile.t >= projectile.dur) {
      const target = soldierById(battle, projectile.targetId);
      if (target && isAlive(target)) {
        applyDamage(battle, target, projectile.damage);
      }
    } else {
      projectile.y =
        Math.sin(Math.PI * Math.min(1, projectile.t / projectile.dur)) * PROJECTILE_HEIGHT;
      remaining.push(projectile);
    }
  }
  battle.projectiles = remaining;
}

function updateDead(battle: Battle, dt: number): void {
  for (const platoon of battle.platoons) {
    for (const soldier of platoon.soldiers) {
      if (soldier.state === 'dead') soldier.deadTime += dt;
    }
  }
}

function nearestEnemyPlatoon(battle: Battle, platoon: Platoon): Platoon | null {
  let best: Platoon | null = null;
  let bestD = Infinity;
  for (const other of battle.platoons) {
    if (other.faction === platoon.faction || other.aliveCount <= 0) continue;
    const d = Math.hypot(other.x - platoon.x, other.z - platoon.z);
    if (d < bestD) {
      bestD = d;
      best = other;
    }
  }
  return best;
}

function runAI(battle: Battle): void {
  const r = runtime(battle);
  for (const platoon of battle.platoons) {
    if (platoon.faction !== 'enemy' || platoon.aliveCount <= 0) continue;
    const stats = UNIT_STATS[platoon.kind];

    const initial = r.initialCounts.get(platoon.id) ?? stats.squad;
    if (
      !platoon.moraleBroken &&
      !r.moraleUsed.has(platoon.id) &&
      platoon.aliveCount < initial * (1 - MORALE_LOSS)
    ) {
      r.moraleUsed.add(platoon.id);
      platoon.moraleBroken = true;
      platoon.targetPlatoonId = null;
      const enemy = nearestEnemyPlatoon(battle, platoon);
      let nx = 0;
      let nz = -1;
      if (enemy) {
        const d = Math.hypot(platoon.x - enemy.x, platoon.z - enemy.z);
        if (d > 1e-6) {
          nx = (platoon.x - enemy.x) / d;
          nz = (platoon.z - enemy.z) / d;
        }
      }
      platoon.destX = clamp(platoon.x + nx * 12, -WORLD_HALF, WORLD_HALF);
      platoon.destZ = clamp(platoon.z + nz * 12, -WORLD_HALF, WORLD_HALF);
      battle.events.push({ type: 'morale', platoonId: platoon.id });
      continue;
    }

    if (platoon.moraleBroken) {
      const retreatDone =
        platoon.destX === null ||
        platoon.destZ === null ||
        Math.hypot(platoon.destX - platoon.x, platoon.destZ - platoon.z) <= ARRIVE_TOLERANCE;
      if (!retreatDone) continue;
      platoon.moraleBroken = false;
      platoon.destX = null;
      platoon.destZ = null;
    }

    let best: Platoon | null = null;
    let bestDist = Infinity;
    let bestScore = -Infinity;
    for (const other of battle.platoons) {
      if (other.faction === platoon.faction || other.aliveCount <= 0) continue;
      const d = Math.hypot(other.x - platoon.x, other.z - platoon.z);
      if (d > SIGHT) continue;
      const score = counterMultiplier(platoon.kind, other.kind) / Math.max(d, 1);
      if (score > bestScore) {
        bestScore = score;
        bestDist = d;
        best = other;
      }
    }

    if (!best) {
      // Kein Gegner in Sicht: auf den nächstgelegenen Feind vorrücken,
      // nicht nur zur Kartenmitte (sonst erstarren beide Seiten).
      platoon.targetPlatoonId = null;
      const nearest = nearestEnemyPlatoon(battle, platoon);
      if (nearest) {
        platoon.destX = nearest.x;
        platoon.destZ = nearest.z;
      } else {
        platoon.destX = null;
        platoon.destZ = null;
      }
      continue;
    }

    platoon.targetPlatoonId = best.id;

    if (platoon.kind === 'cavalry' && bestDist > 8) {
      platoon.destX = best.x;
      platoon.destZ = best.z;
      continue;
    }

    if (platoon.kind === 'archer') {
      // Bogenschützen halten Abstand, kiten aber nicht endlos:
      // nur im echten Notfall (unter 6 m) zurückweichen, sonst auf
      // Wirkschussweite heranrücken und stehen bleiben.
      if (bestDist < 6) {
        const d = Math.max(bestDist, 1e-6);
        const nx = (platoon.x - best.x) / d;
        const nz = (platoon.z - best.z) / d;
        platoon.destX = clamp(platoon.x + nx * 7, -WORLD_HALF, WORLD_HALF);
        platoon.destZ = clamp(platoon.z + nz * 7, -WORLD_HALF, WORLD_HALF);
      } else if (bestDist > stats.range * 0.9) {
        platoon.destX = best.x;
        platoon.destZ = best.z;
      } else {
        platoon.destX = null;
        platoon.destZ = null;
      }
      continue;
    }

    if (bestDist > engageDistance(platoon)) {
      platoon.destX = best.x;
      platoon.destZ = best.z;
    } else {
      platoon.destX = null;
      platoon.destZ = null;
    }
  }
}

function syncAliveCounts(battle: Battle): void {
  for (const platoon of battle.platoons) {
    let alive = 0;
    for (const soldier of platoon.soldiers) {
      if (soldier.hp > 0) {
        if (soldier.state === 'dead') soldier.state = 'idle';
        alive++;
      } else if (soldier.state !== 'dead') {
        soldier.state = 'dead';
        soldier.deadTime = 0;
      }
    }
    platoon.aliveCount = alive;
  }
}

function checkEnd(battle: Battle): void {
  syncAliveCounts(battle);
  if (battle.status !== 'running') return;

  let playerAlive = 0;
  let enemyAlive = 0;
  for (const platoon of battle.platoons) {
    if (platoon.faction === 'player') playerAlive += platoon.aliveCount;
    else enemyAlive += platoon.aliveCount;
  }

  if (enemyAlive === 0) {
    battle.status = 'victory';
    battle.events.push({ type: 'end', status: 'victory' });
  } else if (playerAlive === 0) {
    battle.status = 'defeat';
    battle.events.push({ type: 'end', status: 'defeat' });
  }
}

export function createBattle(seed: number = 1): Battle {
  const battle: Battle = {
    platoons: [],
    projectiles: [],
    time: 0,
    status: 'running',
    seed: seed >>> 0,
    nextId: 1,
    events: [],
  };

  const xs = [-24, -12, 0, 12, 24];
  const kinds: UnitKind[] = ['archer', 'spearman', 'infantry', 'housecarl', 'cavalry'];

  for (let side = 0; side < 2; side++) {
    const faction: Faction = side === 0 ? 'player' : 'enemy';
    const z = side === 0 ? 38 : -38;
    const facing = side === 0 ? Math.PI : 0;

    for (let i = 0; i < kinds.length; i++) {
      const kind = kinds[i];
      const stats = UNIT_STATS[kind];
      const x = side === 0 ? xs[i] : xs[xs.length - 1 - i];
      const platoon: Platoon = {
        id: battle.nextId++,
        faction,
        kind,
        x,
        z,
        destX: null,
        destZ: null,
        targetPlatoonId: null,
        facing,
        autoAttack: true,
        weaponMode: 0,
        moraleBroken: false,
        soldiers: [],
        aliveCount: stats.squad,
      };

      const slots = formationSlots(stats.squad);
      for (let slotIndex = 0; slotIndex < slots.length; slotIndex++) {
        const rotated = rotateSlot(slots[slotIndex], facing);
        const soldier: Soldier = {
          id: battle.nextId++,
          platoonId: platoon.id,
          faction,
          kind,
          x: x + rotated.x,
          z: z + rotated.z,
          hp: stats.health,
          maxHp: stats.health,
          targetId: null,
          cooldown: 0,
          state: 'idle',
          facing,
          slot: slotIndex,
          deadTime: 0,
        };
        platoon.soldiers.push(soldier);
      }

      battle.platoons.push(platoon);
    }
  }

  runtime(battle);
  return battle;
}

export function step(battle: Battle, dt: number): void {
  if (battle.status !== 'running') return;
  if (!Number.isFinite(dt) || dt < 0) return;
  if (dt === 0) {
    checkEnd(battle);
    return;
  }

  battle.time += dt;
  const r = runtime(battle);
  r.aiTimer += dt;
  if (r.aiTimer >= AI_INTERVAL) {
    r.aiTimer = 0;
    runAI(battle);
  }

  movePlatoons(battle, dt);
  updateSoldiers(battle, dt);
  updateProjectiles(battle, dt);
  updateDead(battle, dt);
  checkEnd(battle);
}

export function issueMove(battle: Battle, platoonId: number, x: number, z: number): void {
  const platoon = platoonById(battle, platoonId);
  if (!platoon) return;
  platoon.destX = clamp(x, -WORLD_HALF, WORLD_HALF);
  platoon.destZ = clamp(z, -WORLD_HALF, WORLD_HALF);
  platoon.targetPlatoonId = null;
  platoon.moraleBroken = false;
}

export function issueAttack(battle: Battle, platoonId: number, targetPlatoonId: number): void {
  const platoon = platoonById(battle, platoonId);
  const target = platoonById(battle, targetPlatoonId);
  if (!platoon || !target || platoon.faction === target.faction) return;
  platoon.targetPlatoonId = target.id;
  platoon.destX = null;
  platoon.destZ = null;
  platoon.moraleBroken = false;
}

export function toggleAutoAttack(battle: Battle, platoonId: number): boolean {
  const platoon = platoonById(battle, platoonId);
  if (!platoon) return false;
  platoon.autoAttack = !platoon.autoAttack;
  return platoon.autoAttack;
}

export function switchWeapon(battle: Battle, platoonId: number): number {
  const platoon = platoonById(battle, platoonId);
  if (!platoon) return 0;
  if (platoon.kind === 'archer' || platoon.kind === 'cavalry') {
    platoon.weaponMode = platoon.weaponMode === 0 ? 1 : 0;
  }
  return platoon.weaponMode;
}

export function platoonAt(
  battle: Battle,
  x: number,
  z: number,
  faction?: Faction,
): Platoon | null {
  let best: Platoon | null = null;
  let bestD = Infinity;

  for (const platoon of battle.platoons) {
    if (faction !== undefined && platoon.faction !== faction) continue;
    if (platoon.aliveCount <= 0) continue;

    const stats = UNIT_STATS[platoon.kind];
    const cols = formationWidth(stats.squad);
    const rows = Math.ceil(stats.squad / Math.max(1, cols));
    const halfW = ((cols - 1) * FORMATION_SPACING) / 2 + FORMATION_SPACING;
    const halfD = ((rows - 1) * FORMATION_SPACING) / 2 + FORMATION_SPACING;

    const dx = x - platoon.x;
    const dz = z - platoon.z;
    const c = Math.cos(platoon.facing);
    const s = Math.sin(platoon.facing);
    const localX = dx * c - dz * s;
    const localZ = dx * s + dz * c;

    if (Math.abs(localX) <= halfW && Math.abs(localZ) <= halfD) {
      const d = dx * dx + dz * dz;
      if (d < bestD) {
        bestD = d;
        best = platoon;
      }
    }
  }

  return best;
}

export function drainEvents(battle: Battle): BattleEvent[] {
  const events = battle.events.slice();
  battle.events.length = 0;
  return events;
}
