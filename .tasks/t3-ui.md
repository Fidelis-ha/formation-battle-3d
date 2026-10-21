Implementiere HUD und Overlays (DOM) für dieses Projekt. Lies docs/SPEC.md (Abschnitte 9, 10) und docs/recon.md (exakte Texte und Positionen).

HARTE REGELN
- Nur Dateien unter src/ui/ anlegen/ändern. src/sim/ und src/render/ NICHT anfassen.
- TypeScript strict, keine any. Kein Framework, reines DOM.
- Alle Texte WORTGLEICH aus docs/recon.md übernehmen (englische UI wie im Original).

DATEIEN UND EXPORTS

src/ui/style.css
  - Reset, #app füllt das Fenster, #scene absolut, #ui absolut darüber, pointer-events: none
  - Kinder von #ui, die klickbar sind, bekommen pointer-events: auto
  - Schrift: system-ui/Segoe UI, Farben wie im Original (dunkle Panels rgba(25,25,25,0.88),
    gelbe Überschriften #ffd843, weiße Fließtexte)
  - Buttons: abgerundet, beige/khaki (#cfc6a8) mit weißer Umrandung und dunkler Schrift
  - Feste Basisgröße 960x540, per transform: scale() auf Fenstergröße skaliert
    (Klasse .ui-scale auf #ui, Skalierung setzt main.ts)

src/ui/hud.ts
  export interface HudHandlers {
    onSelectPlatoon(id: number): void;
    onToggleAutoAttack(): void;
    onSwitchWeapon(): void;
    onPause(): void;
    onMinimapClick(x: number, z: number): void;
    onMinimapOrder(x: number, z: number): void;
  }
  export interface Hud {
    root: HTMLElement;
    update(battle: import('../sim/types').Battle, selectedId: number | null): void;
    setTime(seconds: number): void;
    setPaused(paused: boolean): void;
  }
  export function createHud(handlers: HudHandlers): Hud

  Aufbau (Positionen in % der 960x540-Fläche, wie docs/recon.md):
  - oben links: Pause-Button
  - oben rechts: Timer mm:ss
  - oben Mitte: Fraktionsbanner (einfaches SVG, blau)
  - links mitte: 5 Zeilen eigene Trupps, je Nummer 1-5, Typname, Squad-Zahl,
    HP-Balken (blau), Icon-Kreis; Klick wählt aus; gewählter Trupp hervorgehoben
  - rechts mitte: 5 Zeilen Gegner, rot, nicht klickbar
  - unten rechts: Minimap 180x120 (Canvas), Boden dunkelblau, Einheiten als Punkte
    (blau/rot), Linksklick = onMinimapClick, Rechtsklick = onMinimapOrder
  - unten mitte: zwei Buttons "Auto Attack" (Q) und "Switch Weapon" (E) mit Zustandsanzeige
  - unten links: "Formation Battle - v0.1.5"

src/ui/overlays.ts
  export interface OverlayHandlers { onClose(): void; onRestart(): void; onResume(): void; }
  export interface Overlays {
    root: HTMLElement;
    showBriefing(): void;
    showUnitInfo(): void;
    showPause(): void;
    showResult(status: 'victory' | 'defeat', seconds: number): void;
    hideAll(): void;
    isBlocking(): boolean;
  }
  export function createOverlays(handlers: OverlayHandlers): Overlays

  - Briefing: zweispaltiges Panel mit Titel "Tips" und X-Button. Inhalte wortgleich:
    Objective, Strategies (5 Stichpunkte), Basic Controls, Mini Map, Hotkeys,
    Button "Unit Info" (öffnet Unit Info). Schließen per X oder Klick außerhalb.
  - Unit Info: Karte mit Pfeilen links/rechts, eine Einheit je Seite.
    Werte aus UNIT_STATS (import aus ../sim/units): Melee Damage, Health, Speed,
    Squad Size, Melee Defense, Ranged Defense, plus Beschreibungstext und
    "Strong Against" mit den Porträt-Kürzeln.
  - Pause: Restart, Settings (deaktiviert mit Hinweis "not available in this build"),
    Tips, Unit Info, Resume.
  - Ergebnis: "Victory" bzw. "Defeat", Zeit, Button "Restart".

src/ui/index.ts
  export * from './hud';
  export * from './overlays';

ZUM SCHLUSS
- "npx tsc --noEmit" muss fehlerfrei durchlaufen.
- Keine main.ts, keine Logik aus sim/ verändern.
- Melde: Dateien, tsc-Ergebnis, offene Punkte.
