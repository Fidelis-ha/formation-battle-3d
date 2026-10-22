import type { UnitKind } from '../sim/types';
import { UNIT_STATS } from '../sim/units';
import { t, getLanguage, setLanguage, unitDescription, unitName, type Lang } from './i18n';

export interface OverlayHandlers {
  onClose(): void;
  onRestart(): void;
  onResume(): void;
}

export interface Overlays {
  root: HTMLElement;
  showBriefing(): void;
  showUnitInfo(): void;
  showPause(): void;
  showResult(status: 'victory' | 'defeat', seconds: number): void;
  hideAll(): void;
  isBlocking(): boolean;
}

const UNIT_ORDER: UnitKind[] = ['archer', 'spearman', 'infantry', 'housecarl', 'cavalry'];

const ABBREV: Record<UnitKind, string> = {
  archer: 'ARC',
  spearman: 'SPR',
  infantry: 'INF',
  housecarl: 'HOU',
  cavalry: 'CAV',
};

// Die Texte stehen in `i18n.ts` (beide Sprachen). Hier nur der Zugriff.
function descriptionOf(kind: UnitKind): string {
  return unitDescription(kind);
}

interface StatDef {
  key: 'melee' | 'health' | 'speed' | 'squad' | 'meleeDef' | 'rangedDef';
  /** i18n-Schluessel des Labels. */
  labelKey: string;
  suffix: string;
}

// Beschriftung erst beim Zeichnen uebersetzen — so wirkt ein Sprachwechsel
// sofort, ohne dass die Tabelle neu gebaut werden muss.
const STAT_DEFS: StatDef[] = [
  { key: 'melee', labelKey: 'meleeDamage', suffix: '' },
  { key: 'health', labelKey: 'health', suffix: '' },
  { key: 'speed', labelKey: 'speed', suffix: '' },
  { key: 'squad', labelKey: 'squadSize', suffix: '' },
  { key: 'meleeDef', labelKey: 'meleeDefense', suffix: '%' },
  { key: 'rangedDef', labelKey: 'rangedDefense', suffix: '%' },
];

type ReturnTarget = 'briefing' | 'pause' | null;

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

