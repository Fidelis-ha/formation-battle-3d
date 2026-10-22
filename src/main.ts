import * as THREE from 'three';
import {
  createBattle,
  step,
  issueMove,
  issueAttack,
  toggleAutoAttack,
  toggleAutoApproach,
  switchWeapon,
  platoonAt,
  drainEvents,
} from './sim/battle';
import type { Battle } from './sim/types';
import { createScene, resizeScene, type SceneHandle } from './render/scene';
import { createCameraRig, type CameraRig } from './render/camera';
import { loadAssets, type Assets } from './render/assets';
import { createBattleView, type BattleView } from './render/battleview';
import { createHud, type Hud } from './ui/hud';
import { createOverlays, type Overlays } from './ui/overlays';
import { createBuildBar, type BuildBar } from './ui/buildbar';
import { createStructureView, type StructureView } from './render/structures';
import { createSelector, type Selector } from './ui/selector';
import { personalityById, PERSONALITIES, type Personality } from './sim/ai/personality';
import { MAPS, type BattleMap } from './sim/maps';
import { assignReserve, createBrain, think, type BrainState } from './sim/ai/brain';
import { buildStructure, startBattlePhase } from './sim/battle';
import { initLanguage, t, toggleLanguage } from './ui/i18n';

const BASE_W = 960;
const BASE_H = 540;

interface App {
  battle: Battle;
  scene: SceneHandle;
  rig: CameraRig;
  view: BattleView;
  hud: Hud;
  overlays: Overlays;
  selectedId: number | null;
  paused: boolean;
  clock: number;
  /** Anzeige der gebauten Anlagen. */
  structures: StructureView;
  /** Bauleiste (nur in der Bauphase sichtbar). */
  buildBar: BuildBar;
  /** Gegnerauswahl und Kampagne. */
  selector: Selector;
  /** Gewaehlter Gegner (Persoenlichkeit). */
  opponent: Personality;
  /** Gehirn des Gegners, falls gesetzt. */
  enemyBrain: BrainState | null;
  /** Laeuft gerade eine Kampagne? */
  campaign: boolean;
}

/** Damit ein Sieg den Kampagnen-Fortschritt nur einmal weiterschaltet. */
let campaignAdvanced = false;

/** Gemerkte Bausteine fuer einen Neustart gegen einen anderen Gegner. */
let assetsRef: Assets | null = null;
let sceneRef: SceneHandle | null = null;
let rigRef: CameraRig | null = null;

let app: App | null = null;

// Sprache aus dem Speicher lesen, BEVOR die Oberflaeche gebaut wird.
initLanguage();

function uiRoot(): HTMLElement {
  const el = document.getElementById('ui');
  if (!el) throw new Error('#ui fehlt');
  return el;
}

function scaleUi(): void {
  const el = uiRoot();
  const scale = Math.min(window.innerWidth / BASE_W, window.innerHeight / BASE_H);
  el.style.transform = `scale(${scale})`;
  el.style.width = `${BASE_W}px`;
  el.style.height = `${BASE_H}px`;
  el.style.transformOrigin = 'top left';
  el.style.left = `${(window.innerWidth - BASE_W * scale) / 2}px`;
  el.style.top = `${(window.innerHeight - BASE_H * scale) / 2}px`;
}

function buildUi(
  battle: Battle,
  scene: SceneHandle,
  rig: CameraRig,
  view: BattleView,
): { hud: Hud; overlays: Overlays; buildBar: BuildBar; structures: StructureView; selector: Selector } {
  const hud = createHud({
    onSelectPlatoon: (id) => selectPlatoon(id),
    onToggleAutoAttack: () => {
      if (!app || app.selectedId === null) return;
      toggleAutoAttack(app.battle, app.selectedId);
    },
    onToggleAutoApproach: () => {
      if (!app || app.selectedId === null) return;
      toggleAutoApproach(app.battle, app.selectedId);
    },
    onSwitchWeapon: () => {
      if (!app || app.selectedId === null) return;
      switchWeapon(app.battle, app.selectedId);
    },
    onPause: () => setPaused(true),
    onToggleLanguage: () => {
      toggleLanguage();
      rebuildUi();
    },
    onMinimapClick: (x, z) => rig.focus(x, z),
    onMinimapOrder: (x, z) => {
      if (!app || app.selectedId === null) return;
      issueMove(app.battle, app.selectedId, x, z);
      app.view.showMoveMarker(x, z);
    },
  });

  const overlays = createOverlays({
    onClose: () => {
      overlays.hideAll();
      if (app) app.paused = false;
    },
    onRestart: () => window.location.reload(),
    onResume: () => setPaused(false),
  });

  const structures = createStructureView(scene.scene);
  structures.sync(battle.structures);

  const buildBar = createBuildBar({
    onPick: () => {
      /* Auswahl wird in der Leiste gefuehrt; der Klick aufs Feld setzt. */
    },
    onStartBattle: () => {
      if (!app) return;
      startBattlePhase(app.battle);
      buildBar.hide();
      app.structures.sync(app.battle.structures);
    },
  });

  const selector = createSelector({
    onPick: (personality, map) => {
      // Freies Spiel: neue Schlacht gegen den gewaehlten Gegner auf der
      // gewaehlten Karte.
      if (!app) return;
      restartAgainst(personality, false, map);
    },
    onCampaign: (personality, progress, map) => {
      if (!app) return;
      void progress;
      restartAgainst(personality, true, map);
    },
  });

  return { hud, overlays, buildBar, structures, selector };
}

