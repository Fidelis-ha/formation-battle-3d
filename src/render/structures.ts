import * as THREE from 'three';
import { STRUCTURE_SPECS, type Structure } from '../sim/build';
import { heightAt } from '../sim/terrain';

/**
 * Zeichnet die gebauten Verteidigungsanlagen.
 *
 * Jede Anlage ist eine eigene Gruppe; sie wird nur neu gebaut, wenn sich die
 * Anzahl aendert. Beim Bauen entsteht ein kurzer Aufbau-Effekt (die Anlage
 * waechst aus dem Boden), damit der Bau im Bild sichtbar wird.
 */

export interface StructureView {
  group: THREE.Group;
  /** Nach jedem Bau aufrufen: gleicht die Anzeige mit der Simulation ab. */
  sync(structures: Structure[]): void;
  /** Bau-Effekt fortschreiben. */
  update(dt: number): void;
}

const COLORS = {
  player: 0x4a63c8,
  enemy: 0xb83a3a,
};

function woodMaterial(faction: 'player' | 'enemy'): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: faction === 'player' ? 0x8a6b45 : 0x7d5a3c,
    roughness: 0.9,
    flatShading: true,
  });
}

function stoneMaterial(faction: 'player' | 'enemy'): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: faction === 'player' ? 0x8b93a8 : 0x9a8b8b,
    roughness: 0.95,
    flatShading: true,
  });
}

/** Ein einzelnes Bauteil passend zur Anlagenart. */
function buildStructureMesh(structure: Structure): THREE.Group {
  const g = new THREE.Group();
  const spec = STRUCTURE_SPECS[structure.kind];

  if (structure.kind === 'palisade') {
    // Angespitzte Pfaehle nebeneinander.
    const count = 5;
    for (let i = 0; i < count; i++) {
      const h = spec.height * (0.85 + (i % 3) * 0.08);
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, h, 5), woodMaterial(structure.faction));
      post.position.set((i - (count - 1) / 2) * 0.62, h / 2, 0);
      post.castShadow = true;
      g.add(post);
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.35, 5), woodMaterial(structure.faction));
      tip.position.set(post.position.x, h + 0.16, 0);
      tip.castShadow = true;
      g.add(tip);
    }
  } else if (structure.kind === 'wall') {
    // Steinblock mit Zinnen.
    const block = new THREE.Mesh(
      new THREE.BoxGeometry(spec.width, spec.height, 1.1),
      stoneMaterial(structure.faction),
    );
    block.position.y = spec.height / 2;
    block.castShadow = true;
    block.receiveShadow = true;
    g.add(block);
    for (let i = -1; i <= 1; i++) {
      const merlon = new THREE.Mesh(
        new THREE.BoxGeometry(0.7, 0.55, 1.1),
        stoneMaterial(structure.faction),
      );
      merlon.position.set(i * (spec.width / 3), spec.height + 0.27, 0);
      merlon.castShadow = true;
      g.add(merlon);
    }
  } else if (structure.kind === 'breakwater') {
    // Steinhaufen im Fluss.
    for (let i = 0; i < 6; i++) {
      const r = 0.5 + (i % 3) * 0.18;
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(r, 0), stoneMaterial(structure.faction));
      rock.position.set((i - 2.5) * 0.85, spec.height * 0.35, ((i % 2) - 0.5) * 0.5);
      rock.rotation.set(i, i * 0.7, i * 0.3);
      rock.castShadow = true;
      g.add(rock);
    }
  } else {
    // Wachturm: Sockel, vier Pfosten, Plattform, Dach.
    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(1.0, 1.2, 0.5, 6),
      stoneMaterial(structure.faction),
    );
    base.position.y = 0.25;
    base.castShadow = true;
    g.add(base);
    for (const [px, pz] of [
      [-0.6, -0.6],
      [0.6, -0.6],
      [-0.6, 0.6],
      [0.6, 0.6],
    ]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.13, spec.height - 0.8, 5), woodMaterial(structure.faction));
      leg.position.set(px, (spec.height - 0.8) / 2 + 0.4, pz);
      leg.castShadow = true;
      g.add(leg);
    }
    const deck = new THREE.Mesh(
      new THREE.BoxGeometry(1.9, 0.16, 1.9),
      woodMaterial(structure.faction),
    );
    deck.position.y = spec.height - 0.35;
    deck.castShadow = true;
    g.add(deck);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(1.5, 0.9, 4), stoneMaterial(structure.faction));
    roof.position.y = spec.height + 0.1;
    roof.rotation.y = Math.PI / 4;
    roof.castShadow = true;
    g.add(roof);
    // Faehnchen in der Fraktionsfarbe.
    const flag = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.32, 0.04),
      new THREE.MeshStandardMaterial({ color: COLORS[structure.faction], roughness: 0.7 }),
    );
    flag.position.set(0.28, spec.height + 0.62, 0);
    g.add(flag);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.1, 4), woodMaterial(structure.faction));
    pole.position.y = spec.height + 0.45;
    g.add(pole);
  }

  return g;
}

export function createStructureView(scene: THREE.Scene): StructureView {
  const group = new THREE.Group();
  scene.add(group);

  /** Angezeigte Anlagen mit ihrem Aufbau-Fortschritt. */
  const shown = new Map<number, { node: THREE.Group; growth: number; target: number }>();

  const sync = (structures: Structure[]): void => {
    const seen = new Set<number>();
    for (const s of structures) {
      seen.add(s.id);
      if (shown.has(s.id)) continue;
      const node = buildStructureMesh(s);
      const y = heightAt(s.x, s.z);
      node.position.set(s.x, y, s.z);
      // Blickrichtung: Verteidigungslinien stehen quer zum Feld.
      node.rotation.y = 0;
      // Beim Aufbau klein starten und hochwachsen.
      node.scale.set(1, 0.01, 1);
      group.add(node);
      shown.set(s.id, { node, growth: 0, target: 1 });
    }
    for (const [id, entry] of shown) {
      if (seen.has(id)) continue;
      group.remove(entry.node);
      shown.delete(id);
    }
  };

  return {
    group,
    sync,
    update(dt: number) {
      for (const entry of shown.values()) {
        if (entry.growth >= entry.target) continue;
        entry.growth = Math.min(entry.target, entry.growth + dt * 3.2);
        // Etwas Ueberschwingen, damit der Aufbau lebendig wirkt.
        const t = entry.growth;
        const eased = 1 - Math.pow(1 - t, 3) + Math.sin(t * Math.PI) * 0.06;
        entry.node.scale.set(1, Math.max(0.01, eased), 1);
      }
    },
  };
}
