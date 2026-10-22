import type { Battle, Platoon, UnitKind } from '../sim/types';
import { UNIT_STATS } from '../sim/units';
import { t, getLanguage, unitName } from './i18n';

export interface HudHandlers {
  onSelectPlatoon(id: number): void;
  onToggleAutoAttack(): void;
  onToggleAutoApproach(): void;
  onSwitchWeapon(): void;
  onPause(): void;
  /** Sprache umschalten (EN <-> DE). */
  onToggleLanguage(): void;
  onMinimapClick(x: number, z: number): void;
  onMinimapOrder(x: number, z: number): void;
}

export interface Hud {
  root: HTMLElement;
  update(battle: Battle, selectedId: number | null): void;
  setTime(seconds: number): void;
  setPaused(paused: boolean): void;
}

const ABBREV: Record<UnitKind, string> = {
  archer: 'ARC',
  spearman: 'SPR',
  infantry: 'INF',
  housecarl: 'HOU',
  cavalry: 'CAV',
};

const MINIMAP_WIDTH = 180;
const MINIMAP_HEIGHT = 120;
const MAP_TOP = { x: 90, y: 8 };
const MAP_RIGHT = { x: 172, y: 112 };
const MAP_LEFT = { x: 8, y: 112 };
const WORLD_HALF = 60;

interface RowRefs {
  row: HTMLButtonElement | HTMLDivElement;
  key: HTMLElement;
  icon: HTMLElement;
  name: HTMLElement;
  count: HTMLElement;
  fill: HTMLElement;
}

interface MinimapPoint {
  x: number;
  z: number;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className !== undefined) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

