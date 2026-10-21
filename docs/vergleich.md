# Abgleich gegen das Original

Stand: 21.10.2026. Gemessen, nicht geschätzt.

## Was verglichen wurde

| Referenz | Datei | Inhalt |
|---|---|---|
| Briefing-Screen | `docs/reference/briefing.png` | Tips-Panel über Schlachtfeld |
| Unit-Info-Panel | `docs/reference/unit-info-cavalry.png` | Werte einer Einheit |
| Schlachtfeld | `docs/reference/cover-1.png`, `cover-2.png` | Kamera, Licht, Farben, Boden |
| Pause-Menü | `docs/reference/pause-menu-015.png` | Menüpunkte |
| Nahkampf | `docs/reference/blood-splatter.png` | Blut, Figurendichte |

## Ergebnis pro Prüfpunkt

| Punkt | Original | Nachbau | Status |
|---|---|---|---|
| Canvas-Auflösung | 960×540 | 960×540, skaliert | gleich |
| HUD-Anordnung | Pause oben links, Timer oben rechts, Trupplisten seitlich, Minimap unten rechts | identisch | gleich |
| Trupplisten | 5 Zeilen, Typ + Squad-Zahl, blau/rot | identisch | gleich |
| Briefing-Texte | Objective, Strategies, Basic Controls, Mini Map, Hotkeys | wortgleich übernommen | gleich |
| Timer | `mm:ss`, läuft hoch | identisch | gleich |
| Fraktionsfarben | blau gegen rot | blau gegen rot | gleich |
| Boden | flach, mattes Mittelgrau, texturlos | `#7a7d76`, texturlos | gleich |
| Himmel/Hintergrund | fast schwarz | `#0d0e13` | gleich |
| Licht | hart, von rechts oben, Schatten nach links | DirectionalLight (40,60,24), Schatten an | ähnlich |
| Truppgrößen | 35 / 27 / 33 / 25 / 20 | identisch | gleich |
| Cavalry-Werte | 15 / 120 / 5.5 / 20 / 20 % / 20 % | identisch | gleich |
| Counter: Speer → Kavallerie | Kavallerie „vulnerable to spears" | ×3.0 | plausibel |
| Bedienung | Linksklick, Rechtsklick, Rad, Mittelklick, Q, E, 1–5, WASD | identisch | gleich |
| Minimap | diagonal, unten rechts | diagonal, unten rechts | gleich |
| 3D-Modelle | Synty POLYGON | KayKit / Quaternius (CC0) | **anders** |
| Animationen | ExplosiveLLC RPG | KayKit (76 Clips) | **anders** |
| Ton | BGM + SFX (v0.1.5) | nicht vorhanden | **fehlt** |
| Cursor | eigener Mittelalter-Cursor | Standard | **fehlt** |
| Kamera-Neigung | ca. 20–30°, tief hinter den Truppen | 23°, hinter den Truppen | ähnlich |
| Blutspritzer | vorhanden | Partikel bei Treffer | vorhanden |

## Der entscheidende Punkt

**„Im Screenshot kein Unterschied" ist ohne die Synty-Packs nicht erreichbar.**
Das Original nutzt POLYGON Fantasy Kingdom + Fantasy Characters (zusammen ca. 350–450 USD).
Der Nachbau nutzt CC0-Modelle, die derselben Stilfamilie angehören (Low-Poly, flache
Flächen, harte Kanten), aber sichtbar andere Figuren zeigen.

Was gleich ist: Bildaufbau, UI, Farbwelt, Kamera, Maßstab, Bedienung, Mechanik.
Was anders ist: die Figuren selbst.

Ein Wechsel auf die lizenzierten Original-Assets ist vorbereitet: Modelle und Waffen
werden nur über `src/render/assets.ts` und `docs/assets.md` zugeordnet. Es ist ein
Dateitausch plus eine Tabelle, kein Umbau.

## Nicht belegbar: Werte der übrigen vier Einheiten

Aus dem Original ist **nur Cavalry** exakt ablesbar (Unit-Info-Panel). Archer,
Spearman, Infantry und Housecarl sind aus ihren Rollenbeschreibungen abgeleitet und in
`docs/SPEC.md` als Annahme markiert. Ein echter 1:1-Abgleich der Mechanik bräuchte
Messungen im laufenden Original — das ließ sich nicht durchführen, weil der
WebGL-Build den Prüfbrowser blockiert (siehe unten).

## Grenzen der Prüfung in dieser Umgebung

