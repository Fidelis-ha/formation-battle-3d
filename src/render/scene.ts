import * as THREE from 'three';
import { buildLandscape, type LandscapeHandle } from './landscape';

export interface SceneHandle {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  sun: THREE.DirectionalLight;
  ground: THREE.Mesh;
  /** Landschaft (Boden, Wasser, Baeume, Gras). */
  landscape: LandscapeHandle;
}

export function createScene(canvas: HTMLCanvasElement): SceneHandle {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  // Gemessen am Original (v0.1.1-Screenshot): der Boden fuellt das ganze Bild,
  // es gibt keinen schwarzen Himmelsstreifen. Hintergrund und Nebel nehmen
  // deshalb die Bodenfarbe an, statt fast schwarz zu sein.
  const HORIZON = 0x8ba0ac;
  scene.background = new THREE.Color(HORIZON);
  scene.fog = new THREE.FogExp2(HORIZON, 0.0022);

  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 900);
  camera.position.set(0, 9, 60);
  camera.lookAt(0, 0, 20);

  const sun = new THREE.DirectionalLight(0xfff6e8, 2.15);
  sun.position.set(40, 60, 24);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -45;
  sun.shadow.camera.right = 45;
  sun.shadow.camera.top = 45;
  sun.shadow.camera.bottom = -45;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 220;
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.02;
  scene.add(sun);
  scene.add(sun.target);

  const ambient = new THREE.AmbientLight(0xdfe8ea, 0.62);
  scene.add(ambient);

  const ground = new THREE.Mesh(
    // Sehr grosse Flaeche, damit der Horizont ausserhalb des Bildes liegt.
    new THREE.PlaneGeometry(1600, 1600),
    new THREE.MeshStandardMaterial({ color: 0x8ba0ac, roughness: 1, metalness: 0 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // Der flache Plangrund bleibt als Unterlage in der Ferne liegen; die
  // eigentliche Landschaft (Huegel, Fluss, Wald) kommt darueber.
  ground.position.y = -0.05;

  const landscape = buildLandscape();
  scene.add(landscape.group);

  const handle: SceneHandle = { renderer, scene, camera, sun, ground, landscape };
  resizeScene(handle, canvas.clientWidth || 960, canvas.clientHeight || 540);
  return handle;
}

export function resizeScene(h: SceneHandle, width: number, height: number): void {
  const w = Math.max(1, Math.floor(width));
  const hgt = Math.max(1, Math.floor(height));
  h.camera.aspect = w / hgt;
  h.camera.updateProjectionMatrix();
  h.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  h.renderer.setSize(w, hgt, false);
}
