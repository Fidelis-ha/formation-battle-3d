export type Faction = 'player' | 'enemy';

export type UnitKind = 'archer' | 'spearman' | 'infantry' | 'housecarl' | 'cavalry';

export interface UnitStats {
  kind: UnitKind;
  name: string;
  squad: number;
  melee: number;
  // Aus dem Original belegt: das Unit-Info-Panel hat GETRENNTE Werte fuer
  // "Melee Damage" und "Ranged Damage" (Strings im Build). Ein Bogenschuetze
  // schiesst mit seinem Ranged-Wert, im Kontakt mit dem Melee-Wert.
  rangedDamage: number;
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
  // Aus dem Original: eigener Schalter "Auto Approach". Ist er an, rueckt der
  // Trupp ohne Befehl selbst auf den naechsten sinnvollen Gegner vor.
  autoApproach: boolean;
  // Eigenbewegung aus Auto Approach. Getrennt vom Spielerbefehl (destX/destZ),
  // damit ein Befehl nicht von der Automatik ueberschrieben wird.
  autoTargetId: number | null;
  // Vom Spieler gesetztes Angriffsziel. Trennt Befehl von Automatik.
  playerTargetId: number | null;
  autoMoveTo: { x: number; z: number } | null;
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
