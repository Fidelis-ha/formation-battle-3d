import type { UnitKind, UnitStats } from './types';

// Werte aus docs/SPEC.md Abschnitt 2.
export const UNIT_STATS: Record<UnitKind, UnitStats> = {
  archer: {
    kind: 'archer',
    name: 'Archer',
    squad: 35,
    melee: 6,
    rangedDamage: 8,
    health: 55,
    speed: 4.6,
    meleeDef: 5,
    rangedDef: 10,
    range: 14,
    ranged: true,
    mounted: false,
    weapon: 'Bow',
    offhand: null,
    strongAgainst: [],
    description: 'Fernkampf mit konstantem Schaden, bricht im Nahkampf.',
  },
  spearman: {
    kind: 'spearman',
    name: 'Spearman',
    squad: 27,
    melee: 11,
    rangedDamage: 0,
    health: 95,
    speed: 4.0,
    meleeDef: 25,
    rangedDef: 20,
    range: 1.6,
    ranged: false,
    mounted: false,
    weapon: 'Spear',
    offhand: 'Shield',
    strongAgainst: ['cavalry'],
    description: 'Defensiv, große Schilde, blockt Kavallerie.',
  },
  infantry: {
    kind: 'infantry',
    name: 'Infantry',
    squad: 33,
    melee: 13,
    rangedDamage: 0,
    health: 85,
    speed: 4.4,
    meleeDef: 15,
    rangedDef: 10,
    range: 1.6,
    ranged: false,
    mounted: false,
    weapon: 'Sword',
    offhand: 'Shield',
    strongAgainst: ['archer'],
    description: 'Wendig, mittlere Werte, stark gegen Bogenschützen.',
  },
  housecarl: {
    kind: 'housecarl',
    name: 'Housecarl',
    squad: 25,
    melee: 14,
    rangedDamage: 0,
    health: 145,
    speed: 3.2,
    meleeDef: 30,
    rangedDef: 25,
    range: 1.6,
    ranged: false,
    mounted: false,
    weapon: 'Axe_Double',
    offhand: null,
    strongAgainst: ['infantry'],
    description: 'Schwer gepanzert, langsam, hält die Linie.',
  },
  cavalry: {
    kind: 'cavalry',
    name: 'Cavalry',
    squad: 20,
    melee: 15,
    rangedDamage: 0,
    health: 120,
    speed: 5.5,
    meleeDef: 20,
    rangedDef: 20,
    range: 1.6,
    ranged: false,
    mounted: true,
    weapon: 'Spear',
    offhand: null,
    strongAgainst: ['archer', 'infantry', 'housecarl'],
    description: 'Schnell, verheerender Ansturm, anfällig gegen Speere.',
  },
};

// Counter-Matrix aus docs/SPEC.md Abschnitt 3.
export function counterMultiplier(attacker: UnitKind, defender: UnitKind): number {
  if (attacker === 'spearman' && defender === 'cavalry') return 3.0;
  if (attacker === 'cavalry' && defender === 'archer') return 2.5;
  if (attacker === 'cavalry' && defender === 'housecarl') return 1.6;
  if (attacker === 'archer' && defender === 'housecarl') return 0.7;
  if (attacker === 'archer' && defender === 'cavalry') return 1.2;
  if (attacker === 'infantry' && defender === 'archer') return 2.0;
  if (attacker === 'housecarl' && defender === 'infantry') return 1.3;
  return 1.0;
}