function formatTime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return `${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}

function makeCloseButton(label: string): HTMLButtonElement {
  const button = el('button', 'overlay-close', '\u00D7');
  button.type = 'button';
  button.setAttribute('aria-label', label);
  return button;
}

function section(title: string): HTMLElement {
  const wrap = el('div', 'tips-section');
  wrap.append(el('h3', undefined, title));
  return wrap;
}

function controlRow(label: string, value: string): HTMLElement {
  const row = el('div', 'control-row');
  row.append(el('span', 'control-label', label), el('span', 'control-value', value));
  return row;
}

function hotkeyRow(label: string, value: string): HTMLElement {
  const row = el('div', 'hotkey-row');
  row.append(el('span', 'hotkey-label', label), el('span', 'hotkey-value', value));
  return row;
}

export function createOverlays(handlers: OverlayHandlers): Overlays {
  const root = el('div', 'overlays-root');

  let unitIndex = 0;
  let unitReturn: ReturnTarget = null;

  // ---------------------------------------------------------------- Briefing
  const briefing = el('div', 'overlay overlay--briefing');
  briefing.hidden = true;

  const tipsPanel = el('div', 'panel tips-panel');
  const tipsClose = makeCloseButton(t('closeTips'));
  const tipsTitle = el('h2', 'tips-title', t('tips'));

  const tipsColumns = el('div', 'tips-columns');
  const leftColumn = el('div', 'tips-col');
  const rightColumn = el('div', 'tips-col');

  const objective = section(t('objective'));
  objective.append(
    el('p', undefined, t('objectiveText')),
    el('p', undefined, t('objectiveText2')),
  );

  const basicControls = section(t('basicControls'));
  basicControls.append(
    controlRow(t('leftClick'), t('selectPlatoon')),
    controlRow(t('rightClick'), t('moveOrAttack')),
  );

  const miniMap = section(t('miniMap'));
  miniMap.append(
    el('p', undefined, t('miniMapNav')),
    el('p', undefined, t('miniMapMove')),
  );

  leftColumn.append(objective, basicControls, miniMap);

  const strategies = section(t('strategies'));
  strategies.append(
    el('p', undefined, t('strategiesIntro')),
  );
  const strategyList = el('ul', 'tips-list');
  for (const line of [
    `- ${t('strategy1')}`,
    `- ${t('strategy2')}`,
    `- ${t('strategy3')}`,
    `- ${t('strategy4')}`,
    `- ${t('strategy5')}`,
  ]) {
    strategyList.append(el('li', undefined, line));
  }
  strategies.append(strategyList);
  strategies.append(el('p', undefined, t('unitInfoHint')));

  const unitInfoButton = el('button', 'ui-btn', t('unitInfo'));
  unitInfoButton.type = 'button';
  unitInfoButton.addEventListener('click', () => showUnitInfo());

  const tipsAction = el('div', 'tips-action');
  tipsAction.append(unitInfoButton);
  strategies.append(tipsAction);

  const hotkeys = section(t('hotkeys'));
  hotkeys.append(
    hotkeyRow(t('selectSquads'), '1 \u2026 5'),
    hotkeyRow(t('autoAttack'), 'Q'),
    hotkeyRow(t('switchWeapon'), 'E'),
    hotkeyRow(t('moveCamera'), 'W A S D'),
  );

  rightColumn.append(strategies, hotkeys);

  tipsColumns.append(leftColumn, rightColumn);
  tipsPanel.append(tipsClose, tipsTitle, tipsColumns);
  briefing.append(tipsPanel);
  root.append(briefing);

  tipsClose.addEventListener('click', () => closeBriefing());
  briefing.addEventListener('click', (event) => {
    if (event.target === briefing) closeBriefing();
  });

  // --------------------------------------------------------------- Unit Info
  const unitInfo = el('div', 'overlay overlay--unitinfo');
  unitInfo.hidden = true;

  const unitPanel = el('div', 'panel unit-panel');
  const unitClose = makeCloseButton(t('closeUnitInfo'));
  const unitKicker = el('p', 'unit-kicker', t('unitInfo'));
  const unitTitle = el('h2', 'unit-title', unitName('archer'));

  const unitArrowLeft = el('button', 'unit-arrow unit-arrow--left', '\u2039');
  unitArrowLeft.type = 'button';
  unitArrowLeft.setAttribute('aria-label', t('prevUnit'));

  const unitArrowRight = el('button', 'unit-arrow unit-arrow--right', '\u203A');
  unitArrowRight.type = 'button';
  unitArrowRight.setAttribute('aria-label', t('nextUnit'));

  const unitBody = el('div', 'unit-body');
  const unitLeft = el('div', 'unit-left');
  const unitPortrait = el('div', 'unit-portrait', 'ARC');
  const unitDesc = el('p', 'unit-desc');
  const unitStrong = el('div', 'unit-strong');
  const unitStrongList = el('div', 'unit-strong-list');
  unitStrong.append(el('h3', undefined, t('strongAgainst')), unitStrongList);
  unitLeft.append(unitPortrait, unitDesc, unitStrong);

  const unitStats = el('div', 'unit-stats');
  const statValues: HTMLElement[] = [];
  for (const def of STAT_DEFS) {
    const row = el('div', 'stat-row');
    const value = el('span', 'stat-value');
    row.append(
      el('span', 'stat-icon'),
      el('span', 'stat-label', t(def.labelKey)),
      value,
    );
    unitStats.append(row);
    statValues.push(value);
  }

  unitBody.append(unitLeft, unitStats);

  const unitPager = el('div', 'unit-pager', `1 / ${UNIT_ORDER.length}`);

  unitPanel.append(
    unitClose,
    unitArrowLeft,
    unitArrowRight,
    unitKicker,
    unitTitle,
    unitBody,
    unitPager,
  );
  unitInfo.append(unitPanel);
  root.append(unitInfo);

  unitClose.addEventListener('click', () => closeUnitInfo());
  unitInfo.addEventListener('click', (event) => {
    if (event.target === unitInfo) closeUnitInfo();
  });
  unitArrowLeft.addEventListener('click', () => changeUnit(-1));
  unitArrowRight.addEventListener('click', () => changeUnit(1));

  // ------------------------------------------------------------------- Pause
  const pauseOverlay = el('div', 'overlay overlay--pause');
  pauseOverlay.hidden = true;

  const pausePanel = el('div', 'panel pause-panel');
  const pauseTitle = el('h2', 'pause-title', t('pause'));

  const restartButton = el('button', 'ui-btn', t('restart'));
  restartButton.type = 'button';
  restartButton.addEventListener('click', () => {
    hideAll();
    handlers.onRestart();
  });

  const settingsButton = el('button', 'ui-btn', t('settings'));
  settingsButton.type = 'button';
  settingsButton.disabled = true;
  settingsButton.title = 'not available in this build';

  const settingsNote = el('p', 'settings-note', 'not available in this build');

  const tipsButton = el('button', 'ui-btn', t('tips'));
  tipsButton.type = 'button';
  tipsButton.addEventListener('click', () => showBriefing());

  const pauseUnitInfoButton = el('button', 'ui-btn', t('unitInfo'));
  pauseUnitInfoButton.type = 'button';
  pauseUnitInfoButton.addEventListener('click', () => showUnitInfo());

  const resumeButton = el('button', 'ui-btn', t('resume'));
  resumeButton.type = 'button';
  resumeButton.addEventListener('click', () => {
    hideAll();
    handlers.onResume();
  });

  pausePanel.append(
    pauseTitle,
    restartButton,
    settingsButton,
    settingsNote,
    tipsButton,
    pauseUnitInfoButton,
    resumeButton,
  );
  pauseOverlay.append(pausePanel);
  root.append(pauseOverlay);

  // ---------------------------------------------------------------- Ergebnis
  const resultOverlay = el('div', 'overlay overlay--result');
  resultOverlay.hidden = true;

  const resultPanel = el('div', 'panel result-panel');
  const resultTitle = el('h2', 'result-title', t('victory'));
  const resultTime = el('p', 'result-time', `${t('time')}: 00:00`);
  const resultRestart = el('button', 'ui-btn', t('restart'));
  resultRestart.type = 'button';
  resultRestart.addEventListener('click', () => {
    hideAll();
    handlers.onRestart();
  });

  resultPanel.append(resultTitle, resultTime, resultRestart);
  resultOverlay.append(resultPanel);
  root.append(resultOverlay);

  // ---------------------------------------------------------------- Funktionen
  function renderUnit(): void {
    const kind = UNIT_ORDER[unitIndex];
    const stats = UNIT_STATS[kind];

    unitTitle.textContent = unitName(kind);
    unitPortrait.textContent = ABBREV[kind];
    unitDesc.textContent = descriptionOf(kind);
    unitPager.textContent = `${unitIndex + 1} / ${UNIT_ORDER.length}`;

    statValues.forEach((value, index) => {
      const def = STAT_DEFS[index];
      value.textContent = `${stats[def.key]}${def.suffix}`;
    });

    while (unitStrongList.firstChild !== null) {
      unitStrongList.removeChild(unitStrongList.firstChild);
    }

    if (stats.strongAgainst.length === 0) {
      unitStrongList.append(el('span', 'unit-strong-empty', '\u2014'));
    } else {
      for (const strongKind of stats.strongAgainst) {
        const chip = el('span', 'strong-chip', ABBREV[strongKind]);
        chip.title = unitName(strongKind);
        unitStrongList.append(chip);
      }
    }
  }

  function changeUnit(delta: number): void {
    unitIndex = (unitIndex + delta + UNIT_ORDER.length) % UNIT_ORDER.length;
    renderUnit();
  }

  function closeBriefing(): void {
    hideAll();
    handlers.onClose();
  }

  function closeUnitInfo(): void {
    const target = unitReturn;
    unitReturn = null;
    unitInfo.hidden = true;

    if (target === 'briefing') {
      briefing.hidden = false;
    } else if (target === 'pause') {
      pauseOverlay.hidden = false;
    } else {
      hideAll();
      handlers.onClose();
    }
  }

  function showBriefing(): void {
    unitInfo.hidden = true;
    pauseOverlay.hidden = true;
    resultOverlay.hidden = true;
    briefing.hidden = false;
    unitReturn = null;
  }

  function showUnitInfo(): void {
    if (!briefing.hidden) {
      unitReturn = 'briefing';
    } else if (!pauseOverlay.hidden) {
      unitReturn = 'pause';
    } else {
      unitReturn = null;
    }

    briefing.hidden = true;
    pauseOverlay.hidden = true;
    resultOverlay.hidden = true;
    unitInfo.hidden = false;
    renderUnit();
  }

  function showPause(): void {
    briefing.hidden = true;
    unitInfo.hidden = true;
    resultOverlay.hidden = true;
    pauseOverlay.hidden = false;
    unitReturn = null;
  }

  function showResult(status: 'victory' | 'defeat', seconds: number): void {
    briefing.hidden = true;
    unitInfo.hidden = true;
    pauseOverlay.hidden = true;
    unitReturn = null;

    resultPanel.classList.toggle('result-panel--victory', status === 'victory');
    resultPanel.classList.toggle('result-panel--defeat', status === 'defeat');
    resultTitle.textContent = status === 'victory' ? t('victory') : t('defeat');
    resultTime.textContent = `Time: ${formatTime(seconds)}`;
    resultOverlay.hidden = false;
  }

  function hideAll(): void {
    briefing.hidden = true;
    unitInfo.hidden = true;
    pauseOverlay.hidden = true;
    resultOverlay.hidden = true;
    unitReturn = null;
  }

  function isBlocking(): boolean {
    return (
      !briefing.hidden ||
      !unitInfo.hidden ||
      !pauseOverlay.hidden ||
      !resultOverlay.hidden
    );
  }

  renderUnit();

  return {
    root,
    showBriefing,
    showUnitInfo,
    showPause,
    showResult,
    hideAll,
    isBlocking,
  };
}
