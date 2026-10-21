Implementiere die 3D-Darstellung (Three.js) für dieses Projekt. Lies docs/SPEC.md (Abschnitte 7, 8, 12) und docs/assets.md.

HARTE REGELN
- Nur Dateien unter src/render/ anlegen/ändern. src/sim/ NICHT anfassen.
- TypeScript strict, keine any.
- three@0.180 ist installiert. Nutze ausschließlich Module aus 'three' und 'three/examples/jsm/...'.
- Kommentare auf Deutsch, kurz.

KONTEXT
src/sim/types.ts und src/sim/battle.ts existieren bereits. Der Renderer liest den Battle-Zustand
und stellt ihn dar. Er verändert ihn nicht.

DATEIEN UND EXPORTS

src/render/assets.ts
  export interface CharacterAsset {
    scene: THREE.Group;          // Vorlage, wird pro Soldat geklont
    clips: THREE.AnimationClip[];
    handslotR: THREE.Object3D;   // Ankerknoten für Waffe
    handslotL: THREE.Object3D | null;
  }
  export interface WeaponAsset { scene: THREE.Group; }
  export interface Assets {
    characters: Record<string, CharacterAsset>;   // 'knight','rogue','rogue_hooded','barbarian','mage'
    horse: { scene: THREE.Group; clips: THREE.AnimationClip[] };
    weapons: Record<string, WeaponAsset>;         // 'spear','bow','shield_round','sword','axe'
  }
  export function loadAssets(onProgress?: (p: number) => void): Promise<Assets>

  Laden:
  - Charaktere: /assets/models/{Knight,Rogue,Rogue_Hooded,Barbarian,Mage}.glb via GLTFLoader
  - Pferd: /assets/models/Horse.fbx via FBXLoader
  - Waffen: /assets/weapons/{Spear,Bow_Wooden,Shield_Round,Sword,Axe_Double}.fbx via FBXLoader
  - WICHTIG (Performance): Jeder Charakter hat 12-15 Meshes mit EINEM Material und EINER Textur.
    Führe sie zu EINEM SkinnedMesh zusammen (BufferGeometryUtils.mergeGeometries mit
    Skin-Attributen skinIndex/skinWeight, gemeinsames Skelett). Ergebnis: 1 Draw Call pro Soldat.
    Falls das Zusammenführen scheitert, ist ein Fallback auf die Originalmeshes erlaubt,
    aber protokolliere das per console.warn.
  - Waffen auf realistische Größe skalieren (Speer ca. 2.2 m, Bogen 1.2 m, Schild 0.7 m,
    Schwert 0.9 m, Axt 1.3 m) und relativ zur Hand ausrichten.
  - Texturen: colorSpace = SRGBColorSpace.

src/render/character.ts
  export type SoldierVisual = {
    root: THREE.Group;
    mixer: THREE.AnimationMixer;
    actions: Record<string, THREE.AnimationAction>;
    kind: string;
    faction: 'player' | 'enemy';
  };
  export function createSoldierVisual(assets: Assets, kind: string, faction: 'player'|'enemy'): SoldierVisual
  export function playAction(v: SoldierVisual, name: string, fade?: number): void

  - Klonen mit SkeletonUtils.clone (aus 'three/examples/jsm/utils/SkeletonUtils.js')
  - Fraktionsfarbe: Material klonen und per color multiplizieren
    (player #5b6ee1, enemy #d1483f), Intensität so, dass die Textur erkennbar bleibt
  - Animationen: 'Idle', 'Walking_A', 'Running_A', '1H_Melee_Attack_Slice_Horizontal',
    '1H_Melee_Attack_Stab', '1H_Ranged_Shoot', '2H_Melee_Attack_Chop', 'Death_A'
    Wähle die Angriffsanimation nach Einheitentyp.
  - Waffe an handslotR hängen (Schild an handslotL).

src/render/scene.ts
  export interface SceneHandle {
    renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera;
    sun: THREE.DirectionalLight; ground: THREE.Mesh;
  }
  export function createScene(canvas: HTMLCanvasElement): SceneHandle
  export function resizeScene(h: SceneHandle, width: number, height: number): void

  - Boden: PlaneGeometry 140x140, Farbe #7a7d76, MeshStandardMaterial roughness 1, Empfänger von Schatten
  - Hintergrund #0d0e13, Nebel (FogExp2) sehr schwach, damit der Rand weich wird
  - Licht: DirectionalLight Intensität 2.2, Position (40, 60, 24), Schatten 2048,
    orthographische Kamera ±45; AmbientLight 0.35
  - Grasbüschel: ~40 goldbraune Low-Poly-Büschel am Kartenrand (#b8892f), einfache Kegel/Boxen
  - Renderer: antialias true, pixelRatio min(devicePixelRatio, 2), Schatten PCFSoft

src/render/camera.ts
  export interface CameraRig {
    update(dt: number, keys: Set<string>): void;
    onWheel(dy: number): void;
    beginPan(x: number, y: number): void;
    panTo(x: number, y: number): void;
    endPan(): void;
    focus(x: number, z: number): void;
    readonly target: THREE.Vector3;
  }
  export function createCameraRig(camera: THREE.PerspectiveCamera, canvas: HTMLCanvasElement): CameraRig

  - Start: Blick von (0, 9, 60) auf (0, 0, 20), Neigung ca. 25 Grad, FOV 45
  - WASD verschiebt das Ziel auf der XZ-Ebene mit 12 m/s
  - Mausrad ändert den Abstand 10..40 m (weich, gedämpft)
  - Mittelklick+Drag verschiebt relativ zur Mausbewegung (Faktor 0.05 pro Pixel)
  - Ziel bleibt in ±60 m

src/render/battleview.ts
  export interface BattleView {
    update(dt: number, events: import('../sim/types').BattleEvent[]): void;
    syncBattle(): void;                 // Figuren an Sim-Positionen setzen
    screenToWorld(px: number, py: number): { x: number; z: number };
    worldToScreen(x: number, z: number): { x: number; y: number };
    setSelected(platoonId: number | null): void;
    showMoveMarker(x: number, z: number): void;
    dispose(): void;
  }
  export function createBattleView(scene: SceneHandle, assets: Assets, battle: import('../sim/types').Battle): BattleView

  - Pro Soldat eine Figur (280 Stück). Sichtbarkeit an Sim-Zustand koppeln.
  - Bewegung: Position direkt aus der Sim übernehmen, Blickrichtung aus facing.
  - Animation nach Zustand: idle/move/attack/dead (Death_A bleibt liegen)
  - Blut: bei 'hit'-Event kleine rote Partikel (InstancedMesh, max 200, Lebensdauer 0.6 s)
  - Pfeile: bei 'shot'-Event ein kleines Projektil-Mesh auf Bogenflugbahn
  - Auswahlring: Ring unter dem gewählten Trupp, weiß, pulsiert leicht
  - Bewegungsmarker: kleiner Ring am Zielort, verblasst nach 1 s

ZUM SCHLUSS
- "npx tsc --noEmit" muss fehlerfrei durchlaufen.
- Baue KEINE main.ts und KEINE UI. Nur die vier Dateien oben.
- Melde: Dateien, tsc-Ergebnis, getroffene Annahmen, was noch nicht geprüft ist.
