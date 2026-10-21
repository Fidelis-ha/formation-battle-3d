# Recon — Formation Battle v0.1.5 (Oki Aki)

## Herkunft
- Spielseite: https://okiaki.itch.io/formation-battle
- Eingebettetes Spiel: `https://html-classic.itch.zone/html/14407415/FormationBattle_v0.1.5/index.html`
- Build-Dateien: `Build/FormationBattle_v0.1.5.{loader.js,data.gz,framework.js.gz,wasm.gz}`
- **`.gz` ist kein gzip.** Magic-Bytes: `UnityWeb` (data), `\x00asm` (wasm), `var uni` (framework).
  Die Dateien werden unkomprimiert ausgeliefert.
- Engine: Unity 6, Universal Render Pipeline, WebGL, Canvas 960×540

## Assets im Build (aus Strings gelesen, NICHT extrahiert)
- `Polygon_Fantasy_Characters_Texture_03_B`, `PolygonFantasyKingdom_Texture_01_A`,
  `PolygonFantasyHero_Texture_Mask_01` → **Synty POLYGON** (Fantasy Kingdom + Fantasy Characters)
- `ExplosiveLLC/RPG` → Animationspaket
- Icons: `ArcherIcon_red/blue`, `SpearmanIcon_*`, `HousecarlIcon_*`, `SkirmisherIcon_*`,
  `SwordsmanIcon_*` — 7 Icon-Sätze vorhanden, gespielt werden 5 Typen

Rechtlich: Der Build darf gelesen werden, um Mechanik und Herkunft zu verstehen.
Er ist **keine** Asset-Quelle. Es wurden keine Assets aus dem Build übernommen.

## Einheiten im laufenden Spiel (Unit-Info-Panel, v0.1.3/v0.1.5)
| Typ | Squad | stark gegen |
|---|---|---|
| Archer | 35 | (Fernkampf) |
| Spearman | 27 | Cavalry |
| Infantry | 33 | Archer |
| Housecarl | 25 | Infantry |
| Cavalry | 20 | Archer, Infantry, Housecarl |

Cavalry-Werte (exakt abgelesen): Melee Damage 15 · Health 120 · Speed 5.5 ·
Squad Size 20 · Melee Defense 20% · Ranged Defense 20% ·
Text: „Mobile shock troops capable of swift flanks and devastating charges but vulnerable to spears."

## UI-Texte (wortgleich, per OCR)
**Tips-Panel**
- Objective
  - „Defeat all 5 enemy platoons to win the battle."
  - „You command 5 platoons of your own soldiers."
- Strategies
  - „Choosing the right platoon to counter the enemy is crucial:"
  - „- Use defensive units to shield weaker units"
  - „- Protect Archers by keeping them behind."
  - „- Use Cavalry to flank enemies"
  - „- Good positioning can turn the tide of battle"
  - „- Each unit type has unique strengths and weaknesses."
  - „Check the Unit Info Page for details:"
  - Button: „Unit Info"
- Basic Controls
  - „Left Click" — „Select a platoon"
  - „Right Click" — „Move or Attack"
- Mini Map:
  - „Left click for quick navigation."
  - „Right click to move a selected platoon on it."
- Hotkeys
  - „Select Squads" — 1 … 5
  - „Auto Attack" — Q
  - „Switch Weapon" — E
  - „Move Camera" — W A S D

**HUD**
- Oben links: „Pause"
- Oben rechts: `00:00`
- Links: Liste eigener Trupps mit Squad-Zahl
- Rechts: Liste gegnerischer Trupps mit Squad-Zahl
- Unten links: „Formation Battle - v0.1.5"
- Unten Mitte: Kommandoleiste (Auto Attack, Switch Weapon)
- Unten rechts: Minimap

## Layout (Canvas-Koordinaten bei 960×540, aus OCR umgerechnet)
- Pause-Button: (43, 8)
- Timer: (929, 5)
- Tips-Panel: x 225–730, y 118–440
- Unit-Info-Button: (355, 426)
- Truppliste links: x 10–200, y 250–420
- Truppliste rechts: x 760–950, y 250–420
- Minimap: unten rechts, ca. x 780–950, y 380–530

## Bildsprache (offizielle Screenshots)
- Low-Poly, flache Farbflächen, harte Kanten, texturloser Boden
- Kamera hinter den eigenen Truppen, 20–30° Neigung, 2–3 m Höhe, leichtes Weitwinkel
- Boden mittelgrau, oben schwarzer Hintergrund
- Blau/Violett (Spieler) gegen Rot/Gold (Gegner), graue Helme, Rundschilde
- Hartes Licht von rechts oben, scharfe Schatten nach links
- Goldbrauner Grasstreifen am Rand, dünne weiße Bewegungslinien

## Widersprüche (dokumentiert, nicht aufgelöst)
1. Store-Seite nennt 7 Einheitentypen (inkl. Swordsman, Skirmisher), gespielt werden 5.
   → Der Build gewinnt.
2. Devlog #3 nennt als Roster „Archer, Infantry, Spearman, Housecarl, Cavalry" — deckt sich
   mit dem Unit-Info-Panel. Die Store-Seite ist älter/weiter gefasst.
3. Die itch.io-Tags sagen „Top-Down", die Screenshots zeigen eine niedrige Kamera hinter
   den Truppen. → Screenshots gewinnen.
