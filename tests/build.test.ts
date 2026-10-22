import { describe, expect, it } from 'vitest';
import {
  buildStructure,
  createBattle,
  drainEvents,
  issueMove,
  startBattlePhase,
  step,
} from '../src/sim/battle';
import {
  BUILD_PHASE_SECONDS,
  START_RESOURCES,
  STRUCTURE_SPECS,
  blockedByStructure,
  placementError,
  towerRangeBonus,
} from '../src/sim/build';
import { isWater } from '../src/sim/terrain';

describe('Bauphase', () => {
  it('beginnt mit Rohstoffen und einem Zeitfenster', () => {
    const b = createBattle(7);
    expect(b.phase).toBe('build');
    expect(b.resources.player).toBe(START_RESOURCES);
    expect(b.resources.enemy).toBe(START_RESOURCES);
    expect(b.buildTimeLeft).toBe(BUILD_PHASE_SECONDS);
    expect(b.structures).toHaveLength(0);
  });

  it('zieht die Kosten beim Bauen ab', () => {
    const b = createBattle(7);
    const before = b.resources.player;
    const cost = STRUCTURE_SPECS.palisade.cost;
    const error = buildStructure(b, 'player', 'palisade', -10, 30);
    expect(error).toBeNull();
    expect(b.resources.player).toBe(before - cost);
    expect(b.structures).toHaveLength(1);
    expect(b.structures[0].kind).toBe('palisade');
  });

  it('verweigert den Bau ohne genug Rohstoffe', () => {
    const b = createBattle(7);
    b.resources.player = 5;
    const error = buildStructure(b, 'player', 'wall', -10, 30);
    expect(error).toBe('notEnoughResources');
    expect(b.structures).toHaveLength(0);
    expect(b.resources.player).toBe(5);
  });

  it('unterscheidet die Preise der Anlagen', () => {
    const costs = new Set(
      (['wall', 'palisade', 'breakwater', 'tower'] as const).map((k) => STRUCTURE_SPECS[k].cost),
    );
    console.log('Preise:', [...costs].join(', '));
    // Alle vier Anlagen kosten unterschiedlich viel.
    expect(costs.size).toBe(4);
  });

  it('baut den Wellenbrecher nur im Wasser', () => {
    const b = createBattle(7);
    // Auf dem Trockenen scheitert es.
    expect(buildStructure(b, 'player', 'breakwater', -10, 30)).toBe('buildNeedsWater');
    // Im Fluss klappt es.
    let placed = false;
    for (let x = -60; x < 60 && !placed; x += 2) {
      for (let z = -30; z < -8; z += 1) {
        if (!isWater(x, z)) continue;
        const err = buildStructure(b, 'player', 'breakwater', x, z);
        if (err === null) {
          placed = true;
          break;
        }
      }
    }
    expect(placed).toBe(true);
    expect(b.structures.some((s) => s.kind === 'breakwater')).toBe(true);
  });

  it('baut keine Mauer ins Wasser', () => {
    const b = createBattle(7);
    let waterSpot: { x: number; z: number } | null = null;
    for (let x = -60; x < 60 && !waterSpot; x += 2) {
      for (let z = -30; z < -8; z += 1) {
        if (isWater(x, z)) {
          waterSpot = { x, z };
          break;
        }
      }
    }
    expect(waterSpot).not.toBeNull();
    if (waterSpot) {
      expect(buildStructure(b, 'player', 'wall', waterSpot.x, waterSpot.z)).toBe('buildNoWater');
    }
  });

  it('baut nicht zwei Anlagen aufeinander', () => {
    const b = createBattle(7);
    expect(buildStructure(b, 'player', 'palisade', -12, 30)).toBeNull();
    expect(buildStructure(b, 'player', 'palisade', -11.5, 30)).toBe('buildTooClose');
  });

  it('verweigert den Bau nach dem Start der Schlacht', () => {
    const b = createBattle(7);
    startBattlePhase(b);
    expect(b.phase).toBe('battle');
    expect(buildStructure(b, 'player', 'wall', -10, 30)).toBe('buildOnlyInPhase');
  });

  it('beendet die Bauphase nach Ablauf der Zeit von selbst', () => {
    const b = createBattle(7);
    const dt = 0.5;
    let steps = 0;
    while (b.phase === 'build' && steps < 200) {
      step(b, dt);
      steps += 1;
    }
    expect(b.phase).toBe('battle');
    // Nach rund BUILD_PHASE_SECONDS, nicht frueher und nicht viel spaeter.
    expect(steps * dt).toBeGreaterThanOrEqual(BUILD_PHASE_SECONDS);
    expect(steps * dt).toBeLessThan(BUILD_PHASE_SECONDS + 1);
  });

  it('die Gegenseite baut beim Start ebenfalls', () => {
    const b = createBattle(7);
    startBattlePhase(b);
    const enemy = b.structures.filter((s) => s.faction === 'enemy');
    console.log(`Gegnerische Anlagen: ${enemy.length}`);
    expect(enemy.length).toBeGreaterThan(3);
    expect(b.resources.enemy).toBeLessThan(START_RESOURCES);
  });

  it('eine feindliche Mauer sperrt den Weg, die eigene ist Deckung', () => {
    const b = createBattle(7);
    // Freie Stelle zwischen den Linien suchen.
    let spot: { x: number; z: number } | null = null;
    for (let z = 34; z > 22 && !spot; z -= 1) {
      if (buildStructure(b, 'enemy', 'wall', 0, z) === null) spot = { x: 0, z };
    }
    expect(spot).not.toBeNull();
    const wall = b.structures[0];
    expect(wall).toBeDefined();
    if (!spot) return;
    // Die feindliche Mauer sperrt den Spieler.
    expect(blockedByStructure(b.structures, spot.x, spot.z, 'player')).toBe(true);
    // Fuer den Erbauer selbst ist sie Deckung — er steht dahinter.
    expect(blockedByStructure(b.structures, spot.x, spot.z, 'enemy')).toBe(false);
  });

  it('der Wachturm gibt Fernkampf-Reichweite in der Naehe', () => {
    const b = createBattle(7);
    buildStructure(b, 'player', 'tower', -12, 30);
    const near = towerRangeBonus(b.structures, -12, 34, 'player');
    const far = towerRangeBonus(b.structures, 40, 40, 'player');
    const enemy = towerRangeBonus(b.structures, -12, 34, 'enemy');
    console.log(`Turm: nah=${near} fern=${far} gegnerisch=${enemy}`);
    expect(near).toBeGreaterThan(0);
    expect(far).toBe(0);
    expect(enemy).toBe(0);
  });

  it('ein Trupp kann nicht durch eine Mauer hindurchlaufen', () => {
    const b = createBattle(11);
    // Eine FEINDLICHE Palisadenreihe quer vor dem Spielertrupp. Eigene Anlagen
    // waeren Deckung und wuerden den eigenen Trupp nicht aufhalten.
    for (let i = 0; i < 5; i += 1) {
      const x = -6.8 + i * 3.4;
      const err = buildStructure(b, 'enemy', 'palisade', x, 28);
      expect(err).toBeNull();
    }
    expect(b.structures.filter((s) => s.faction === 'enemy')).toHaveLength(5);

    startBattlePhase(b);

    const platoon = b.platoons.find((p) => p.faction === 'player' && p.kind === 'infantry');
    expect(platoon).toBeDefined();
    if (!platoon) return;
    platoon.autoApproach = false;
    platoon.autoMoveTo = null;
    platoon.playerTargetId = null;
    platoon.x = 0;
    platoon.z = 34;
    for (const s of platoon.soldiers) {
      s.x = 0;
      s.z = 34;
    }
    issueMove(b, platoon.id, 0, 20);

    // Der Trupp darf nicht durch die Mauer stossen, sondern muss aussen
    // herumgehen. Geprueft wird deshalb der groesste seitliche Ausschlag:
    // geht er geradeaus durch, bleibt er bei x = 0.
    let maxAbsX = 0;
    for (let i = 0; i < 300; i += 1) {
      step(b, 1 / 30);
      maxAbsX = Math.max(maxAbsX, Math.abs(platoon.x));
    }

    const wallHalfWidth = 6.8 + 3.4 * 0.62;
    console.log(
      `Trupp bei (${platoon.x.toFixed(1)}, ${platoon.z.toFixed(1)}), groesster Seitenausschlag ${maxAbsX.toFixed(1)} (Mauer reicht bis ${wallHalfWidth.toFixed(1)})`,
    );

    // Entweder er ist aussen herum (seitlich weit ausgewichen) oder er steht
    // noch vor der Mauer — aber er ist nicht mittig durchgelaufen.
    const wentAround = maxAbsX > wallHalfWidth;
    const stillInFront = platoon.z > 28;
    expect(wentAround || stillInFront).toBe(true);
    if (!wentAround) expect(platoon.z).toBeGreaterThan(28);
  });

  it('meldet die Bauereignisse', () => {
    const b = createBattle(7);
    buildStructure(b, 'player', 'palisade', -14, 30);
    const events = drainEvents(b).filter((e) => e.type === 'build');
    expect(events).toHaveLength(1);
  });

  it('die Platzierungspruefung gibt Gruende zurueck', () => {
    const b = createBattle(7);
    expect(placementError(b.structures, 'wall', 0, 0, 'player')).toBeNull();
    expect(placementError(b.structures, 'wall', 999, 0, 'player')).toBe('tooSteep');
  });
});
