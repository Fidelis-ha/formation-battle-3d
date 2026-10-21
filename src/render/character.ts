import * as THREE from 'three';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { Assets, WeaponAsset } from './assets';

export type SoldierVisual = {
  root: THREE.Group;
  mixer: THREE.AnimationMixer;
  actions: Record<string, THREE.AnimationAction>;
  kind: string;
  faction: 'player' | 'enemy';
};

type Faction = 'player' | 'enemy';

const MODEL_BY_KIND: Record<string, string> = {
  archer: 'rogue_hooded',
  spearman: 'knight',
  infantry: 'rogue',
  housecarl: 'barbarian',
  cavalry: 'knight',
};

const MAIN_WEAPON_BY_KIND: Record<string, string | null> = {
  archer: 'bow',
  spearman: 'spear',
  infantry: 'sword',
  housecarl: 'axe',
  cavalry: 'spear',
};

const OFFHAND_BY_KIND: Record<string, string | null> = {
  archer: null,
  spearman: 'shield_round',
  infantry: 'shield_round',
  housecarl: null,
  cavalry: null,
};

interface LayerState {
  rider: string | null;
  horse: string | null;
}

const layerStates = new WeakMap<SoldierVisual, LayerState>();

function layerState(v: SoldierVisual): LayerState {
  let state = layerStates.get(v);
  if (!state) {
    state = { rider: null, horse: null };
    layerStates.set(v, state);
  }
  return state;
}

function findNode(root: THREE.Object3D, wanted: string): THREE.Object3D | null {
  const target = wanted.toLowerCase().replace(/[^a-z0-9]/g, '');
  let found: THREE.Object3D | null = null;
  root.traverse((obj) => {
    if (found === null && obj.name.toLowerCase().replace(/[^a-z0-9]/g, '') === target) {
      found = obj;
    }
  });
  return found;
}

const tintCache = new Map<string, THREE.Texture>();

/**
 * Färbt die Charaktertextur auf die Fraktionsfarbe um, statt das Material zu
 * multiplizieren. Ein Multiplikations-Tint macht die Figuren nur dunkel und
 * matschig; der Farbauftrag per Canvas behält die Schattierung der Textur und
 * liefert trotzdem klar erkennbare blaue bzw. rote Armeen.
 */
function factionTexture(source: THREE.Texture, faction: Faction, cacheKey: string): THREE.Texture | null {
  const key = `${cacheKey}:${faction}`;
  const cached = tintCache.get(key);
  if (cached) return cached;

  const image = source.image as HTMLImageElement | ImageBitmap | undefined;
  if (!image) return null;
  const width = 'width' in image ? image.width : 0;
  const height = 'height' in image ? image.height : 0;
  if (!width || !height) return null;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.drawImage(image as CanvasImageSource, 0, 0, width, height);
  ctx.globalCompositeOperation = 'color';
  ctx.globalAlpha = 0.82;
  ctx.fillStyle = faction === 'player' ? '#4f6bff' : '#ff4433';
  ctx.fillRect(0, 0, width, height);
  ctx.globalCompositeOperation = 'multiply';
  ctx.globalAlpha = 0.28;
  ctx.fillStyle = faction === 'player' ? '#7f8cff' : '#ff8a7a';
  ctx.fillRect(0, 0, width, height);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = source.colorSpace;
  texture.flipY = source.flipY;
  texture.wrapS = source.wrapS;
  texture.wrapT = source.wrapT;
  texture.magFilter = source.magFilter;
  texture.minFilter = source.minFilter;
  texture.needsUpdate = true;
  tintCache.set(key, texture);
  return texture;
}

function tintMaterial(material: THREE.Material, faction: Faction, modelKey: string): THREE.Material {
  const cloned = material.clone();
  if ('color' in cloned && cloned.color instanceof THREE.Color) {
    cloned.color.setHex(0xffffff);
  }
  if ('map' in cloned) {
    const map = (cloned as THREE.MeshStandardMaterial).map;
    if (map) {
      const tinted = factionTexture(map, faction, `${modelKey}:${map.uuid}`);
      if (tinted) (cloned as THREE.MeshStandardMaterial).map = tinted;
    }
  }
  return cloned;
}

