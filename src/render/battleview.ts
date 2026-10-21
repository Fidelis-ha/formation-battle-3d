import * as THREE from 'three';
import type { Battle, BattleEvent, Soldier } from '../sim/types';
import type { Assets } from './assets';
import { createSoldierVisual, playAction, type SoldierVisual } from './character';
import type { SceneHandle } from './scene';

export interface BattleView {
  update(dt: number, events: BattleEvent[]): void;
  syncBattle(): void;
  screenToWorld(px: number, py: number): { x: number; z: number };
  worldToScreen(x: number, z: number): { x: number; y: number };
  setSelected(platoonId: number | null): void;
  showMoveMarker(x: number, z: number): void;
  dispose(): void;
}

const ATTACK_CLIP: Record<string, string> = {
  archer: '1H_Ranged_Shoot',
  spearman: '1H_Melee_Attack_Stab',
  infantry: '1H_Melee_Attack_Slice_Horizontal',
  housecarl: '2H_Melee_Attack_Chop',
  cavalry: '1H_Melee_Attack_Stab',
};

const BLOOD_MAX = 200;
const ARROW_MAX = 48;
const BLOOD_LIFE = 0.6;
const ARROW_LIFE = 0.35;
const ARROW_HEIGHT = 2.5;
const CORPSE_LIFE = 60;
const UP = new THREE.Vector3(0, 1, 0);

interface BloodParticle {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
}

interface ArrowState {
  mesh: THREE.Mesh;
  active: boolean;
  t: number;
  duration: number;
  start: THREE.Vector3;
  end: THREE.Vector3;
}

function riderClip(kind: string, state: Soldier['state']): string {
  if (state === 'dead') return 'Death_A';
  if (state === 'attack') return ATTACK_CLIP[kind] ?? '1H_Melee_Attack_Slice_Horizontal';
  if (state === 'move') {
    if (kind === 'cavalry') return 'Idle';
    return kind === 'housecarl' ? 'Walking_A' : 'Running_A';
  }
  return 'Idle';
}

function horseClip(state: Soldier['state']): string {
  if (state === 'dead') return 'Horse_Death';
  if (state === 'attack' || state === 'move') return 'Horse_Run';
  return 'Horse_Idle';
}

