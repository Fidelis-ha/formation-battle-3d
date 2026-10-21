import * as THREE from 'three';
import {
  FIELD_HALF,
  RIVER,
  WATER_LEVEL,
  forestDensityAt,
  grassTufts,
  groundKindAt,
  heightAt,
  isBank,
  isWater,
  riverCenterAt,
  rockSpots,
  slopeAt,
  treeSpots,
} from '../sim/terrain';

/**
 * Baut die Landschaft ins Bild.
 *
 * Alle Hoehen kommen aus `src/sim/terrain.ts` — derselben Quelle, aus der die
 * Simulation rechnet. Dadurch steht kein Soldat je neben dem Boden.
 *
 * Aufbau:
 *  - Boden: ein Gitter aus Dreiecken mit Farben je Flaeche (Wiese, Huegel,
 *    Fels, Waldboden, Ufer). Flach schattiert, damit die Low-Poly-Kanten
 *    sichtbar bleiben.
 *  - Wasser: eine Flaeche auf Wasserspiegelhoehe, mit sanfter Wellenbewegung.
 *  - Baeume und Steine: je ein InstancedMesh pro Art (ein Zeichenaufruf).
 *  - Gras: Bueschel als InstancedMesh, im Wind bewegt.
 */

/** Farben der Bodenflaechen. Am Referenzbild ausgerichtet. */
const GROUND_COLORS = {
  grass: new THREE.Color(0x7d9160),
  grassDark: new THREE.Color(0x6a8051),
  hill: new THREE.Color(0x88976a),
  rock: new THREE.Color(0x8b8d86),
  forest: new THREE.Color(0x5d7048),
  bank: new THREE.Color(0x9a9a72),
};

export interface LandscapeHandle {
  group: THREE.Group;
  /** Wird pro Bild aufgerufen; bewegt Gras und Wasser. */
  update(timeSeconds: number): void;
  /** Hoehe des Bodens an einer Stelle (an die Simulation durchgereicht). */
  heightAt(x: number, z: number): number;
}

/** Bodenhoehe fuer das Bild, leicht geglaettet gezeichnet. */
const SEGMENTS = 180;

function buildTerrainMesh(): THREE.Mesh {
  const size = FIELD_HALF * 2;
  const geometry = new THREE.PlaneGeometry(size, size, SEGMENTS, SEGMENTS);
  geometry.rotateX(-Math.PI / 2);

  const pos = geometry.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  const color = new THREE.Color();

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const h = heightAt(x, z);
    pos.setY(i, h);

    // Farbe nach Flaeche. Die Hoehe moduliert die Helligkeit, damit Haenge
    // und Kuppen plastisch wirken.
    const kind = groundKindAt(x, z);
    switch (kind) {
      case 'water':
        // Flussbett: dunkler Kies, das Wasser liegt spaeter darueber.
        color.copy(GROUND_COLORS.bank).multiplyScalar(0.55);
        break;
      case 'bank':
        color.copy(GROUND_COLORS.bank);
        break;
      case 'forest':
        color.copy(GROUND_COLORS.forest);
        break;
      case 'rock':
        color.copy(GROUND_COLORS.rock);
        break;
      case 'hill':
        color.copy(GROUND_COLORS.hill);
        break;
      default:
        color.copy(GROUND_COLORS.grass);
    }

    // Waldboden dunkler, je dichter der Bestand.
    if (kind === 'forest') {
      const density = forestDensityAt(x, z);
      color.lerp(new THREE.Color(0x46552f), Math.min(0.5, (density - 0.52) * 0.9));
    }

    // Wiesen unregelmaessig aufhellen/dunkeln: zwei grosse Flecken statt
    // einer einzigen Flaeche.
    if (kind === 'grass') {
      const patch = Math.sin(x * 0.09 + 1.7) * Math.cos(z * 0.11 - 0.4);
      if (patch > 0.25) color.copy(GROUND_COLORS.grassDark);
    }

    // Steile Haenge aufhellen (Sonnenlicht von der Seite), Kuppen heller.
    const noise = Math.sin(x * 1.31) * Math.cos(z * 1.17) * 0.018;
    color.offsetHSL(0, 0, h * 0.004 + noise + (slopeAt(x, z) > 0.5 ? 0.02 : 0));

    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }

  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.computeVertexNormals();

  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.96,
    metalness: 0,
    flatShading: true,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  return mesh;
}

