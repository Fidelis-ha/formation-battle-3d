Implementiere den Simulationskern dieses Projekts (TypeScript, Vite). Lies zuerst docs/SPEC.md und docs/recon.md.

HARTE REGELN
- Nur Dateien unter src/sim/ und tests/ anlegen/ändern. Nichts anderes anfassen.
- src/sim/ darf NIEMALS 'three' importieren. Reines TypeScript, läuft in Node.
- TypeScript strict. Keine any. Keine externen Pakete außer vitest (nur in tests/).
- Kommentare auf Deutsch, kurz.

DATEIEN UND EXPORTS (genau diese Namen, der Renderer hängt davon ab)

src/sim/types.ts
  export type Faction = 'player' | 'enemy';
  export type UnitKind = 'archer' | 'spearman' | 'infantry' | 'housecarl' | 'cavalry';
  export interface UnitStats {
    kind: UnitKind; name: string; squad: number; melee: number; health: number;
    speed: number; meleeDef: number; rangedDef: number; range: number;
    ranged: boolean; mounted: boolean; weapon: string; offhand: string | null;
    strongAgainst: UnitKind[]; description: string;
  }
  export interface Soldier {
    id: number; platoonId: number; faction: Faction; kind: UnitKind;
    x: number; z: number; hp: number; maxHp: number;
    targetId: number | null; cooldown: number;
    state: 'idle' | 'move' | 'attack' | 'dead';
    facing: number; slot: number; deadTime: number;
  }
  export interface Platoon {
    id: number; faction: Faction; kind: UnitKind;
    x: number; z: number; destX: number | null; destZ: number | null;
    targetPlatoonId: number | null; facing: number;
    autoAttack: boolean; weaponMode: number; moraleBroken: boolean;
    soldiers: Soldier[]; aliveCount: number;
  }
  export interface Projectile {
    id: number; x: number; z: number; tx: number; tz: number;
    y: number; t: number; dur: number; damage: number;
    faction: Faction; targetId: number;
  }
  export interface Battle {
    platoons: Platoon[]; projectiles: Projectile[];
    time: number; status: 'running' | 'victory' | 'defeat';
    seed: number; nextId: number; events: BattleEvent[];
  }
  export type BattleEvent =
    | { type: 'hit'; soldierId: number; damage: number; x: number; z: number }
    | { type: 'death'; soldierId: number; x: number; z: number; faction: Faction }
    | { type: 'shot'; fromX: number; fromZ: number; toX: number; toZ: number; faction: Faction }
    | { type: 'morale'; platoonId: number }
    | { type: 'end'; status: 'victory' | 'defeat' };

src/sim/units.ts
  export const UNIT_STATS: Record<UnitKind, UnitStats>  // Werte exakt aus docs/SPEC.md Abschnitt 2
  export function counterMultiplier(attacker: UnitKind, defender: UnitKind): number  // Matrix aus SPEC Abschnitt 3

src/sim/formation.ts
  export function formationSlots(count: number, spacing?: number): { x: number; z: number }[]
  export function formationWidth(count: number): number

src/sim/battle.ts
  export function createBattle(seed?: number): Battle
  export function step(battle: Battle, dt: number): void
  export function issueMove(battle: Battle, platoonId: number, x: number, z: number): void
  export function issueAttack(battle: Battle, platoonId: number, targetPlatoonId: number): void
  export function toggleAutoAttack(battle: Battle, platoonId: number): boolean
  export function switchWeapon(battle: Battle, platoonId: number): number
  export function platoonAt(battle: Battle, x: number, z: number, faction?: Faction): Platoon | null
  export function drainEvents(battle: Battle): BattleEvent[]

VERHALTEN (docs/SPEC.md Abschnitte 2-6 sind verbindlich)
- 5 Trupps je Seite. Aufstellung: Spieler bei z=+38 in Reihe (x = -24,-12,0,12,24),
  Gegner bei z=-38 gespiegelt. Spieler-Kamera schaut in -z-Richtung.
- Soldaten laufen zu ihren Formations-Slots (Sollposition = Truppenposition + rotierter Slot).
- Zielwahl: nächster lebender Feind innerhalb der Waffenreichweite; bei explizitem
  Angriffsbefehl bevorzugt Soldaten des befohlenen Trupps.
- Schaden: melee * counterMultiplier * zufall(0.85..1.15) * (1 - def/100).
  Fernkampf nutzt rangedDef, Nahkampf meleeDef. Fernkampf im Kontakt: eigener Schaden x0.4.
  Angriff von hinten (>120 Grad zur Blickrichtung des Ziels): x1.5.
  Cavalry mit Geschwindigkeit > 80% beim Aufprall: x1.8, danach 3s Abklingzeit.
- Fernkampf erzeugt Projektile (Flugzeit 0.35s), Treffer erst bei Ankunft.
- KI wie SPEC Abschnitt 6, Neuauswertung alle 0.5s.
- Sieg/Niederlage setzt battle.status und schickt ein 'end'-Event.
- Der Zufall läuft über einen eigenen deterministischen Generator (mulberry32 mit battle.seed),
  damit Tests reproduzierbar sind. Kein Math.random.

tests/sim.test.ts (vitest)
  - Counter-Matrix: Spearman->Cavalry 3.0, Cavalry->Archer 2.5, Rest wie SPEC
  - formationSlots(20) liefert 20 Positionen, Breite = ceil(sqrt(20*1.6))
  - createBattle liefert 10 Trupps, zusammen 280 Soldaten, Status 'running'
  - Determinismus: zwei Battles mit gleichem Seed, 60 Schritte, identische HP-Summen
  - Kein Eigenbeschuss: nach 30s kein Soldat durch eigene Fraktion gestorben
  - Siegbedingung: alle Gegner auf hp 0 setzen, step() setzt status 'victory'
  - Schadensformel: mit fixem Seed liegt Schaden im erwarteten Fenster

ZUM SCHLUSS
- Führe "npx tsc --noEmit" und "npx vitest run" aus. Beide müssen fehlerfrei durchlaufen.
- Melde am Ende: welche Dateien angelegt, Testergebnis (Anzahl Tests, alle grün), offene Punkte.
