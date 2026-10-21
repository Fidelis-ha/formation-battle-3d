import * as THREE from 'three';

export interface CameraRig {
  update(dt: number, keys: Set<string>): void;
  onWheel(dy: number): void;
  beginPan(x: number, y: number): void;
  panTo(x: number, y: number): void;
  endPan(): void;
  focus(x: number, z: number): void;
  readonly target: THREE.Vector3;
}

const MIN_DISTANCE = 10;
const MAX_DISTANCE = 40;
const MOVE_SPEED = 12;
const PAN_FACTOR = 0.05;
const WORLD_LIMIT = 60;

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

export function createCameraRig(
  camera: THREE.PerspectiveCamera,
  _canvas: HTMLCanvasElement,
): CameraRig {
  camera.fov = 45;
  camera.updateProjectionMatrix();

  // Startpunkt nah hinter den eigenen Truppen (z=38), Blick in Richtung Gegner.
  // Niedrige Neigung (~23 Grad) wie im Original: die eigene Formation steht im
  // unteren Bilddrittel, der Horizont liegt knapp unter dem oberen Rand.
  const target = new THREE.Vector3(0, 0, 24);
  const startOffset = new THREE.Vector3(0, 11, 26);
  let distance = clamp(startOffset.length(), MIN_DISTANCE, MAX_DISTANCE);
  let goalDistance = distance;
  let pitch = Math.atan2(startOffset.y, Math.hypot(startOffset.x, startOffset.z));
  let yaw = Math.atan2(startOffset.x, startOffset.z);

  let panning = false;
  let lastX = 0;
  let lastY = 0;

  const forward = new THREE.Vector3();
  const right = new THREE.Vector3();

  const applyCamera = (): void => {
    const cosPitch = Math.cos(pitch);
    camera.position.set(
      target.x + Math.sin(yaw) * cosPitch * distance,
      target.y + Math.sin(pitch) * distance,
      target.z + Math.cos(yaw) * cosPitch * distance,
    );
    camera.lookAt(target);
  };

  const clampTarget = (): void => {
    target.x = clamp(target.x, -WORLD_LIMIT, WORLD_LIMIT);
    target.z = clamp(target.z, -WORLD_LIMIT, WORLD_LIMIT);
    target.y = 0;
  };

  const updateDirections = (): void => {
    forward.set(-Math.sin(yaw), 0, -Math.cos(yaw));
    right.set(Math.cos(yaw), 0, -Math.sin(yaw));
  };

  const update = (dt: number, keys: Set<string>): void => {
    const pressed = (key: string): boolean => keys.has(key) || keys.has(key.toUpperCase());
    updateDirections();

    let moveX = 0;
    let moveZ = 0;
    if (pressed('w') || keys.has('ArrowUp')) {
      moveX += forward.x;
      moveZ += forward.z;
    }
    if (pressed('s') || keys.has('ArrowDown')) {
      moveX -= forward.x;
      moveZ -= forward.z;
    }
    if (pressed('d') || keys.has('ArrowRight')) {
      moveX += right.x;
      moveZ += right.z;
    }
    if (pressed('a') || keys.has('ArrowLeft')) {
      moveX -= right.x;
      moveZ -= right.z;
    }

    const length = Math.hypot(moveX, moveZ);
    if (length > 1e-6) {
      const step = MOVE_SPEED * dt;
      target.x += (moveX / length) * step;
      target.z += (moveZ / length) * step;
    }
    clampTarget();

    // Gedämpfter Zoom.
    distance += (goalDistance - distance) * (1 - Math.exp(-8 * dt));
    applyCamera();
  };

  const onWheel = (dy: number): void => {
    goalDistance = clamp(goalDistance + dy * 0.02, MIN_DISTANCE, MAX_DISTANCE);
  };

  const beginPan = (x: number, y: number): void => {
    panning = true;
    lastX = x;
    lastY = y;
  };

  const panTo = (x: number, y: number): void => {
    if (!panning) return;
    const dx = x - lastX;
    const dy = y - lastY;
    lastX = x;
    lastY = y;
    updateDirections();
    target.addScaledVector(right, -dx * PAN_FACTOR);
    target.addScaledVector(forward, dy * PAN_FACTOR);
    clampTarget();
    applyCamera();
  };

  const endPan = (): void => {
    panning = false;
  };

  const focus = (x: number, z: number): void => {
    target.x = clamp(x, -WORLD_LIMIT, WORLD_LIMIT);
    target.z = clamp(z, -WORLD_LIMIT, WORLD_LIMIT);
    target.y = 0;
    applyCamera();
  };

  applyCamera();
  return { update, onWheel, beginPan, panTo, endPan, focus, target };
}