/** Wasserflaeche: folgt dem Flussverlauf als breites Band. */
function buildWaterMesh(): THREE.Group {
  const group = new THREE.Group();
  const segmentsAlong = 220;

  // Das Wasser wird als Band entlang der Flussmitte gebaut, nicht als
  // Rechteck — sonst schwimmt es ueber die Ufer hinaus.
  const verts: number[] = [];
  const indices: number[] = [];
  const half = RIVER.halfWidth + 1.2;

  for (let i = 0; i <= segmentsAlong; i++) {
    const x = -FIELD_HALF + (i / segmentsAlong) * FIELD_HALF * 2;
    const cz = riverCenterAt(x);
    verts.push(x, WATER_LEVEL + 0.12, cz - half);
    verts.push(x, WATER_LEVEL + 0.12, cz + half);
  }
  for (let i = 0; i < segmentsAlong; i++) {
    const a = i * 2;
    indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  const material = new THREE.MeshStandardMaterial({
    color: 0x5f8794,
    roughness: 0.18,
    metalness: 0.35,
    transparent: true,
    opacity: 0.86,
  });

  const water = new THREE.Mesh(geometry, material);
  water.receiveShadow = false;
  group.add(water);

  // Schaumkante an beiden Ufern: ein heller Streifen, der die Kante betont.
  const foamMat = new THREE.MeshBasicMaterial({
    color: 0xb8cdd4,
    transparent: true,
    opacity: 0.35,
    side: THREE.DoubleSide,
  });
  for (const side of [-1, 1]) {
    const fVerts: number[] = [];
    const fIndices: number[] = [];
    for (let i = 0; i <= segmentsAlong; i++) {
      const x = -FIELD_HALF + (i / segmentsAlong) * FIELD_HALF * 2;
      const cz = riverCenterAt(x) + side * half;
      fVerts.push(x, WATER_LEVEL + 0.14, cz);
      fVerts.push(x, WATER_LEVEL + 0.14, cz + side * 0.9);
    }
    for (let i = 0; i < segmentsAlong; i++) {
      const a = i * 2;
      fIndices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    const fGeo = new THREE.BufferGeometry();
    fGeo.setAttribute('position', new THREE.Float32BufferAttribute(fVerts, 3));
    fGeo.setIndex(fIndices);
    fGeo.computeVertexNormals();
    group.add(new THREE.Mesh(fGeo, foamMat));
  }

  return group;
}

/** Laubbaum: Stamm plus zwei Kronen-Kegel. */
function buildBroadleaf(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];

  const trunk = new THREE.CylinderGeometry(0.16, 0.24, 2.2, 5);
  trunk.translate(0, 1.1, 0);
  parts.push(trunk);

  const lower = new THREE.IcosahedronGeometry(1.75, 0);
  lower.scale(1, 0.85, 1);
  lower.translate(0, 3.0, 0);
  parts.push(lower);

  const upper = new THREE.IcosahedronGeometry(1.2, 0);
  upper.scale(1, 0.9, 1);
  upper.translate(0.35, 4.3, -0.2);
  parts.push(upper);

  return mergeSimple(parts);
}

/** Nadelbaum: Stamm plus drei Kegel. */
function buildConifer(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];

  const trunk = new THREE.CylinderGeometry(0.13, 0.2, 2.0, 5);
  trunk.translate(0, 1.0, 0);
  parts.push(trunk);

  const cones: [number, number, number][] = [
    [1.5, 2.2, 2.6],
    [1.15, 2.0, 4.0],
    [0.75, 1.7, 5.2],
  ];
  for (const [r, h, y] of cones) {
    const cone = new THREE.ConeGeometry(r, h, 6);
    cone.translate(0, y, 0);
    parts.push(cone);
  }
  return mergeSimple(parts);
}

/** Busch: niedriger Klumpen. */
function buildBush(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (const [x, z, r, y] of [
    [0, 0, 0.9, 0.7],
    [0.7, 0.3, 0.65, 0.55],
    [-0.5, -0.4, 0.6, 0.5],
  ]) {
    const g = new THREE.IcosahedronGeometry(r, 0);
    g.scale(1, 0.75, 1);
    g.translate(x, y, z);
    parts.push(g);
  }
  return mergeSimple(parts);
}

/**
 * Fasst einfache Geometrien zu einer zusammen. Bewusst selbst geschrieben:
 * die Teile haben nur Position und Normale, das reicht fuer Bäume und
 * vermeidet eine zusaetzliche Abhaengigkeit.
 */
function mergeSimple(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  let offset = 0;

  for (const part of parts) {
    const nonIndexed = part.index ? part.toNonIndexed() : part;
    const p = nonIndexed.attributes.position as THREE.BufferAttribute;
    const n = nonIndexed.attributes.normal as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      positions.push(p.getX(i), p.getY(i), p.getZ(i));
      normals.push(n.getX(i), n.getY(i), n.getZ(i));
    }
    offset += p.count;
  }

  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  merged.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  merged.computeVertexNormals();
  void indices;
  void offset;
  return merged;
}

