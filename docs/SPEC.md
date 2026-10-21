# SPEC — Formation Battle 3D

Nachbau des itch.io-Prototyps **Formation Battle v0.1.5** (Oki Aki) als Web-App.
Referenz: `docs/reference/` (Screenshots des Originals), `docs/recon.md` (Fakten).

## 1. Produkt

Eine Schlacht: **5 Trupps Spieler gegen 5 Trupps KI**. Sieg, wenn alle gegnerischen
Trupps vernichtet sind. Niederlage, wenn alle eigenen fallen. Kein Fortschritt,
keine Kampagne, keine Menüschlacht — direkt ins Gefecht, wie im Original.

Auflösung 960×540 als Basis-Canvas, auf Fenstergröße skaliert (Letterbox nicht nötig,
Original füllt das Fenster bei fester Aspect-Ratio).

## 2. Einheiten

Truppgröße = Anzahl Soldaten im Trupp (sichtbar als Figuren, exakt so viele).

| Typ | Squad | Melee | Health | Speed | MeleeDef | RangedDef | Waffe | Modell |
|---|---|---|---|---|---|---|---|---|
| Archer | 35 | 6 | 55 | 4.6 | 5% | 10% | Bow | Rogue_Hooded |
| Spearman | 27 | 11 | 95 | 4.0 | 25% | 20% | Spear + Shield | Knight |
| Infantry | 33 | 13 | 85 | 4.4 | 15% | 10% | Sword + Shield | Rogue |
| Housecarl | 25 | 14 | 145 | 3.2 | 30% | 25% | Axe_Double | Barbarian |
| Cavalry | 20 | 15 | 120 | 5.5 | 20% | 20% | Spear (beritten) | Knight + Horse |

**Verifiziert** ist nur Cavalry (Melee 15 / Health 120 / Speed 5.5 / Squad 20 / 20% / 20%).
Alle anderen Werte sind aus der Rollenbeschreibung abgeleitet und in `docs/balance.md`
als Annahme markiert.

Rollen laut Original-Beschreibung:
- Archer: Fernkampf, konstanter Schaden, bricht im Nahkampf
- Spearman: defensiv, große Schilde, blockt Kavallerie
- Infantry: wendig, mittlere Werte
- Housecarl: schwer gepanzert, langsam, hält die Linie
- Cavalry: schnell, verheerender Ansturm, anfällig gegen Speere

## 3. Counter-Matrix (Multiplikator auf Schaden)

| Angreifer → Ziel | Mult |
|---|---|
| Spearman → Cavalry | 3.0 |
| Cavalry → Archer | 2.5 |
| Cavalry → Housecarl | 1.6 |
| Archer → Housecarl | 0.7 |
| Archer → Cavalry | 1.2 |
| Infantry → Archer | 2.0 |
| Housecarl → Infantry | 1.3 |
| Alle anderen | 1.0 |

Zusätzlich:
- **Fernkampf-Malus im Nahkampf:** Archer im Kontakt → eigener Schaden ×0.4
- **Rückenschaden:** Angriff von hinten (>120° zur Blickrichtung) ×1.5
- **Ansturmbonus:** Cavalry mit Geschwindigkeit > 80 % beim Aufprall ×1.8, danach 3 s Abklingzeit
- **Zufall:** ±15 % pro Treffer (deterministisch über Seed, damit Tests reproduzierbar sind)

## 4. Kampf

- Jeder Soldat ist eine eigene Figur mit Position, HP, Ziel, Angriffs-Cooldown.
- Angriff: Reichweite 1.6 (Nahkampf) bzw. 14 (Bogen). Bogen schießt Projektile mit
  Flugzeit 0.35 s und Bogenhöhe 2.5.
- Schaden pro Treffer: `unit.meleeDamage * counterMult * random(0.85..1.15) * (1 - defense/100)`
  bei Fernkampf `rangedDef`, sonst `meleeDef`.
- Tote Soldaten bleiben als Leiche liegen (max. 60 s, dann ausblenden).
- Soldaten im Trupp wählen Ziele selbst (nächster Feind in Reichweite), außer der
  Trupp hat einen expliziten Angriffsbefehl → dann dessen Ziel bevorzugen.

## 5. Formation & Bewegung

- Trupp = Raster aus Reihen: Breite = `ceil(sqrt(squadSize * 1.6))`, Abstand 0.85 m.
- Trupp bewegt sich als Ganzes; Soldaten laufen zu ihren Sollpositionen
  (Sollposition = Truppenposition + rotierte Rasterposition).
- Drehung: Trupp dreht sich zur Bewegungsrichtung, Blickrichtung = letzte Bewegungsrichtung.
- Ankunft: Trupp stoppt, wenn Mittelpunkt Ziel erreicht (Toleranz 0.6 m).
- **Auto-Attack** (Q): aus = Trupp greift nur auf Befehl an; an = greift alles in
  Reichweite an. Standard: an.
- **Waffenwechsel** (E): Cavalry Speer ↔ Schwert; Archer Bogen ↔ Dolch. Andere Trupps: keine Wirkung.

## 6. KI (Gegner)