function startBattle(
  assets: Assets,
  scene: SceneHandle,
  rig: CameraRig,
  opponent: Personality,
  campaign: boolean,
  map: BattleMap,
): void {
  campaignAdvanced = false;
  // Fuer einen Neustart gegen einen anderen Gegner merken.
  assetsRef = assets;
  sceneRef = scene;
  rigRef = rig;
  const battle = createBattle(Date.now() % 100000, map.id);
  const view = createBattleView(scene, assets, battle);

  // Der gewaehlte Gegner uebernimmt die feindliche Fraktion: seine
  // Persoenlichkeit fuehrt, der Sockel schweigt fuer diese Seite.
  battle.aiControlled = ['enemy'];
  const enemyBrain = createBrain(opponent, 'enemy', battle.seed);
  assignReserve(battle, enemyBrain);

  const { hud, overlays, buildBar, structures, selector } = buildUi(battle, scene, rig, view);

  const root = uiRoot();
  root.innerHTML = '';
  root.appendChild(hud.root);
  root.appendChild(buildBar.root);
  root.appendChild(overlays.root);
  root.appendChild(selector.root);

  app = {
    battle, scene, rig, view, hud, overlays,
    selectedId: null, paused: true, clock: 0,
    structures, buildBar, selector, opponent, enemyBrain, campaign,
  };
  // Debug-Handle fuer automatisierte Pruefung (Screenshots, Steuerungstests).
  (window as unknown as { __fb: unknown }).__fb = {
    get state() {
      if (!app) return null;
      return {
        paused: app.paused,
        clock: app.clock,
        time: app.battle.time,
        status: app.battle.status,
        selected: app.selectedId,
        blocking: app.overlays.isBlocking(),
        alive: app.battle.platoons.map((p) => `${p.faction}:${p.kind}:${p.aliveCount}`),
      };
    },
    select: (id: number) => selectPlatoon(id),
    pause: (v: boolean) => setPaused(v),
    get battle() {
      return app?.battle ?? null;
    },
    // Gewaehlter Gegner und sein Gehirn — fuer die Abnahme der Gegnerauswahl.
    get opponent() {
      return app?.opponent ?? null;
    },
    get enemyBrain() {
      return app?.enemyBrain ?? null;
    },
    get campaign() {
      return app?.campaign ?? false;
    },
    // Auswahl oeffnen (fuer Pruefung und Kampagnen-Neustart).
    openSelector: () => app?.selector.show(),
    // Bildschirmpunkt eines Weltpunkts, ueber die echte Kamera projiziert.
    // Damit lassen sich Klicks praezise pruefen, ohne Koordinaten zu raten.
    project: (x: number, z: number) => {
      if (!app) return null;
      const v = new THREE.Vector3(x, 0, z).project(app.scene.camera);
      const canvas = app.scene.renderer.domElement;
      const rect = canvas.getBoundingClientRect();
      return {
        x: rect.left + ((v.x + 1) / 2) * rect.width,
        y: rect.top + ((1 - v.y) / 2) * rect.height,
      };
    },
    // Weltpunkt unter einem Bildschirmpunkt.
    unproject: (clientX: number, clientY: number) => {
      if (!app) return null;
      const canvas = app.scene.renderer.domElement;
      const rect = canvas.getBoundingClientRect();
      return app.view.screenToWorld(clientX - rect.left, clientY - rect.top);
    },
    get stats() {
      if (!app) return null;
      const info = app.scene.renderer.info;
      let meshes = 0;
      let skinned = 0;
      app.scene.scene.traverse((o) => {
        if ((o as { isMesh?: boolean }).isMesh) meshes += 1;
        if ((o as { isSkinnedMesh?: boolean }).isSkinnedMesh) skinned += 1;
      });
      return { drawCalls: info.render.calls, triangles: info.render.triangles, meshes, skinned };
    },
    stepOnce: (dt: number) => {
      if (app) step(app.battle, dt);
      return app?.battle.time;
    },
    // Fuer die Pruefung im Headless-Browser, der requestAnimationFrame fast
    // nicht ausfuehrt: Simulation vorspulen und genau ein Bild rendern.
    advance: (seconds: number) => {
      if (!app) return null;
      const steps = Math.round(seconds * 30);
      for (let i = 0; i < steps; i += 1) {
        if (app.battle.status !== 'running') break;
        step(app.battle, 1 / 30);
        const ev = drainEvents(app.battle);
        app.view.syncBattle();
        app.view.update(1 / 30, ev);
      }
      app.clock = app.battle.time;
      app.hud.update(app.battle, app.selectedId);
      app.hud.setTime(app.clock);
      app.structures.sync(app.battle.structures);
      app.structures.update(0.3);
      syncBuildPhase(app);
      syncCampaign();
      app.scene.renderer.render(app.scene.scene, app.scene.camera);
      return app.battle.time;
    },
  };
  overlays.showBriefing();
}

