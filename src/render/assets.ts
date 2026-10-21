import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export interface CharacterAsset {
  scene: THREE.Group;
  clips: THREE.AnimationClip[];
  handslotR: THREE.Object3D;
  handslotL: THREE.Object3D | null;
}

export interface WeaponAsset {
  scene: THREE.Group;
}

export interface Assets {
  characters: Record<string, CharacterAsset>;
  horse: { scene: THREE.Group; clips: THREE.AnimationClip[] };
  weapons: Record<string, WeaponAsset>;
}

interface FbxAsset extends THREE.Group {
  animations: THREE.AnimationClip[];
}

// Relative Pfade: auf GitHub Pages liegt die App unter /formation-battle-3d/,
// absolute Pfade wie /assets/... würden dort ins Leere laufen.
const BASE = import.meta.env.BASE_URL;
const MODEL_BASE = `${BASE}assets/models`;
const WEAPON_BASE = `${BASE}assets/weapons`;

const CHARACTERS: ReadonlyArray<{ key: string; file: string }> = [
  { key: 'knight', file: 'Knight' },
  { key: 'rogue', file: 'Rogue' },
  { key: 'rogue_hooded', file: 'Rogue_Hooded' },
  { key: 'barbarian', file: 'Barbarian' },
  { key: 'mage', file: 'Mage' },
];

const WEAPONS: ReadonlyArray<{ key: string; file: string; size: number }> = [
  { key: 'spear', file: 'Spear', size: 2.2 },
  { key: 'bow', file: 'Bow_Wooden', size: 1.2 },
  { key: 'shield_round', file: 'Shield_Round', size: 0.7 },
  { key: 'sword', file: 'Sword', size: 0.9 },
  { key: 'axe', file: 'Axe_Double', size: 1.3 },
];

const TOTAL_LOADS = CHARACTERS.length + 1 + WEAPONS.length;

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function findNode(root: THREE.Object3D, wanted: string): THREE.Object3D | null {
  const target = normalizeName(wanted);
  let found: THREE.Object3D | null = null;
  root.traverse((obj) => {
    if (found === null && normalizeName(obj.name) === target) found = obj;
  });
  return found;
}

function hasHandslotAncestor(obj: THREE.Object3D): boolean {
  let parent = obj.parent;
  while (parent !== null) {
    if (normalizeName(parent.name).includes('handslot')) return true;
    parent = parent.parent;
  }
  return false;
}

function materialColor(material: THREE.Material): THREE.Color {
  if ('color' in material && material.color instanceof THREE.Color) return material.color;
  return new THREE.Color(0.6, 0.6, 0.6);
}

// Backt die Materialfarben in Vertexfarben, damit ein Draw Call genuegt.
function bakeVertexColors(mesh: THREE.Mesh): void {
  const geometry = mesh.geometry;
  const position = geometry.getAttribute('position');
  if (!position) return;

  const count = position.count;
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  const base = materialColor(materials[0]);
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    colors[i * 3] = base.r;
    colors[i * 3 + 1] = base.g;
    colors[i * 3 + 2] = base.b;
  }

  const index = geometry.index;
  for (const group of geometry.groups) {
    const material = materials[group.materialIndex ?? 0] ?? materials[0];
    if (!material) continue;
    const color = materialColor(material);
    const end = Math.min(group.start + group.count, index ? index.count : count);
    for (let i = group.start; i < end; i++) {
      const vertex = index ? index.getX(i) : i;
      if (vertex >= count) continue;
      colors[vertex * 3] = color.r;
      colors[vertex * 3 + 1] = color.g;
      colors[vertex * 3 + 2] = color.b;
    }
  }

  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
}

// Statische FBX-Modelle (Waffen, Pferd) auf ein Material reduzieren.
function prepareStaticModel(root: THREE.Object3D): void {
  root.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    bakeVertexColors(obj);
    obj.material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.85,
      metalness: 0.08,
    });
    obj.castShadow = true;
    obj.receiveShadow = true;
  });
}

function scaleToSize(root: THREE.Object3D, target: number, axis: 'max' | 'y'): void {
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const current = axis === 'y' ? size.y : Math.max(size.x, size.y, size.z);
  if (current <= 1e-6) return;
  root.scale.multiplyScalar(target / current);
}

function fixMaterialColorSpace(root: THREE.Object3D): void {
  root.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const material of materials) {
      if ('map' in material && material.map instanceof THREE.Texture) {
        material.map.colorSpace = THREE.SRGBColorSpace;
      }
    }
    obj.castShadow = true;
    obj.receiveShadow = true;
  });
}

