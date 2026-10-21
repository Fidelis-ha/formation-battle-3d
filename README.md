# Formation Battle 3D

Eigenständiger Web-Nachbau des itch.io-Prototyps
[Formation Battle](https://okiaki.itch.io/formation-battle) von Oki Aki.

Kein Original-Code, keine Original-Assets. Nachgebaut sind Spielmechanik,
Bildaufbau und Bedienung; die 3D-Modelle stammen aus frei lizenzierten
CC0-Paketen (siehe `docs/assets.md`).

## Spielen

- Lokal: `npm install && npm run dev` → http://127.0.0.1:5183
- Build: `npm run build` → `dist/` (statisch, kein Server nötig)

## Steuerung

| Eingabe | Wirkung |
|---|---|
| Linksklick | Trupp wählen (Spielfeld, Seitenliste, Minimap) |
| Rechtsklick | Bewegen / Feind angreifen |
| Mausrad | Zoom |
| Mittelklick + Ziehen | Kamera verschieben |
| WASD | Kamera verschieben |
| Q | Auto-Attack umschalten |
| E | Waffe wechseln |
| 1–5 | Trupp wählen |
| Esc | Pause |

## Aufbau

```
src/sim/     Spiellogik, ohne Three.js — in Node testbar
src/render/  Three.js: Szene, Kamera, Figuren, Effekte
src/ui/      HUD und Overlays (DOM)
docs/        Spezifikation, Recon, Assets, Vergleich
```

## Dokumentation

- `docs/SPEC.md` — verbindliche Spezifikation des Nachbaus
- `docs/recon.md` — was aus dem Original belegt ist (Werte, Texte, Layout)
- `docs/assets.md` — Herkunft und Lizenz aller Assets
- `docs/vergleich.md` — Abgleich gegen Referenz-Screenshots

## Stand

Prototyp, spielbar von Aufstellung bis Ergebnis.

Belegt und geprüft:
- Simulation mit 8 Tests, Schlacht endet nachweislich (passiv: Niederlage nach
  137 s; mit Angriffsbefehl: Ende nach 114 s)
- Steuerung: jede Eingabe setzt den erwarteten Zustand (Tastatur, Links- und
  Rechtsklick, Ziel- und Marschbefehle, Auswahlregeln)
- Bildaufbau: Bodenfarbe am Original gemessen, Abweichung 1–2 Farbstufen
- Live-Deploy über GitHub Actions, auf der Produktionsseite nachgeprüft

Bekannte Abweichungen und was noch fehlt: `docs/vergleich.md`.