- **Der Headless-Browser führt `requestAnimationFrame` nur mit ca. 0,7 fps aus.**
  Ein Spielgefühl-Test (flüssige Bewegung, Eingabeverzögerung) ist hier nicht möglich.
  Geprüft wurde deshalb über einen Vorschub: Simulation rechnet, ein Bild wird gerendert.
  Ergebnis: Schlacht läuft von Aufstellung bis Ergebnis durch (passiver Spieler verliert
  nach ca. 137 s, mit Angriffsbefehl endet sie nach ca. 114 s).
- **Das Original selbst ließ sich nicht durchklicken**: Der Unity-WebGL-Build blockiert
  den Tab (CDP `Runtime.evaluate` läuft in Timeout, Tab geht verloren). Die Referenz
  stammt deshalb aus den offiziellen Screenshots und dem per OCR gelesenen Briefing-Screen.
- **Performance**: 656 Draw Calls, 1,66 Mio. Dreiecke, 320 Skinned Meshes bei 280
  Soldaten. Das Zusammenführen der 12–15 Charakter-Meshes zu einem SkinnedMesh greift
  (1 Draw Call pro Figur). 60 fps auf Desktop ist plausibel, hier aber nicht messbar.

## Offene Punkte

1. Sound (BGM, Treffer-, UI-Töne) fehlt vollständig
2. Eigener Cursor fehlt
3. Werte der vier nicht belegten Einheiten sind Annahmen
4. Kamera-Neigung und Blickwinkel sind nachjustierbar, aber nicht gegen das laufende
   Original verifizierbar
5. Waffen-Meshes könnten in die Figur eingerechnet werden (Draw-Call-Reduktion)

## Messung 21.10.2026: Bodenfarbe und Kamera

Statt zu schätzen wurde der Boden pixelweise verglichen (Median über mehrere
Bildbereiche, beide Bilder auf 960×540 gebracht).

| Messpunkt | Original (`v011-capture.png`) | Nachbau |
|---|---|---|
| Bildmitte | `#78878b` | `#77868a` |
| Fernbereich | `#78878b` | `#78878a` |
| Oberer Rand | `#788688` | `#7b8a8f` |
| Mittlere Helligkeit | 100,9 | 114,5 |

Ergebnis: Die Bodenfarbe trifft auf 1–2 Farbstufen genau. Die mittlere
Helligkeit liegt 13 % höher, weil im Nachbau mehr Figuren im Bild stehen.

**Wichtige Korrektur:** Der erste Stand hatte einen fast schwarzen Himmel
(`#0d0e13`) und einen dunkleren, wärmeren Boden (`#676a64`). Das war falsch.
Am Original gemessen füllt der Boden das **gesamte** Bild — es gibt keinen
Himmelsstreifen. Hintergrund und Nebel tragen jetzt dieselbe Bodenfarbe,
die Bodenfläche ist 1600×1600 statt 140×140, damit der Horizont außerhalb
des Bildes liegt.

**Kamera:** Ebenfalls korrigiert. Vorher stand die Kamera nah hinter den
eigenen Truppen (Abstand 28, Neigung 23°), die eigenen Formationen liefen
unten aus dem Bild. Am Original gemessen ist das gesamte Schlachtfeld zu
sehen: Abstand 92, Neigung 34°, Blick auf die Feldmitte. Beide Armeen
(z = ±38) sind vollständig im Bild, darüber bleibt ein breiter leerer
Bodenstreifen.

## Was weiterhin offen ist

Die Figuren selbst. Das Original zeigt Soldaten mit Schilden, Helmen,
Federbüschen und geviertelten Bannern in einem sehr eigenen Stil (Synty
POLYGON). Der Nachbau zeigt CC0-Figuren ohne Schild- und Banner-Details.
Ein Bildvergleich auf Figurenebene ist deshalb nicht sinnvoll, solange die
Assets nicht getauscht sind.

## Versuchte, gescheiterte Wege (nicht wiederholen)

- **Werte aus dem Unity-Build extrahieren.** `data.unity3d` ließ sich
  entpacken (UnityFS v8, LZ4, 850 Blöcke, 6 Knoten). `level0` enthält alle
  UI-Texte im Klartext, aber die Zahlenwerte der Einheiten liegen nicht als
  lesbare Floats vor — die Suche nach der belegten Cavalry-Kombination
  (15 / 120 / 5,5 / 20) fand nichts. Il2Cpp-Code liegt im WASM, die
  Metadaten sind ohne vollständigen TypeTree nicht zuzuordnen.
  Aufwand für den Rest: hoch, Erfolg ungewiss.
- **Weitere Referenzbilder für Einheitenwerte.** `cover-2.png` und
  `shot-page2.png` zeigen reine Szenen ohne UI. Nur
  `unit-types-panel.png` enthält Werte, und zwar für Cavalry.