/**
 * Kampagnen-Fortschritt pruefen und ggf. weiterschalten.
 *
 * Wird aus der Hauptschleife UND aus `advance()` aufgerufen. Vorher stand die
 * Logik nur in der Hauptschleife — im Testbetrieb (der `advance()` benutzt)
 * wurde ein Sieg deshalb nie verbucht, und der Fortschritt blieb auf 0.
 */
function syncCampaign(): void {
  if (!app) return;
  if (app.battle.status !== 'running') {
    if (app.campaign && app.battle.status === 'victory' && !campaignAdvanced) {
      campaignAdvanced = true;
      app.selector.advanceCampaign();
    }
  }
}

/**
 * Neue Schlacht gegen einen gewaehlten Gegner starten.
 *
 * Baut Szene und UI komplett neu auf: der Gegner ist eine andere
 * Persoenlichkeit, seine Truppen und sein Gehirn muessen frisch sein.
 */
function restartAgainst(opponent: Personality, campaign: boolean, map: BattleMap): void {
  if (!assetsRef || !sceneRef || !rigRef) return;
  app = null;
  startBattle(assetsRef, sceneRef, rigRef, opponent, campaign, map);
}

/**
 * Bauphase und Schlacht sauber umschalten: Bauleiste zeigen/verstecken,
 * Anlagen nachziehen. Wird jeden Bildlauf aufgerufen und ist deshalb
 * idempotent.
 */
function syncBuildPhase(current: NonNullable<typeof app>): void {
  const building = current.battle.phase === 'build';
  current.hud.root.classList.toggle('building', building);
  if (building) {
    current.buildBar.show();
    current.buildBar.update(current.battle);
  } else {
    current.buildBar.hide();
    current.structures.sync(current.battle.structures);
  }
}

/**
 * Oberflaeche neu aufbauen. Wird beim Sprachwechsel gebraucht: die Texte
 * werden beim Erzeugen gesetzt, deshalb muessen HUD und Overlays neu entstehen.
 * Die Schlacht selbst bleibt unangetastet.
 */
function rebuildUi(): void {
  if (!app) return;
  const { battle, scene, rig, view, selectedId, paused } = app;
  const root = uiRoot();
  root.innerHTML = '';
  const built = buildUi(battle, scene, rig, view);
  root.appendChild(built.hud.root);
  root.appendChild(built.buildBar.root);
  root.appendChild(built.overlays.root);
  app.hud = built.hud;
  app.overlays = built.overlays;
  // Die Bauleiste wird ebenfalls neu gebaut — sonst fehlt sie nach einem
  // Sprachwechsel komplett (ihre Texte entstehen beim Erzeugen).
  app.buildBar = built.buildBar;
  app.structures = built.structures;
  app.selectedId = selectedId;
  app.paused = paused;
  app.hud.update(battle, selectedId);
  app.hud.setTime(app.clock);
  syncBuildPhase(app);
  if (paused) app.overlays.showPause();
}

function selectPlatoon(id: number): void {
  if (!app) return;
  app.selectedId = id;
  app.view.setSelected(id);
}

function setPaused(paused: boolean): void {
  if (!app) return;
  app.paused = paused;
  app.hud.setPaused(paused);
  if (paused) app.overlays.showPause();
  else app.overlays.hideAll();
}

