import type { UnitKind } from '../sim/types';
import { UNIT_STATS } from '../sim/units';

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

// Recon liefert nur den Cavalry-Text wortgleich; die übrigen sind aus SPEC 2 übersetzt.
const DESCRIPTIONS: Record<UnitKind, string> = {
  archer: 'Ranged unit with steady damage that breaks in melee.',
  spearman: 'Defensive unit with large shields that blocks cavalry.',
  infantry: 'Agile unit with balanced stats, strong against Archers.',
  housecarl: 'Heavily armored and slow, holds the line.',
  cavalry:
    'Mobile shock troops capable of swift flanks and devastating charges but vulnerable to spears.',
};

interface StatDef {
  key: 'melee' | 'health' | 'speed' | 'squad' | 'meleeDef' | 'rangedDef';
  label: string;
  suffix: string;
}

const STAT_DEFS: StatDef[] = [
  { key: 'melee', label: 'Melee Damage', suffix: '' },
  { key: 'health', label: 'Health', suffix: '' },
  { key: 'speed', label: 'Speed', suffix: '' },
  { key: 'squad', label: 'Squad Size', suffix: '' },
  { key: 'meleeDef', label: 'Melee Defense', suffix: '%' },
  { key: 'rangedDef', label: 'Ranged Defense', suffix: '%' },
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
  const tipsClose = makeCloseButton('Close Tips');
  const tipsTitle = el('h2', 'tips-title', 'Tips');

  const tipsColumns = el('div', 'tips-columns');
  const leftColumn = el('div', 'tips-col');
  const rightColumn = el('div', 'tips-col');

  const objective = section('Objective');
  objective.append(
    el('p', undefined, 'Defeat all 5 enemy platoons to win the battle.'),
    el('p', undefined, 'You command 5 platoons of your own soldiers.'),
  );

  const basicControls = section('Basic Controls');
  basicControls.append(
    controlRow('Left Click', 'Select a platoon'),
    controlRow('Right Click', 'Move or Attack'),
  );

  const miniMap = section('Mini Map');
  miniMap.append(
    el('p', undefined, 'Left click for quick navigation.'),
    el('p', undefined, 'Right click to move a selected platoon on it.'),
  );

  leftColumn.append(objective, basicControls, miniMap);

  const strategies = section('Strategies');
  strategies.append(
    el('p', undefined, 'Choosing the right platoon to counter the enemy is crucial:'),
  );
  const strategyList = el('ul', 'tips-list');
  for (const line of [
    '- Use defensive units to shield weaker units',
    '- Protect Archers by keeping them behind.',
    '- Use Cavalry to flank enemies',
    '- Good positioning can turn the tide of battle',
    '- Each unit type has unique strengths and weaknesses.',
  ]) {
    strategyList.append(el('li', undefined, line));
  }
  strategies.append(strategyList);
  strategies.append(el('p', undefined, 'Check the Unit Info Page for details:'));

  const unitInfoButton = el('button', 'ui-btn', 'Unit Info');
  unitInfoButton.type = 'button';
  unitInfoButton.addEventListener('click', () => showUnitInfo());

  const tipsAction = el('div', 'tips-action');
  tipsAction.append(unitInfoButton);
  strategies.append(tipsAction);

  const hotkeys = section('Hotkeys');
  hotkeys.append(
    hotkeyRow('Select Squads', '1 \u2026 5'),
    hotkeyRow('Auto Attack', 'Q'),
    hotkeyRow('Switch Weapon', 'E'),
    hotkeyRow('Move Camera', 'W A S D'),
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
  const unitClose = makeCloseButton('Close Unit Info');
  const unitKicker = el('p', 'unit-kicker', 'Unit Info');
  const unitTitle = el('h2', 'unit-title', 'Archer');

  const unitArrowLeft = el('button', 'unit-arrow unit-arrow--left', '\u2039');
  unitArrowLeft.type = 'button';
  unitArrowLeft.setAttribute('aria-label', 'Previous unit');

  const unitArrowRight = el('button', 'unit-arrow unit-arrow--right', '\u203A');
  unitArrowRight.type = 'button';
  unitArrowRight.setAttribute('aria-label', 'Next unit');

  const unitBody = el('div', 'unit-body');
  const unitLeft = el('div', 'unit-left');
  const unitPortrait = el('div', 'unit-portrait', 'ARC');
  const unitDesc = el('p', 'unit-desc');
  const unitStrong = el('div', 'unit-strong');
  const unitStrongList = el('div', 'unit-strong-list');
  unitStrong.append(el('h3', undefined, 'Strong Against'), unitStrongList);
  unitLeft.append(unitPortrait, unitDesc, unitStrong);

  const unitStats = el('div', 'unit-stats');
  const statValues: HTMLElement[] = [];
  for (const def of STAT_DEFS) {
    const row = el('div', 'stat-row');
    const value = el('span', 'stat-value');
    row.append(
      el('span', 'stat-icon'),
      el('span', 'stat-label', def.label),
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
  const pauseTitle = el('h2', 'pause-title', 'Pause');

  const restartButton = el('button', 'ui-btn', 'Restart');
  restartButton.type = 'button';
  restartButton.addEventListener('click', () => {
    hideAll();
    handlers.onRestart();
  });

  const settingsButton = el('button', 'ui-btn', 'Settings');
  settingsButton.type = 'button';
  settingsButton.disabled = true;
  settingsButton.title = 'not available in this build';

  const settingsNote = el('p', 'settings-note', 'not available in this build');

  const tipsButton = el('button', 'ui-btn', 'Tips');
  tipsButton.type = 'button';
  tipsButton.addEventListener('click', () => showBriefing());

  const pauseUnitInfoButton = el('button', 'ui-btn', 'Unit Info');
  pauseUnitInfoButton.type = 'button';
  pauseUnitInfoButton.addEventListener('click', () => showUnitInfo());

  const resumeButton = el('button', 'ui-btn', 'Resume');
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
  const resultTitle = el('h2', 'result-title', 'Victory');
  const resultTime = el('p', 'result-time', 'Time: 00:00');
  const resultRestart = el('button', 'ui-btn', 'Restart');
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

    unitTitle.textContent = stats.name;
    unitPortrait.textContent = ABBREV[kind];
    unitDesc.textContent = DESCRIPTIONS[kind];
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
        chip.title = UNIT_STATS[strongKind].name;
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
    resultTitle.textContent = status === 'victory' ? 'Victory' : 'Defeat';
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
