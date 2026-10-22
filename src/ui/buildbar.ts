/**
 * Bauphase-Oberflaeche: Rohstoffe, Baupreise, Restzeit.
 *
 * Sie liegt als Leiste am unteren Rand ueber der Kommandoleiste. Ein Klick auf
 * eine Anlage waehlt sie aus; der naechste Klick auf das Feld setzt sie.
 */

import { STRUCTURE_SPECS, type StructureKind } from '../sim/build';
import type { Battle } from '../sim/types';
import { t } from './i18n';

export interface BuildBarHandlers {
  onPick(kind: StructureKind | null): void;
  onStartBattle(): void;
}

export interface BuildBar {
  root: HTMLElement;
  /** Ausgewaehlte Anlage (null = keine). */
  selected(): StructureKind | null;
  update(battle: Battle): void;
  show(): void;
  hide(): void;
  /** Meldung kurz einblenden (z. B. "nicht genug Rohstoffe"). */
  flash(message: string): void;
}

const ORDER: StructureKind[] = ['palisade', 'wall', 'tower', 'breakwater'];

const LABEL_KEYS: Record<StructureKind, string> = {
  palisade: 'buildPalisade',
  wall: 'buildWall',
  tower: 'buildTower',
  breakwater: 'buildBreakwater',
};

/** Kleines Symbol je Anlage, als SVG gezeichnet. */
function icon(kind: StructureKind): string {
  if (kind === 'palisade') {
    return '<svg viewBox="0 0 24 24"><g fill="#c8a06a" stroke="#5a4327" stroke-width="1"><path d="M4 20V8l2-3 2 3v12z"/><path d="M10 20V6l2-3 2 3v14z"/><path d="M16 20V9l2-3 2 3v11z"/></g></svg>';
  }
  if (kind === 'wall') {
    return '<svg viewBox="0 0 24 24"><path d="M2 20V10h3V7h3v3h3V7h3v3h3V7h3v3h2v10z" fill="#9aa3b8" stroke="#4d566b" stroke-width="1"/></svg>';
  }
  if (kind === 'tower') {
    return '<svg viewBox="0 0 24 24"><path d="M8 21V9h8v12z" fill="#c8a06a" stroke="#5a4327" stroke-width="1"/><path d="M6 9l6-5 6 5z" fill="#b04a4a" stroke="#5a2a2a" stroke-width="1"/></svg>';
  }
  return '<svg viewBox="0 0 24 24"><g fill="#9aa3b8" stroke="#4d566b" stroke-width="1"><circle cx="7" cy="16" r="4"/><circle cx="14" cy="17" r="3.4"/><circle cx="18" cy="14" r="2.6"/></g></svg>';
}

export function createBuildBar(handlers: BuildBarHandlers): BuildBar {
  const root = document.createElement('div');
  root.className = 'buildbar';
  root.hidden = true;

  const header = document.createElement('div');
  header.className = 'buildbar-head';

  const title = document.createElement('span');
  title.className = 'buildbar-title';
  title.textContent = t('buildPhase');

  const timer = document.createElement('span');
  timer.className = 'buildbar-timer';

  const resources = document.createElement('span');
  resources.className = 'buildbar-resources';

  const startBtn = document.createElement('button');
  startBtn.type = 'button';
  startBtn.className = 'ui-btn buildbar-start';
  startBtn.textContent = t('startBattle');
  startBtn.addEventListener('click', () => handlers.onStartBattle());

  header.append(title, timer, resources, startBtn);

  const hint = document.createElement('div');
  hint.className = 'buildbar-hint';
  hint.textContent = t('buildPhaseHint');

  const list = document.createElement('div');
  list.className = 'buildbar-list';

  let picked: StructureKind | null = null;
  const buttons = new Map<StructureKind, HTMLButtonElement>();

  for (const kind of ORDER) {
    const spec = STRUCTURE_SPECS[kind];
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'build-btn';
    btn.innerHTML = `
      <span class="build-icon">${icon(kind)}</span>
      <span class="build-name">${t(LABEL_KEYS[kind])}</span>
      <span class="build-cost">${spec.cost}</span>
    `;
    btn.addEventListener('click', () => {
      picked = picked === kind ? null : kind;
      handlers.onPick(picked);
      refreshSelection();
    });
    buttons.set(kind, btn);
    list.append(btn);
  }

  const flashEl = document.createElement('div');
  flashEl.className = 'buildbar-flash';
  flashEl.style.position = 'absolute';
  flashEl.hidden = true;

  root.append(header, hint, list, flashEl);

  function refreshSelection(): void {
    for (const [kind, btn] of buttons) {
      btn.classList.toggle('picked', picked === kind);
    }
    // Der Hinweis steht in der festen Zeile — so waechst die Leiste nicht und
    // verdeckt das Spielfeld nicht, wenn eine Anlage gewaehlt ist.
    hint.textContent = picked === null ? t('buildPhaseHint') : t('placeHint');
  }

  let flashTimer = 0;

  return {
    root,
    selected: () => picked,
    update(battle: Battle) {
      const left = Math.max(0, Math.ceil(battle.buildTimeLeft));
      timer.textContent = `${t('buildTime')}: ${left}s`;
      resources.textContent = `${t('resources')}: ${battle.resources.player}`;
      for (const [kind, btn] of buttons) {
        const cost = STRUCTURE_SPECS[kind].cost;
        const tooPoor = battle.resources.player < cost;
        btn.classList.toggle('unaffordable', tooPoor);
        btn.disabled = battle.phase !== 'build';
      }
      startBtn.disabled = battle.phase !== 'build';
    },
    show() {
      root.hidden = false;
      refreshSelection();
    },
    hide() {
      root.hidden = true;
      picked = null;
      refreshSelection();
    },
    flash(text: string) {
      flashEl.textContent = text;
      flashEl.hidden = false;
      window.clearTimeout(flashTimer);
      flashTimer = window.setTimeout(() => {
        flashEl.hidden = true;
      }, 1800);
    },
  };
}