function bindInput(canvas: HTMLCanvasElement, rig: CameraRig): void {
  const keys = new Set<string>();
  const isBlocked = () => app?.overlays.isBlocking() ?? false;

  window.addEventListener('keydown', (e) => {
    keys.add(e.code);
    if (!app) return;
    if (e.code === 'Escape') {
      setPaused(!app.paused);
      return;
    }
    if (isBlocked()) return;
    if (e.code === 'KeyQ' && app.selectedId !== null) toggleAutoAttack(app.battle, app.selectedId);
    if (e.code === 'KeyE' && app.selectedId !== null) switchWeapon(app.battle, app.selectedId);
    const digit = /^Digit([1-5])$/.exec(e.code);
    if (digit) {
      const idx = Number(digit[1]) - 1;
      const own = app.battle.platoons.filter((p) => p.faction === 'player');
      const platoon = own[idx];
      if (platoon) selectPlatoon(platoon.id);
    }
  });
  window.addEventListener('keyup', (e) => keys.delete(e.code));

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    rig.onWheel(e.deltaY);
  }, { passive: false });

  canvas.addEventListener('pointerdown', (e) => {
    if (!app) return;
    if (e.button === 1) {
      rig.beginPan(e.clientX, e.clientY);
      e.preventDefault();
    }
  });
  canvas.addEventListener('pointermove', (e) => {
    if (e.buttons & 4) rig.panTo(e.clientX, e.clientY);
  });
  window.addEventListener('pointerup', () => rig.endPan());

  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  canvas.addEventListener('pointerup', (e) => {
    if (!app || app.paused || isBlocked()) return;
    if (e.button !== 0 && e.button !== 2) return;
    const rect = canvas.getBoundingClientRect();
    const wx = app.view.screenToWorld(e.clientX - rect.left, e.clientY - rect.top);

    // Bauphase: Linksklick setzt die gewaehlte Anlage, Rechtsklick bricht ab.
    if (app.battle.phase === 'build') {
      const picked = app.buildBar.selected();
      if (e.button === 2) {
        app.buildBar.selected();
        return;
      }
      if (picked === null) return;
      const error = buildStructure(app.battle, 'player', picked, wx.x, wx.z);
      if (error !== null) {
        app.buildBar.flash(t(error));
      } else {
        app.structures.sync(app.battle.structures);
        app.buildBar.update(app.battle);
      }
      return;
    }

    if (e.button === 0) {
      const own = platoonAt(app.battle, wx.x, wx.z, 'player');
      if (own) selectPlatoon(own.id);
      return;
    }

    // Rechtsklick: Angriff, wenn Feindtrupp getroffen, sonst Marschbefehl
    if (app.selectedId === null) return;
    const enemy = platoonAt(app.battle, wx.x, wx.z, 'enemy');
    if (enemy) issueAttack(app.battle, app.selectedId, enemy.id);
    else issueMove(app.battle, app.selectedId, wx.x, wx.z);
    app.view.showMoveMarker(wx.x, wx.z);
  });

  // ------------------------------------------------------------- Touch-Bedienung
  // Auf dem Handy gibt es keinen Rechtsklick. Regeln:
  //   kurzer Tipp auf eigenen Trupp  -> auswaehlen
  //   kurzer Tipp auf Feindtrupp     -> angreifen (wenn ein Trupp gewaehlt ist)
  //   kurzer Tipp auf freies Feld    -> Marschbefehl
  //   zwei Finger                    -> Kamera ziehen
  // Damit kommt man mit einem Finger aus.
  let touchStart: { x: number; y: number; time: number } | null = null;
  let touchMoved = false;

  const worldAt = (clientX: number, clientY: number): { x: number; z: number } | null => {
    if (!app) return null;
    const rect = canvas.getBoundingClientRect();
    return app.view.screenToWorld(clientX - rect.left, clientY - rect.top);
  };

  canvas.addEventListener('touchstart', (e) => {
    if (e.touches.length === 2) {
      const a = e.touches[0];
      const b = e.touches[1];
      rig.beginPan((a.clientX + b.clientX) / 2, (a.clientY + b.clientY) / 2);
      touchStart = null;
      e.preventDefault();
      return;
    }
    const t0 = e.touches[0];
    touchStart = { x: t0.clientX, y: t0.clientY, time: Date.now() };
    touchMoved = false;
  }, { passive: true });

  canvas.addEventListener('touchmove', (e) => {
    if (e.touches.length === 2) {
      const a = e.touches[0];
      const b = e.touches[1];
      rig.panTo((a.clientX + b.clientX) / 2, (a.clientY + b.clientY) / 2);
      e.preventDefault();
      return;
    }
    if (!touchStart) return;
    const t0 = e.touches[0];
    if (Math.hypot(t0.clientX - touchStart.x, t0.clientY - touchStart.y) > 14) touchMoved = true;
  }, { passive: true });

  canvas.addEventListener('touchend', (e) => {
    if (e.touches.length === 0) rig.endPan();
    if (!touchStart || touchMoved) {
      touchStart = null;
      return;
    }
    const held = Date.now() - touchStart.time;
    const at = worldAt(touchStart.x, touchStart.y);
    touchStart = null;
    if (!app || app.paused || isBlocked() || !at) return;
    if (held > 700) return; // langes Halten ist kein Befehl

    // Bauphase: Tippen setzt die gewaehlte Anlage.
    if (app.battle.phase === 'build') {
      const pickedKind = app.buildBar.selected();
      if (pickedKind === null) return;
      const buildError = buildStructure(app.battle, 'player', pickedKind, at.x, at.z);
      if (buildError !== null) app.buildBar.flash(t(buildError));
      else {
        app.structures.sync(app.battle.structures);
        app.buildBar.update(app.battle);
      }
      return;
    }

    // 1. Eigener Trupp getroffen -> auswaehlen.
    const own = platoonAt(app.battle, at.x, at.z, 'player');
    if (own) {
      selectPlatoon(own.id);
      return;
    }

    // 2. Feindtrupp getroffen -> angreifen.
    if (app.selectedId !== null) {
      const enemy = platoonAt(app.battle, at.x, at.z, 'enemy');
      if (enemy) {
        issueAttack(app.battle, app.selectedId, enemy.id);
        app.view.showMoveMarker(at.x, at.z);
        return;
      }
      // 3. Freies Feld -> Marschbefehl.
      issueMove(app.battle, app.selectedId, at.x, at.z);
      app.view.showMoveMarker(at.x, at.z);
    }
  }, { passive: true });

  const frame = (dt: number) => rig.update(dt, keys);
  inputFrame = frame;
}