function formatTime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return `${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}

function platoonHpRatio(platoon: Platoon): number {
  let hp = 0;
  let maxHp = 0;
  for (const soldier of platoon.soldiers) {
    hp += Math.max(0, soldier.hp);
    maxHp += soldier.maxHp;
  }
  return maxHp > 0 ? clamp(hp / maxHp, 0, 1) : 0;
}

function weaponLabel(kind: UnitKind, mode: number): string {
  if (kind === 'archer') return mode === 0 ? t('bow') : t('dagger');
  if (kind === 'cavalry') return mode === 0 ? t('spear') : t('sword');
  return UNIT_STATS[kind].weapon;
}

function createRows(
  list: HTMLElement,
  interactive: boolean,
  handlers: HudHandlers,
): RowRefs[] {
  const rows: RowRefs[] = [];

  for (let index = 0; index < 5; index++) {
    const row: HTMLButtonElement | HTMLDivElement = interactive
      ? el('button', 'platoon-row')
      : el('div', 'platoon-row platoon-row--enemy');

    if (row instanceof HTMLButtonElement) {
      row.type = 'button';
      row.addEventListener('click', () => {
        const raw = row.dataset.platoonId;
        if (raw === undefined) return;
        const id = Number(raw);
        if (Number.isFinite(id)) handlers.onSelectPlatoon(id);
      });
    }

    row.style.display = 'none';

    const key = el('span', 'platoon-key', String(index + 1));
    const icon = el('span', 'platoon-icon');
    const body = el('span', 'platoon-body');
    const top = el('span', 'platoon-top');
    const name = el('span', 'platoon-name');
    const count = el('span', 'platoon-count');
    const track = el('span', 'hp-track');
    const fill = el('span', 'hp-fill');

    track.append(fill);
    top.append(name, count);
    body.append(top, track);
    row.append(key, icon, body);
    list.append(row);

    rows.push({ row, key, icon, name, count, fill });
  }

  return rows;
}

function fillRows(
  rows: RowRefs[],
  platoons: Platoon[],
  selectedId: number | null,
): void {
  rows.forEach((refs, index) => {
    const platoon = platoons[index];
    if (platoon === undefined) {
      refs.row.style.display = 'none';
      delete refs.row.dataset.platoonId;
      return;
    }

    const stats = UNIT_STATS[platoon.kind];
    const selected = selectedId === platoon.id;

    refs.row.style.display = '';
    refs.row.dataset.platoonId = String(platoon.id);
    refs.row.classList.toggle('selected', selected);
    refs.row.classList.toggle('defeated', platoon.aliveCount <= 0);
    refs.row.setAttribute('aria-label', `${stats.name}, Squad ${platoon.aliveCount}`);
    refs.name.textContent = unitName(platoon.kind);
    refs.count.textContent = String(platoon.aliveCount);
    refs.icon.textContent = ABBREV[platoon.kind];
    refs.fill.style.width = `${(platoonHpRatio(platoon) * 100).toFixed(1)}%`;

    if (platoon.faction === 'player') {
      refs.row.setAttribute('aria-pressed', selected ? 'true' : 'false');
    }
  });
}

// Dreieckige, diagonale Projektion der quadratischen Welt auf die Minimap.
function worldToMinimap(x: number, z: number): { x: number; y: number } {
  const u = (clamp(x, -WORLD_HALF, WORLD_HALF) + WORLD_HALF) / (WORLD_HALF * 2);
  const v = (clamp(z, -WORLD_HALF, WORLD_HALF) + WORLD_HALF) / (WORLD_HALF * 2);
  return {
    x: MAP_TOP.x + u * (MAP_RIGHT.x - MAP_TOP.x) + v * (MAP_LEFT.x - MAP_TOP.x),
    y: MAP_TOP.y + u * (MAP_RIGHT.y - MAP_TOP.y) + v * (MAP_LEFT.y - MAP_TOP.y),
  };
}

function minimapToWorld(px: number, py: number): MinimapPoint {
  const dx = px - MAP_TOP.x;
  const dy = py - MAP_TOP.y;
  const spanX = MAP_RIGHT.x - MAP_TOP.x;
  const spanY = MAP_RIGHT.y - MAP_TOP.y;
  const u = (dx / spanX + dy / spanY) / 2;
  const v = (dy / spanY - dx / spanX) / 2;
  return {
    x: clamp(u * WORLD_HALF * 2 - WORLD_HALF, -WORLD_HALF, WORLD_HALF),
    z: clamp(v * WORLD_HALF * 2 - WORLD_HALF, -WORLD_HALF, WORLD_HALF),
  };
}

export function createHud(handlers: HudHandlers): Hud {
  const root = el('div', 'hud');

  const pauseButton = el('button', 'ui-btn hud-pause', '\u23F8 Pause');
  pauseButton.type = 'button';
  pauseButton.setAttribute('aria-label', t('pause'));
  pauseButton.addEventListener('click', () => handlers.onPause());

  // Sprachumschalter: zeigt die AKTIVE Sprache, ein Klick wechselt.
  const langButton = el('button', 'ui-btn hud-lang', getLanguage() === 'de' ? 'DE' : 'EN');
  langButton.type = 'button';
  langButton.setAttribute('aria-label', t('language'));
  langButton.title = t('language');
  langButton.addEventListener('click', () => handlers.onToggleLanguage());

  const timer = el('div', 'hud-timer', '00:00');

  const banner = el('div', 'hud-banner');
  banner.innerHTML = `
    <svg viewBox="0 0 64 48" role="img" aria-label="Player faction banner">
      <rect x="6" y="2" width="3" height="44" rx="1.5" fill="#cfc6a8"></rect>
      <path d="M9 4 L58 8 L48 18 L58 28 L9 24 Z" fill="#5b6ee1" stroke="#dfe4ff" stroke-width="1.5"></path>
      <circle cx="27" cy="15" r="5" fill="#ffd843" stroke="#2b356b" stroke-width="1.2"></circle>
      <path d="M27 10 L27 20 M22 15 L32 15" stroke="#2b356b" stroke-width="1.2"></path>
    </svg>
  `;

  const playerList = el('div', 'platoon-list platoon-list--player');
  const enemyList = el('div', 'platoon-list platoon-list--enemy');
  const playerRows = createRows(playerList, true, handlers);
  const enemyRows = createRows(enemyList, false, handlers);

  const minimap = el('div', 'hud-minimap');
  const minimapCanvas = el('canvas', 'minimap-canvas');
  minimapCanvas.width = MINIMAP_WIDTH;
  minimapCanvas.height = MINIMAP_HEIGHT;
  minimapCanvas.setAttribute('aria-label', t('miniMap'));
  minimap.append(minimapCanvas);

  const minimapCtx = minimapCanvas.getContext('2d');

  minimapCanvas.addEventListener('click', (event) => {
    const point = eventPoint(event);
    handlers.onMinimapClick(point.x, point.z);
  });

  minimapCanvas.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    const point = eventPoint(event);
    handlers.onMinimapOrder(point.x, point.z);
  });

  function eventPoint(event: MouseEvent): MinimapPoint {
    const rect = minimapCanvas.getBoundingClientRect();
    const px = ((event.clientX - rect.left) / rect.width) * MINIMAP_WIDTH;
    const py = ((event.clientY - rect.top) / rect.height) * MINIMAP_HEIGHT;
    return minimapToWorld(px, py);
  }

  const command = el('div', 'hud-command');

  const autoButton = el('button', 'ui-btn cmd-btn');
  autoButton.type = 'button';
  const autoLabel = el('span', 'cmd-label', t('autoAttack'));
  const autoKey = el('span', 'cmd-key', 'Q');
  const autoState = el('span', 'cmd-state', 'ON');
  autoButton.append(autoLabel, autoKey, autoState);
  autoButton.addEventListener('click', () => handlers.onToggleAutoAttack());

  const approachButton = el('button', 'ui-btn cmd-btn');
  approachButton.type = 'button';
  const approachLabel = el('span', 'cmd-label', t('autoApproach'));
  const approachState = el('span', 'cmd-state', 'ON');
  approachButton.append(approachLabel, approachState);
  approachButton.addEventListener('click', () => handlers.onToggleAutoApproach());

  const weaponButton = el('button', 'ui-btn cmd-btn');
  weaponButton.type = 'button';
  const weaponLabelEl = el('span', 'cmd-label', t('switchWeapon'));
  const weaponKey = el('span', 'cmd-key', 'E');
  const weaponState = el('span', 'cmd-state', t('bow'));
  weaponButton.append(weaponLabelEl, weaponKey, weaponState);
  weaponButton.addEventListener('click', () => handlers.onSwitchWeapon());

  command.append(autoButton, approachButton, weaponButton);

  const version = el('div', 'hud-version', 'Formation Battle - v0.1.5');

  root.append(
    pauseButton,
    langButton,
    timer,
    banner,
    playerList,
    enemyList,
    minimap,
    command,
    version,
  );

  function drawMinimap(battle: Battle, selectedId: number | null): void {
    if (minimapCtx === null) return;

    minimapCtx.clearRect(0, 0, MINIMAP_WIDTH, MINIMAP_HEIGHT);

    minimapCtx.fillStyle = '#0c1220';
    minimapCtx.fillRect(0, 0, MINIMAP_WIDTH, MINIMAP_HEIGHT);

    minimapCtx.beginPath();
    minimapCtx.moveTo(MAP_TOP.x, MAP_TOP.y);
    minimapCtx.lineTo(MAP_RIGHT.x, MAP_RIGHT.y);
    minimapCtx.lineTo(MAP_LEFT.x, MAP_LEFT.y);
    minimapCtx.closePath();
    minimapCtx.fillStyle = '#16203a';
    minimapCtx.fill();
    minimapCtx.strokeStyle = '#39456a';
    minimapCtx.lineWidth = 1;
    minimapCtx.stroke();

    minimapCtx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    minimapCtx.beginPath();
    for (const t of [0.25, 0.5, 0.75]) {
      const a = worldToMinimap(t * WORLD_HALF * 2 - WORLD_HALF, -WORLD_HALF);
      const b = worldToMinimap(t * WORLD_HALF * 2 - WORLD_HALF, WORLD_HALF);
      const c = worldToMinimap(-WORLD_HALF, t * WORLD_HALF * 2 - WORLD_HALF);
      const d = worldToMinimap(WORLD_HALF, t * WORLD_HALF * 2 - WORLD_HALF);
      minimapCtx.moveTo(a.x, a.y);
      minimapCtx.lineTo(b.x, b.y);
      minimapCtx.moveTo(c.x, c.y);
      minimapCtx.lineTo(d.x, d.y);
    }
    minimapCtx.stroke();

    for (const platoon of battle.platoons) {
      if (platoon.aliveCount <= 0) continue;

      const point = worldToMinimap(platoon.x, platoon.z);
      const selected = platoon.id === selectedId;

      minimapCtx.beginPath();
      minimapCtx.arc(point.x, point.y, selected ? 4 : 3, 0, Math.PI * 2);
      minimapCtx.fillStyle = platoon.faction === 'player' ? '#5b6ee1' : '#d1483f';
      minimapCtx.fill();

      if (selected) {
        minimapCtx.beginPath();
        minimapCtx.arc(point.x, point.y, 6, 0, Math.PI * 2);
        minimapCtx.strokeStyle = '#ffffff';
        minimapCtx.lineWidth = 1.5;
        minimapCtx.stroke();
      }
    }
  }

  function update(battle: Battle, selectedId: number | null): void {
    const players = battle.platoons.filter((platoon) => platoon.faction === 'player');
    const enemies = battle.platoons.filter((platoon) => platoon.faction === 'enemy');

    fillRows(playerRows, players, selectedId);
    fillRows(enemyRows, enemies, null);

    const selected =
      players.find((platoon) => platoon.id === selectedId) ?? players[0];

    if (selected === undefined) {
      autoState.textContent = '\u2014';
      weaponState.textContent = '\u2014';
      approachState.textContent = '\u2014';
      autoButton.classList.remove('active');
      weaponButton.classList.remove('active');
      approachButton.classList.remove('active');
    } else {
      autoState.textContent = selected.autoAttack ? t('on') : t('off');
      autoButton.classList.toggle('active', selected.autoAttack);
      autoButton.setAttribute('aria-pressed', selected.autoAttack ? 'true' : 'false');

      approachState.textContent = selected.autoApproach ? t('on') : t('off');
      approachButton.classList.toggle('active', selected.autoApproach);
      approachButton.setAttribute('aria-pressed', selected.autoApproach ? 'true' : 'false');

      weaponState.textContent = weaponLabel(selected.kind, selected.weaponMode);
      weaponButton.classList.toggle('active', selected.weaponMode === 1);
    }

    drawMinimap(battle, selectedId);
  }

  function setTime(seconds: number): void {
    timer.textContent = formatTime(seconds);
  }

  function setPaused(paused: boolean): void {
    pauseButton.classList.toggle('paused', paused);
    pauseButton.setAttribute('aria-pressed', paused ? 'true' : 'false');
  }

  setTime(0);
  setPaused(false);

  return { root, update, setTime, setPaused };
}