function tintObject(root: THREE.Object3D, faction: Faction, modelKey: string): void {
  root.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    obj.material = Array.isArray(obj.material)
      ? obj.material.map((material) => tintMaterial(material, faction, modelKey))
      : tintMaterial(obj.material, faction, modelKey);
    obj.userData.ownedMaterial = true;
    obj.castShadow = true;
    obj.receiveShadow = true;
    obj.frustumCulled = false;
  });
}

function attachWeapon(
  slot: THREE.Object3D,
  asset: WeaponAsset | undefined,
  type: 'main' | 'shield',
  weaponKey: string,
): void {
  if (!asset) return;
  const mount = new THREE.Group();
  if (type === 'main') {
    mount.position.set(0, 0.033, 0);
    if (weaponKey === 'bow') {
      // Bogen aufrecht halten statt nach vorn zeigen zu lassen.
      mount.quaternion.set(0, 0, Math.SQRT1_2, Math.SQRT1_2);
    } else {
      // Entspricht der Ausrichtung der eingebauten Waffen in den KayKit-Modellen.
      mount.quaternion.set(0, -1, 0, 0);
    }
  } else {
    mount.position.set(0, 0.017, 0.156);
  }
  mount.add(asset.scene.clone(true));
  slot.add(mount);
}

export function createSoldierVisual(
  assets: Assets,
  kind: string,
  faction: Faction,
): SoldierVisual {
  const modelKey = MODEL_BY_KIND[kind] ?? kind;
  const asset = assets.characters[modelKey];
  if (!asset) throw new Error(`[character] Unbekanntes Modell fuer "${kind}".`);

  const root = new THREE.Group();
  const character = cloneSkeleton(asset.scene) as THREE.Group;
  tintObject(character, faction, modelKey);
  root.add(character);

  const mounted = kind === 'cavalry';
  let horseRoot: THREE.Group | null = null;
  if (mounted) {
    horseRoot = cloneSkeleton(assets.horse.scene) as THREE.Group;
    tintObject(horseRoot, faction, 'horse');
    root.add(horseRoot);
    // Reiter sitzt auf dem Pferderuecken.
    character.position.set(0, 0.9, -0.05);
  }

  const mixer = new THREE.AnimationMixer(root);
  const actions: Record<string, THREE.AnimationAction> = {};
  for (const clip of asset.clips) {
    actions[clip.name] = mixer.clipAction(clip, character);
  }

  if (mounted && horseRoot) {
    for (const clip of assets.horse.clips) {
      const shortName = clip.name.replace(/^.*\|/, '');
      actions[`Horse_${shortName}`] = mixer.clipAction(clip, horseRoot);
    }
  }

  const slotR = findNode(character, 'handslotr') ?? findNode(character, 'handr');
  const slotL = findNode(character, 'handslotl') ?? findNode(character, 'handl');
  const mainKey = MAIN_WEAPON_BY_KIND[kind];
  const offhandKey = OFFHAND_BY_KIND[kind];

  if (slotR && mainKey) attachWeapon(slotR, assets.weapons[mainKey], 'main', mainKey);
  if (slotL && offhandKey) attachWeapon(slotL, assets.weapons[offhandKey], 'shield', offhandKey);

  return { root, mixer, actions, kind, faction };
}

export function playAction(v: SoldierVisual, name: string, fade: number = 0.2): void {
  const action = v.actions[name];
  if (!action) return;

  const isHorse = name.startsWith('Horse_');
  const state = layerState(v);
  const layer = isHorse ? 'horse' : 'rider';
  if (state[layer] === name) return;

  const previousName = state[layer];
  if (previousName !== null) {
    const previous = v.actions[previousName];
    if (previous && previous !== action) previous.fadeOut(fade);
  }

  const oneShot = name === 'Death_A' || name === 'Horse_Death';
  if (oneShot) {
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
  } else {
    action.setLoop(THREE.LoopRepeat, Infinity);
    action.clampWhenFinished = false;
  }

  action.reset().setEffectiveTimeScale(1).setEffectiveWeight(1).fadeIn(fade).play();
  state[layer] = name;
}