let inputFrame: ((dt: number) => void) | null = null;

async function boot(): Promise<void> {
  const canvas = document.getElementById('scene') as HTMLCanvasElement | null;
  if (!canvas) throw new Error('#scene fehlt');

  scaleUi();
  window.addEventListener('resize', () => {
    scaleUi();
    if (app) resizeScene(app.scene, window.innerWidth, window.innerHeight);
  });

  const scene = createScene(canvas);
  const rig = createCameraRig(scene.camera, canvas);
  bindInput(canvas, rig);

  const assets = await loadAssets();
  // Zuerst die Gegnerauswahl zeigen. Ohne Auswahl startet das Spiel gegen den
  // ersten Gegner, damit ein Klick weniger genuegt.
  startBattle(assets, scene, rig, PERSONALITIES[0], false, MAPS[0]);
  app?.selector.show();

  const clock = new THREE.Clock();
  let last = 0;
  const loop = () => {
    const dt = Math.min(clock.getDelta(), 0.05);
    last += dt;
    if (app) {
      if (!app.paused && app.battle.status === 'running') {
        // Der Gegner denkt: seine Persoenlichkeit setzt Ziele und Marschwege,
        // der Sockel fuehrt sie aus. Ohne diesen Aufruf spielt der Gegner die
        // alte Einheits-KI und die Eigenart waere unsichtbar.
        if (app.enemyBrain) think(app.battle, app.enemyBrain);
        step(app.battle, dt);
        app.clock = app.battle.time;
      }
      const events = drainEvents(app.battle);
      app.view.syncBattle();
      app.view.update(dt, events);
      app.hud.update(app.battle, app.selectedId);
      app.hud.setTime(app.clock);
      app.structures.update(dt);
      syncBuildPhase(app);
      if (app.battle.status !== 'running') {
        app.overlays.showResult(app.battle.status, app.battle.time);
        app.paused = true;
        // Kampagne: ein Sieg schaltet den naechsten Gegner frei.
        syncCampaign();
      }
    }
    inputFrame?.(dt);
    scene.renderer.render(scene.scene, scene.camera);
    requestAnimationFrame(loop);
  };
  loop();
}

boot().catch((err) => {
  console.error(err);
  const el = document.getElementById('ui');
  if (el) el.innerHTML = `<pre style="color:#f88;padding:24px;font:14px monospace">Fehler beim Laden:\n${String(err)}</pre>`;
});