// Fuehrt Koerper, Helm und Umhang zu einem SkinnedMesh zusammen.
function mergeCharacterMeshes(root: THREE.Group): void {
  root.updateMatrixWorld(true);

  let reference: THREE.SkinnedMesh | null = null;
  root.traverse((obj) => {
    if (reference === null && obj instanceof THREE.SkinnedMesh) reference = obj;
  });
  if (reference === null) {
    console.warn('[assets] Kein SkinnedMesh gefunden, nutze Originalmeshes.');
    return;
  }

  const skinned: THREE.SkinnedMesh = reference;
  const skeleton = skinned.skeleton;
  const bindMatrix = skinned.bindMatrix.clone();
  const parent = skinned.parent;
  if (parent === null) {
    console.warn('[assets] SkinnedMesh ohne Parent, nutze Originalmeshes.');
    return;
  }

  // Eingebettete Waffen entfernen; eigene Waffen werden an die Handslots gehaengt.
  const embeddedWeapons: THREE.Object3D[] = [];
  root.traverse((obj) => {
    if (obj instanceof THREE.Mesh && hasHandslotAncestor(obj)) embeddedWeapons.push(obj);
  });
  for (const weapon of embeddedWeapons) weapon.removeFromParent();

  root.updateMatrixWorld(true);
  const rootInverse = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const geometries: THREE.BufferGeometry[] = [];
  const originals: THREE.Mesh[] = [];

  try {
    root.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh)) return;
      let geometry = obj.geometry.clone();
      if (geometry.index) geometry = geometry.toNonIndexed();
      for (const name of Object.keys(geometry.attributes)) {
        if (!['position', 'normal', 'uv', 'skinIndex', 'skinWeight'].includes(name)) {
          geometry.deleteAttribute(name);
        }
      }
      if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
      if (!geometry.getAttribute('uv')) {
        const count = geometry.getAttribute('position').count;
        geometry.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(count * 2), 2));
      }
      geometry.clearGroups();

      if (!(obj instanceof THREE.SkinnedMesh)) {
        // Statische Anhaengsel in den Bind-Space transformieren und an den Knochen binden.
        const relative = new THREE.Matrix4().multiplyMatrices(rootInverse, obj.matrixWorld);
        geometry.applyMatrix4(relative);

        let bone: THREE.Bone | null = null;
        let ancestor = obj.parent;
        while (ancestor !== null) {
          if (ancestor instanceof THREE.Bone) {
            bone = ancestor;
            break;
          }
          ancestor = ancestor.parent;
        }
        const boneIndex = Math.max(0, bone ? skeleton.bones.indexOf(bone) : 0);
        const count = geometry.getAttribute('position').count;
        const skinIndex = new Uint8Array(count * 4);
        const skinWeight = new Float32Array(count * 4);
        for (let i = 0; i < count; i++) {
          skinIndex[i * 4] = boneIndex;
          skinWeight[i * 4] = 1;
        }
        geometry.setAttribute('skinIndex', new THREE.BufferAttribute(skinIndex, 4));
        geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeight, 4));
      }

      geometries.push(geometry);
      originals.push(obj);
    });

    const merged = mergeGeometries(geometries, false);
    if (!merged) {
      console.warn('[assets] mergeGeometries fehlgeschlagen, nutze Originalmeshes.');
      for (const geometry of geometries) geometry.dispose();
      return;
    }

    const material = Array.isArray(skinned.material) ? skinned.material[0] : skinned.material;
    if (!material) {
      console.warn('[assets] Kein Material gefunden, nutze Originalmeshes.');
      for (const geometry of geometries) geometry.dispose();
      return;
    }

    for (const mesh of originals) mesh.removeFromParent();
    for (const geometry of geometries) geometry.dispose();

    const mergedMesh = new THREE.SkinnedMesh(merged, material);
    mergedMesh.name = `${root.name || 'Character'}_Merged`;
    mergedMesh.bind(skeleton, bindMatrix);
    mergedMesh.bindMode = 'attached';
    mergedMesh.frustumCulled = false;
    mergedMesh.castShadow = true;
    mergedMesh.receiveShadow = true;
    parent.add(mergedMesh);
  } catch (error) {
    console.warn('[assets] Zusammenfuehren fehlgeschlagen, nutze Originalmeshes.', error);
    for (const geometry of geometries) geometry.dispose();
  }
}

function buildCharacter(scene: THREE.Group, clips: THREE.AnimationClip[]): CharacterAsset {
  mergeCharacterMeshes(scene);
  fixMaterialColorSpace(scene);

  const handslotR = findNode(scene, 'handslotr') ?? findNode(scene, 'handr');
  if (!handslotR) throw new Error('[assets] handslot.r fehlt im Charaktermodell.');
  const handslotL = findNode(scene, 'handslotl') ?? findNode(scene, 'handl');

  return { scene, clips, handslotR, handslotL };
}

export async function loadAssets(onProgress?: (p: number) => void): Promise<Assets> {
  let loaded = 0;
  const tick = (): void => {
    loaded += 1;
    onProgress?.(Math.min(1, loaded / TOTAL_LOADS));
  };
  onProgress?.(0);

  const gltfLoader = new GLTFLoader();
  const fbxLoader = new FBXLoader();

  const characterEntries = await Promise.all(
    CHARACTERS.map(async (entry) => {
      const gltf = await gltfLoader.loadAsync(`${MODEL_BASE}/${entry.file}.glb`);
      tick();
      return [entry.key, buildCharacter(gltf.scene, gltf.animations)] as const;
    }),
  );

  const horseTask = (async () => {
    const horse = (await fbxLoader.loadAsync(`${MODEL_BASE}/Horse.fbx`)) as FbxAsset;
    tick();
    prepareStaticModel(horse);
    scaleToSize(horse, 2.2, 'y');
    return { scene: horse, clips: horse.animations };
  })();

  const weaponEntries = await Promise.all(
    WEAPONS.map(async (entry) => {
      const weapon = (await fbxLoader.loadAsync(`${WEAPON_BASE}/${entry.file}.fbx`)) as FbxAsset;
      tick();
      prepareStaticModel(weapon);
      scaleToSize(weapon, entry.size, 'max');
      return [entry.key, { scene: weapon }] as const;
    }),
  );

  const horse = await horseTask;

  const characters: Record<string, CharacterAsset> = {};
  for (const [key, asset] of characterEntries) characters[key] = asset;

  const weapons: Record<string, WeaponAsset> = {};
  for (const [key, asset] of weaponEntries) weapons[key] = asset;

  return { characters, horse, weapons };
}