/** Wind im Vertex-Shader: bewegt die Gras- und Baumspitzen. */
function applyWind(material: THREE.Material, strength: number): void {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = { value: 0 };
    shader.uniforms.uWindStrength = { value: strength };
    material.userData.shader = shader;

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uTime;
        uniform float uWindStrength;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        {
          vec3 wPos = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
          float sway = sin(uTime * 1.4 + wPos.x * 0.22 + wPos.z * 0.18);
          float lift = max(0.0, transformed.y);
          transformed.x += sway * lift * uWindStrength;
          transformed.z += cos(uTime * 1.1 + wPos.z * 0.19) * lift * uWindStrength * 0.6;
        }`,
      );
  };
  material.needsUpdate = true;
}

export function buildLandscape(): LandscapeHandle {
  const group = new THREE.Group();
  const updaters: ((t: number) => void)[] = [];

  // Boden
  const terrain = buildTerrainMesh();
  group.add(terrain);

  // Wasser
  const water = buildWaterMesh();
  group.add(water);
  const waterMat = (water.children[0] as THREE.Mesh).material as THREE.MeshStandardMaterial;
  updaters.push((t) => {
    // Langsame, kaum sichtbare Bewegung: ein Versatz der Normalen sugeriert
    // Fliessen, ohne dass die Flaeche selbst verrutscht.
    waterMat.roughness = 0.16 + Math.sin(t * 0.7) * 0.04;
  });

  // Baeume
  const trees = treeSpots();
  const byKind: THREE.BufferGeometry[] = [buildBroadleaf(), buildConifer(), buildBush()];
  const treeColors = [0x5f7f3e, 0x3f5c34, 0x6c8a46];
  const treeMaterials = treeColors.map(
    (c) =>
      new THREE.MeshStandardMaterial({
        color: c,
        roughness: 0.92,
        flatShading: true,
      }),
  );
  treeMaterials.forEach((m) => applyWind(m, 0.012));

  for (let kind = 0; kind < 3; kind++) {
    const spots = trees.filter((t) => t.kind === kind);
    if (spots.length === 0) continue;
    const mesh = new THREE.InstancedMesh(byKind[kind], treeMaterials[kind], spots.length);
    mesh.castShadow = true;
    mesh.receiveShadow = false;
    mesh.frustumCulled = false;
    const dummy = new THREE.Object3D();
    spots.forEach((spot, i) => {
      dummy.position.set(spot.x, spot.y - 0.15, spot.z);
      dummy.rotation.set(0, spot.rotation, 0);
      dummy.scale.setScalar(spot.scale);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    group.add(mesh);
  }

  // Steine
  const rocks = rockSpots();
  if (rocks.length > 0) {
    const rockGeo = new THREE.DodecahedronGeometry(0.7, 0);
    const rockMat = new THREE.MeshStandardMaterial({
      color: 0x8e9089,
      roughness: 0.95,
      flatShading: true,
    });
    const rockMesh = new THREE.InstancedMesh(rockGeo, rockMat, rocks.length);
    rockMesh.castShadow = true;
    rockMesh.receiveShadow = true;
    rockMesh.frustumCulled = false;
    const dummy = new THREE.Object3D();
    rocks.forEach((r, i) => {
      dummy.position.set(r.x, r.y - 0.2, r.z);
      dummy.rotation.set(r.rotation * 0.3, r.rotation, r.rotation * 0.2);
      dummy.scale.set(r.scale, r.scale * 0.7, r.scale);
      dummy.updateMatrix();
      rockMesh.setMatrixAt(i, dummy.matrix);
    });
    rockMesh.instanceMatrix.needsUpdate = true;
    group.add(rockMesh);
  }

  // Gras
  const tufts = grassTufts();
  {
    const bladeGeo = new THREE.ConeGeometry(0.1, 0.62, 3);
    bladeGeo.translate(0, 0.28, 0);
    const grassMat = new THREE.MeshStandardMaterial({
      color: 0x7f9a55,
      roughness: 1,
      flatShading: true,
    });
    applyWind(grassMat, 0.09);
    const mesh = new THREE.InstancedMesh(bladeGeo, grassMat, tufts.length * 2);
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.frustumCulled = false;
    const dummy = new THREE.Object3D();
    tufts.forEach((g, i) => {
      for (let b = 0; b < 2; b++) {
        const a = g.rotation + b * 1.9;
        dummy.position.set(g.x + Math.cos(a) * 0.16, g.y, g.z + Math.sin(a) * 0.16);
        dummy.rotation.set(0, a, (b === 0 ? 1 : -1) * 0.14);
        dummy.scale.setScalar(g.scale);
        dummy.updateMatrix();
        mesh.setMatrixAt(i * 2 + b, dummy.matrix);
      }
    });
    mesh.instanceMatrix.needsUpdate = true;
    group.add(mesh);
  }

  // Wind-Zeit weiterreichen.
  updaters.push((t) => {
    for (const m of [...treeMaterials, ...group.children.map(() => null)]) {
      void m;
    }
    const shaders = [
      ...treeMaterials.map((m) => m.userData.shader as { uniforms: Record<string, { value: number }> } | undefined),
    ];
    for (const s of shaders) {
      if (s) s.uniforms.uTime.value = t;
    }
  });

  return {
    group,
    update(t: number) {
      for (const fn of updaters) fn(t);
      // Gras-Schattierung mitschwingen lassen.
      group.traverse((obj) => {
        const mat = (obj as THREE.Mesh).material as THREE.Material | undefined;
        const shader = mat?.userData?.shader as { uniforms: Record<string, { value: number }> } | undefined;
        if (shader) shader.uniforms.uTime.value = t;
      });
    },
    heightAt,
  };
}

/** Hilfsmittel fuer Tests und Debug: Bodenhoehe an einer Stelle. */
export { heightAt, isWater, isBank, WATER_LEVEL };