Zustandsmaschine pro Trupp, alle 0.5 s neu bewertet:
1. Kein Gegner in Sicht (24 m) → vorrücken zur Mitte, Formation halten
2. Gegner in Sicht → günstigsten Gegner wählen (Counter-Matrix × Distanz)
3. Cavalry: wenn Ziel > 8 m entfernt → Anlauf nehmen (gerade Linie, volle Geschwindigkeit)
4. Archer: Abstand halten — wenn Feind < 10 m, zurückweichen
5. Trupp mit > 70 % Verlusten → Moralbruch, zieht sich 12 m zurück, greift danach wieder an

## 7. Kamera

- Startet hinter den eigenen Truppen, Blick in Richtung Gegner
- Neigung 25°, Höhe 9 m, Abstand 22 m, FOV 45
- WASD verschiebt auf der XZ-Ebene (12 m/s), Mausrad zoomt (Abstand 10–40 m),
  Mittelklick+Drag verschiebt relativ zur Mausbewegung
- Kamera bleibt in den Weltgrenzen (±60 m)

## 8. Darstellung

- Boden: flache Ebene 140×140 m, Farbe `#7a7d76`, `roughness 1`, keine Textur
- Hintergrund/Himmel: `#0d0e13` (fast schwarz)
- Licht: eine DirectionalLight aus (1, 1.2, 0.6) normiert, Intensität 2.2, Schatten an
  (2048er Map, orthographisch ±45 m), Ambient 0.35
- Fraktionsfarben über Material-`color`-Tint: Spieler `#5b6ee1` (blau), Gegner `#d1483f` (rot)
- Blutspritzer: bei Treffer kleine rote Partikel/Decals am Soldaten
- Grasbüschel: goldbraune Streifen am Kartenrand (wie im Original oben rechts)
- Auswahl: Ring am Boden unter dem gewählten Trupp, weiß
- Bewegungsbefehl: kurze Linie/Gizmo am Zielort, verblasst nach 1 s

## 9. HUD (DOM über dem Canvas, Positionen relativ in %)

- **Oben links:** Button „Pause" (Icon ⏸)
- **Oben rechts:** Timer `mm:ss`, startet bei 00:00, läuft hoch
- **Oben Mitte:** Fraktionsbanner (SVG-Flagge, blau)
- **Links mitte:** 5 Zeilen eigene Trupps: Nummer 1–5, Typname, Squad-Zahl,
  blauer HP-Balken, Icon. Klick wählt aus.
- **Rechts mitte:** 5 Zeilen Gegner, rot, ohne Klick
- **Unten rechts:** Minimap 180×120, diagonale Darstellung (Dreieck), Einheiten als
  Punkte (blau/rot), Linksklick springt zur Position, Rechtsklick gibt Marschbefehl
- **Unten mitte:** Kommandoleiste mit zwei Buttons: „Auto Attack" (Q) und „Switch Weapon" (E),
  zeigen aktiven Zustand
- **Unten links:** „Formation Battle - v0.1.5"

## 10. Overlays

**Briefing** (beim Start, blockiert Eingabe):
Zweispaltiges Panel, Titel „Tips", X zum Schließen. Inhalte wortgleich aus dem Original:
- Objective: „Defeat all 5 enemy platoons to win the battle." / „You command 5 platoons of your own soldiers."
- Strategies: „Choosing the right platoon to counter the enemy is crucial:" + 5 Stichpunkte
- Basic Controls: Left Click / Right Click
- Mini Map: „Left click for quick navigation. Right click to move a selected platoon on it."
- Hotkeys: Select Squads 1–5, Auto Attack Q, Switch Weapon E, Move Camera WASD
- Button „Unit Info"

**Unit Info:** Karten mit Pfeilen links/rechts, pro Einheit Werte mit Icons
(Melee Damage, Health, Speed, Squad Size, Melee Defense, Ranged Defense) und
„Strong Against" mit Porträts.

**Pause:** Restart, Settings, Tips, Unit Info, Resume.

**Ergebnis:** „Victory" / „Defeat" mit Zeit und Button „Restart".

## 11. Steuerung

| Eingabe | Wirkung |
|---|---|
| Linksklick | Trupp wählen (Canvas, Seitenliste, Minimap) |
| Rechtsklick | Bewegen / Feind angreifen |
| Mausrad | Zoom |
| Mittelklick + Drag | Kamera |
| WASD | Kamera |
| Q | Auto-Attack umschalten |
| E | Waffe wechseln |
| 1–5 | Trupp wählen |
| Esc | Pause |

Regeln: Klick auf eigenen Trupp wählt, greift nie an. Rechtsklick auf Feind = Angriff,
auf Boden = Marsch. Ohne Auswahl bewirkt Rechtsklick nichts.

## 12. Technik

- Vite + TypeScript strict + Three.js
- `src/sim/` importiert **kein** Three.js (in Node testbar)
- Soldaten: GLB-Meshes zu **einem** SkinnedMesh zusammengeführt (1 Draw Call pro Figur),
  Klon über `SkeletonUtils.clone`, Animation über `AnimationMixer`
- Ziel: 60 FPS bei 280 Figuren auf Desktop
- Assets lokal unter `public/assets/`

## 13. Abnahme

1. `npm run build` fehlerfrei, `npm test` grün
2. Schlacht ist von Anfang bis Sieg/Niederlage spielbar
3. Jede Zeile aus Abschnitt 11 im Browser geprüft
4. Screenshots gegen `docs/reference/` verglichen (OCR + Farbkarte), Abweichungen dokumentiert
