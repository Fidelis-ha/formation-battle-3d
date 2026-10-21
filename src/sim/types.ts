export type Faction = 'player' | 'enemy';

export type UnitKind = 'archer' | 'spearman' | 'infantry' | 'housecarl' | 'cavalry';

export interface UnitStats {
  kind: UnitKind;
  name: string;
  squad: number;
  melee: number;
  health: number;
  speed: number;
  meleeDef: number;
  rangedDef: number;
  range: number;
  ranged: boolean;
  mounted: boolean;
  weapon: string;
  offhand: string | null;
  strongAgainst: UnitKind[];
  description: string;
}

export interface Soldier {
  id: number;
  platoonId: number;
  faction: Faction;
  kind: UnitKind;
  x: number;
  z: number;
  hp: number;
  maxHp: number;
  targetId: number | null;
  cooldown: number;
  state: 'idle' | 'move' | 'attack' | 'dead';
  facing: number;
  slot: number;
  deadTime: number;
}

export interface Platoon {
  id: number;
  faction: Faction;
  kind: UnitKind;
  x: number;
  z: number;
  destX: number | null;
  destZ: number | null;
  targetPlatoonId: number | null;
  facing: number;
  autoAttack: boolean;
  weaponMode: number;
  moraleBroken: boolean;
  soldiers: Soldier[];
  aliveCount: number;
}

export interface Projectile {
  id: number;
  x: number;
  z: number;
  tx: number;
  tz: number;
  y: number;
  t: number;
  dur: number;
  damage: number;
  faction: Faction;
  targetId: number;
}

export interface Battle {
  platoons: Platoon[];
  projectiles: Projectile[];
  time: number;
  status: 'running' | 'victory' | 'defeat';
  seed: number;
  nextId: number;
  events: BattleEvent[];
}

export type BattleEvent =
  | { type: 'hit'; soldierId: number; damage: number; x: number; z: number }
  | { type: 'death'; soldierId: number; x: number; z: number; faction: Faction }
  | { type: 'shot'; fromX: number; fromZ: number; toX: number; toZ: number; faction: Faction }
  | { type: 'morale'; platoonId: number }
  | { type: 'end'; status: 'victory' | 'defeat' };
