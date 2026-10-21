import * as THREE from 'three';

export interface SceneHandle {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  sun: THREE.DirectionalLight;
  ground: THREE.Mesh;
}

function createGrass(scene: THREE.Scene): void {
  const tufts = 40;
  const bladesPerTuft = 3;
  const geometry = new THREE.ConeGeometry(0.12, 0.55, 4);
  const material = new THREE.MeshStandardMaterial({
    color: 0xb8892f,
    roughness: 1,
    flatShading: true,
  });
  const mesh = new THREE.InstancedMesh(geometry, material, tufts * bladesPerTuft);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;

  let seed = 0x1f2e3d4c;
  const random = (): number => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };

  const dummy = new THREE.Object3D();
  for (let i = 0; i < tufts; i++) {
    const side = Math.floor(random() * 4);
    const along = random() * 132 - 66;
    const edge = 64 + random() * 5;
    let x = along;
    let z = edge;
    if (side === 0) {
      x = along;
      z = edge;
    } else if (side === 1) {
      x = along;
      z = -edge;
    } else if (side === 2) {
      x = edge;
      z = along;
    } else {
      x = -edge;
      z = along;
    }

    for (let blade = 0; blade < bladesPerTuft; blade++) {
      const scale = 0.7 + random() * 0.9;
      dummy.position.set(x + (random() - 0.5) * 1.4, 0.28 * scale, z + (random() - 0.5) * 1.4);
      dummy.rotation.set(0, random() * Math.PI * 2, (random() - 0.5) * 0.2);
      dummy.scale.setScalar(scale);
      dummy.updateMatrix();
      mesh.setMatrixAt(i * bladesPerTuft + blade, dummy.matrix);
    }
  }
  mesh.instanceMatrix.needsUpdate = true;
  scene.add(mesh);
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

  createGrass(scene);

  const handle: SceneHandle = { renderer, scene, camera, sun, ground };
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
