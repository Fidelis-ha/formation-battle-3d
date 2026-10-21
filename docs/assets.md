# Assets — Herkunft und Lizenz

Grundsatz: **Nichts aus dem Unity-Build des Originals extrahiert.** Alle Dateien stammen
aus frei lizenzierten Paketen. Das Original nutzt Synty POLYGON (kommerziell, ~350 USD);
ein späterer Wechsel auf lizenzierte Original-Assets ist ein Konfigurationsvorgang.

## Verwendete Pakete

| Paket | Autor | Lizenz | Quelle | Verwendung |
|---|---|---|---|---|
| Character Pack: Adventurers | Kay Lousberg (KayKit) | **CC0 1.0** | github.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0 | 5 Charaktere, 76 Animationen |
| LowPoly Animated Animals | Quaternius | **CC0 1.0** | quaternius.itch.io/lowpoly-animated-animals | Pferd für Cavalry |
| LowPoly Medieval Weapons | Quaternius | **CC0 1.0** | quaternius.itch.io/lowpoly-medieval-weapons | Speer, Bogen, Schild, Schwert, Axt |

Beide Anbieter stellen ihre Pakete unter CC0 (Public Domain) — Nutzung, Veränderung und
kommerzielle Verwendung ohne Namensnennung erlaubt. Namensnennung erfolgt hier trotzdem,
weil sie das Anständige ist.

## Dateien im Repo

```
public/assets/models/    Knight.glb  Rogue.glb  Rogue_Hooded.glb  Barbarian.glb  Mage.glb  Horse.fbx
public/assets/weapons/   Spear.fbx  Bow_Wooden.fbx  Shield_Round.fbx  Sword.fbx  Axe_Double.fbx
public/assets/textures/  *_texture.png
```

## Rollen-Zuordnung

| Spielrolle | Modell | Waffe | Animationen |
|---|---|---|---|
| Archer | Rogue_Hooded | Bow_Wooden | 1H_Ranged_Shoot, Walking_A, Running_A, Death_A |
| Spearman | Knight | Spear + Shield_Round | 1H_Melee_Attack_Stab, Walking_A, Running_A, Death_A |
| Infantry | Rogue | Sword + Shield_Round | 1H_Melee_Attack_Slice_Horizontal, Death_A |
| Housecarl | Barbarian | Axe_Double | 2H_Melee_Attack_Chop, Death_A |
| Cavalry | Knight | Spear | reitet auf Horse.fbx, 1H_Melee_Attack_Stab |

## Technische Hinweise

- KayKit-Charaktere: 12–15 Meshes, **ein** Material und **eine** Textur pro Figur →
  lassen sich zu einem SkinnedMesh zusammenführen (1 Draw Call pro Soldat).
- Waffen-Attach: Ankerknoten `handslot.r` und `handslot.l` im Skelett.
- Animationen sind im GLB eingebettet (76 Clips, identische Namen bei allen Charakteren).
- Pferd: binäres FBX mit 8 AnimStack-Einträgen, Laden über `FBXLoader`.
- Waffen: FBX, statisch, Laden über `FBXLoader` und einmaliges Caching.