export function createBattleView(
  scene: SceneHandle,
  assets: Assets,
  battle: Battle,
): BattleView {
  const visuals = new Map<number, SoldierVisual>();
  const lastState = new Map<number, string>();

  for (const platoon of battle.platoons) {
    for (const soldier of platoon.soldiers) {
      const visual = createSoldierVisual(assets, soldier.kind, soldier.faction);
      scene.scene.add(visual.root);
      visuals.set(soldier.id, visual);
    }
  }

  const selectionGeometry = new THREE.RingGeometry(2.0, 2.35, 48);
  selectionGeometry.rotateX(-Math.PI / 2);
  const selectionMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.75,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const selectionRing = new THREE.Mesh(selectionGeometry, selectionMaterial);
  selectionRing.position.y = 0.03;
  selectionRing.visible = false;
  selectionRing.renderOrder = 2;
  scene.scene.add(selectionRing);

  const markerGeometry = new THREE.RingGeometry(0.35, 0.55, 32);
  markerGeometry.rotateX(-Math.PI / 2);
  const markerMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 1,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const moveMarker = new THREE.Mesh(markerGeometry, markerMaterial);
  moveMarker.position.y = 0.04;
  moveMarker.visible = false;
  moveMarker.renderOrder = 2;
  scene.scene.add(moveMarker);

  const bloodGeometry = new THREE.SphereGeometry(0.06, 4, 3);
  const bloodMaterial = new THREE.MeshBasicMaterial({ color: 0xb01b1b });
  const bloodMesh = new THREE.InstancedMesh(bloodGeometry, bloodMaterial, BLOOD_MAX);
  bloodMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  bloodMesh.frustumCulled = false;
  bloodMesh.renderOrder = 1;
  scene.scene.add(bloodMesh);

  const blood: BloodParticle[] = [];
  for (let i = 0; i < BLOOD_MAX; i++) {
    blood.push({ x: 0, y: -100, z: 0, vx: 0, vy: 0, vz: 0, life: 0 });
  }
  let bloodCursor = 0;

  const dummy = new THREE.Object3D();
  const hideBlood = (index: number): void => {
    dummy.position.set(0, -100, 0);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.setScalar(0.0001);
    dummy.updateMatrix();
    bloodMesh.setMatrixAt(index, dummy.matrix);
  };
  for (let i = 0; i < BLOOD_MAX; i++) hideBlood(i);
  bloodMesh.instanceMatrix.needsUpdate = true;

  const arrowGeometry = new THREE.ConeGeometry(0.045, 0.65, 4);
  const arrowMaterial = new THREE.MeshStandardMaterial({ color: 0x4b3520, roughness: 0.9 });
  const arrows: ArrowState[] = [];
  for (let i = 0; i < ARROW_MAX; i++) {
    const mesh = new THREE.Mesh(arrowGeometry, arrowMaterial);
    mesh.visible = false;
    mesh.castShadow = false;
    scene.scene.add(mesh);
    arrows.push({
      mesh,
      active: false,
      t: 0,
      duration: ARROW_LIFE,
      start: new THREE.Vector3(),
      end: new THREE.Vector3(),
    });
  }
  let arrowCursor = 0;

  const tempDirection = new THREE.Vector3();
  const tempPosition = new THREE.Vector3();
  const tempNext = new THREE.Vector3();

  const positionArrow = (arrow: ArrowState, t: number): void => {
    const clamped = Math.min(1, Math.max(0, t));
    const next = Math.min(1, clamped + 0.02);
    const start = arrow.start;
    const end = arrow.end;
    arrow.mesh.position.set(
      start.x + (end.x - start.x) * clamped,
      start.y + (end.y - start.y) * clamped + Math.sin(Math.PI * clamped) * ARROW_HEIGHT,
      start.z + (end.z - start.z) * clamped,
    );
    tempNext.set(
      start.x + (end.x - start.x) * next,
      start.y + (end.y - start.y) * next + Math.sin(Math.PI * next) * ARROW_HEIGHT,
      start.z + (end.z - start.z) * next,
    );
    tempDirection.subVectors(tempNext, arrow.mesh.position);
    if (tempDirection.lengthSq() > 1e-8) {
      tempDirection.normalize();
      arrow.mesh.quaternion.setFromUnitVectors(UP, tempDirection);
    }
  };

  const spawnBlood = (x: number, z: number): void => {
    for (let i = 0; i < 3; i++) {
      const index = bloodCursor % BLOOD_MAX;
      bloodCursor += 1;
      const particle = blood[index];
      particle.x = x + (Math.random() - 0.5) * 0.35;
      particle.y = 0.7 + Math.random() * 0.7;
      particle.z = z + (Math.random() - 0.5) * 0.35;
      particle.vx = (Math.random() - 0.5) * 2.2;
      particle.vy = 1.2 + Math.random() * 2.2;
      particle.vz = (Math.random() - 0.5) * 2.2;
      particle.life = BLOOD_LIFE;
    }
  };

  const spawnArrow = (fromX: number, fromZ: number, toX: number, toZ: number): void => {
    let arrow = arrows.find((candidate) => !candidate.active);
    if (!arrow) {
      arrow = arrows[arrowCursor % ARROW_MAX];
      arrowCursor += 1;
    }
    arrow.active = true;
    arrow.t = 0;
    arrow.start.set(fromX, 1.1, fromZ);
    arrow.end.set(toX, 1.1, toZ);
    arrow.mesh.visible = true;
    positionArrow(arrow, 0);
  };

  let selectedId: number | null = null;
  let markerLife = 0;
  let pulseTime = 0;

  const syncBattle = (): void => {
    for (const platoon of battle.platoons) {
      for (const soldier of platoon.soldiers) {
        const visual = visuals.get(soldier.id);
        if (!visual) continue;

        visual.root.position.set(soldier.x, 0, soldier.z);
        visual.root.rotation.y = soldier.facing;

        const hidden = soldier.state === 'dead' && soldier.deadTime > CORPSE_LIFE;
        visual.root.visible = !hidden;
        if (hidden) continue;

        const key = `${soldier.kind}:${soldier.state}`;
        if (lastState.get(soldier.id) === key) continue;
        lastState.set(soldier.id, key);

        playAction(visual, riderClip(soldier.kind, soldier.state), 0.18);
        if (soldier.kind === 'cavalry') {
          playAction(visual, horseClip(soldier.state), 0.18);
        }
      }
    }
  };

  const updateBlood = (dt: number): void => {
    for (let i = 0; i < BLOOD_MAX; i++) {
      const particle = blood[i];
      if (particle.life <= 0) continue;
      particle.life -= dt;
      if (particle.life <= 0) {
        hideBlood(i);
        continue;
      }
      particle.vy -= 9.8 * dt;
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
      particle.z += particle.vz * dt;
      if (particle.y < 0.05) {
        particle.y = 0.05;
        particle.vy *= -0.25;
        particle.vx *= 0.7;
        particle.vz *= 0.7;
      }
      const scale = 0.35 + (particle.life / BLOOD_LIFE) * 0.9;
      dummy.position.set(particle.x, particle.y, particle.z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.setScalar(scale);
      dummy.updateMatrix();
      bloodMesh.setMatrixAt(i, dummy.matrix);
    }
    bloodMesh.instanceMatrix.needsUpdate = true;
  };

  const updateArrows = (dt: number): void => {
    for (const arrow of arrows) {
      if (!arrow.active) continue;
      arrow.t += dt / arrow.duration;
      if (arrow.t >= 1) {
        arrow.active = false;
        arrow.mesh.visible = false;
        continue;
      }
      positionArrow(arrow, arrow.t);
    }
  };

  const updateRings = (dt: number): void => {
    pulseTime += dt;

    const selected =
      selectedId === null ? null : battle.platoons.find((platoon) => platoon.id === selectedId);
    if (selected && selected.aliveCount > 0) {
      selectionRing.visible = true;
      selectionRing.position.set(selected.x, 0.03, selected.z);
      const pulse = 1 + Math.sin(pulseTime * 4) * 0.04;
      selectionRing.scale.setScalar(pulse);
      selectionMaterial.opacity = 0.6 + Math.sin(pulseTime * 4) * 0.15;
    } else {
      selectionRing.visible = false;
    }

    if (markerLife > 0) {
      markerLife = Math.max(0, markerLife - dt);
      moveMarker.visible = true;
      markerMaterial.opacity = markerLife;
      moveMarker.scale.setScalar(1 + (1 - markerLife) * 0.5);
    } else {
      moveMarker.visible = false;
    }
  };

  const canvas = scene.renderer.domElement;
  const canvasSize = (): { width: number; height: number } => {
    const rect = canvas.getBoundingClientRect();
    return {
      width: canvas.clientWidth || rect.width || canvas.width,
      height: canvas.clientHeight || rect.height || canvas.height,
    };
  };

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const hitPoint = new THREE.Vector3();
  const projected = new THREE.Vector3();

  const screenToWorld = (px: number, py: number): { x: number; z: number } => {
    const size = canvasSize();
    pointer.set((px / size.width) * 2 - 1, -(py / size.height) * 2 + 1);
    raycaster.setFromCamera(pointer, scene.camera);
    if (raycaster.ray.intersectPlane(groundPlane, hitPoint)) {
      return { x: hitPoint.x, z: hitPoint.z };
    }
    return { x: 0, z: 0 };
  };

  const worldToScreen = (x: number, z: number): { x: number; y: number } => {
    const size = canvasSize();
    projected.set(x, 0, z).project(scene.camera);
    return {
      x: (projected.x * 0.5 + 0.5) * size.width,
      y: (-projected.y * 0.5 + 0.5) * size.height,
    };
  };

  const update = (dt: number, events: BattleEvent[]): void => {
    for (const event of events) {
      if (event.type === 'hit') {
        spawnBlood(event.x, event.z);
      } else if (event.type === 'shot') {
        spawnArrow(event.fromX, event.fromZ, event.toX, event.toZ);
      }
    }

    syncBattle();
    for (const visual of visuals.values()) visual.mixer.update(dt);
    updateBlood(dt);
    updateArrows(dt);
    updateRings(dt);
  };

  const setSelected = (platoonId: number | null): void => {
    selectedId = platoonId;
    if (platoonId === null) selectionRing.visible = false;
  };

  const showMoveMarker = (x: number, z: number): void => {
    moveMarker.position.set(x, 0.04, z);
    markerLife = 1;
    markerMaterial.opacity = 1;
    moveMarker.visible = true;
  };

  const dispose = (): void => {
    const ownedMaterials = new Set<THREE.Material>();

    for (const visual of visuals.values()) {
      visual.mixer.stopAllAction();
      visual.root.traverse((obj) => {
        if (!(obj instanceof THREE.Mesh)) return;
        if (obj.userData.ownedMaterial !== true) return;
        const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const material of materials) ownedMaterials.add(material);
      });
      scene.scene.remove(visual.root);
    }
    visuals.clear();
    lastState.clear();
    for (const material of ownedMaterials) material.dispose();

    scene.scene.remove(selectionRing);
    scene.scene.remove(moveMarker);
    scene.scene.remove(bloodMesh);
    for (const arrow of arrows) scene.scene.remove(arrow.mesh);

    selectionGeometry.dispose();
    selectionMaterial.dispose();
    markerGeometry.dispose();
    markerMaterial.dispose();
    bloodGeometry.dispose();
    bloodMaterial.dispose();
    bloodMesh.dispose();
    arrowGeometry.dispose();
    arrowMaterial.dispose();
  };

  syncBattle();

  return {
    update,
    syncBattle,
    screenToWorld,
    worldToScreen,
    setSelected,
    showMoveMarker,
    dispose,
  };
}
