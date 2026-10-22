/**
 * Gegnerauswahl und Kampagne.
 *
 * Zeigt die zehn KI-Spieler mit Name, Stufe und Eigenart. Ein Klick waehlt den
 * Gegner fuer die naechste Schlacht. Der Kampagnen-Modus reiht sie in
 * aufsteigender Staerke auf und merkt sich den Fortschritt.
 *
 * Der Fortschritt liegt in `localStorage`, damit er einen Neustart uebersteht.
 */

import { PERSONALITIES, type Personality } from '../sim/ai/personality';
import { t, getLanguage } from './i18n';

const STORAGE_KEY = 'fb.campaign';

export interface CampaignProgress {
  /** Index des aktuellen Gegners in der nach Stufe sortierten Liste. */
  index: number;
  /** Wie viele Gegner bereits besiegt wurden. */
  beaten: number;
}

export interface SelectorHandlers {
  /** Ein einzelner Gegner wurde gewaehlt (freies Spiel). */
  onPick(personality: Personality): void;
  /** Kampagne starten oder fortsetzen. */
  onCampaign(personality: Personality, progress: CampaignProgress): void;
}

export interface Selector {
  root: HTMLElement;
  show(): void;
  hide(): void;
  /** Nach einem Sieg den Kampagnen-Fortschritt weiterschalten. */
  advanceCampaign(): void;
  /** Aktueller Stand (fuer Anzeige und Speichern). */
  progress(): CampaignProgress;
}

/** Nach Stufe sortierte Liste. */
function sortedList(): Personality[] {
  return [...PERSONALITIES].sort((a, b) => a.level - b.level);
}

function loadProgress(): CampaignProgress {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<CampaignProgress>;
      const index = Number(parsed.index);
      const beaten = Number(parsed.beaten);
      if (Number.isFinite(index) && Number.isFinite(beaten)) {
        const max = PERSONALITIES.length - 1;
        return {
          index: Math.max(0, Math.min(max, Math.floor(index))),
          beaten: Math.max(0, Math.min(PERSONALITIES.length, Math.floor(beaten))),
        };
      }
    }
  } catch {
    // Kaputter Speicherstand ist kein Grund, das Spiel nicht zu starten.
  }
  return { index: 0, beaten: 0 };
}

function saveProgress(progress: CampaignProgress): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
  } catch {
    // Ohne Speicher laeuft das Spiel weiter, nur ohne Fortschritt.
  }
}

export function createSelector(handlers: SelectorHandlers): Selector {
  let progress = loadProgress();

  const root = document.createElement('div');
  root.className = 'overlay overlay--selector';
  root.hidden = true;

  const panel = document.createElement('div');
  panel.className = 'selector-panel';

  const title = document.createElement('h2');
  title.className = 'selector-title';
  title.textContent = t('chooseOpponent');

  const subtitle = document.createElement('p');
  subtitle.className = 'selector-subtitle';
  subtitle.textContent = t('chooseOpponentHint');

  const campaignBox = document.createElement('div');
  campaignBox.className = 'selector-campaign';

  const campaignText = document.createElement('span');
  campaignText.className = 'selector-campaign-text';

  const campaignButton = document.createElement('button');
  campaignButton.type = 'button';
  campaignButton.className = 'ui-btn selector-campaign-btn';

  const campaignReset = document.createElement('button');
  campaignReset.type = 'button';
  campaignReset.className = 'ui-btn selector-reset';
  campaignReset.textContent = t('campaignReset');
  campaignReset.addEventListener('click', () => {
    progress = { index: 0, beaten: 0 };
    saveProgress(progress);
    refreshCampaign();
  });

  campaignBox.append(campaignText, campaignButton, campaignReset);

  const list = document.createElement('div');
  list.className = 'selector-list';

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'ui-btn selector-close';
  close.textContent = t('close');
  close.addEventListener('click', () => {
    root.hidden = true;
  });

  panel.append(title, subtitle, campaignBox, list, close);
  root.append(panel);

  /** Den Kampagnen-Kasten neu beschriften. */
  function refreshCampaign(): void {
    const list10 = sortedList();
    const next = list10[progress.index];
    campaignText.textContent = `${t('campaignProgress')}: ${progress.beaten} / ${list10.length} — ${next ? nameOf(next) : ''}`;
    campaignButton.textContent =
      progress.beaten > 0 ? t('campaignContinue') : t('campaignStart');
    campaignButton.disabled = next === undefined;
    campaignButton.onclick = () => {
      if (!next) return;
      handlers.onCampaign(next, progress);
      root.hidden = true;
    };
  }

  /** Name je Sprache. */
  function nameOf(p: Personality): string {
    return getLanguage() === 'de' ? p.name : englishName(p.id);
  }

  /** Die englischen Namen stehen hier, damit die Daten einsprachig bleiben. */
  function englishName(id: string): string {
    const map: Record<string, string> = {
      recruit: 'The Recruit',
      wall: 'The Wall',
      spearmaster: 'The Spearmaster',
      rider: 'The Rider',
      tactician: 'The Tactician',
      pincer: 'The Pincer',
      delayer: 'The Delayer',
      hammer: 'The Hammer',
      spider: 'The Spider',
      commander: 'The Commander',
    };
    return map[id] ?? id;
  }

  /** Die Liste der zehn Gegner aufbauen. */
  function buildList(): void {
    list.innerHTML = '';
    for (const p of sortedList()) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'selector-card';

      const level = document.createElement('span');
      level.className = 'selector-level';
      level.textContent = String(p.level);

      const body = document.createElement('span');
      body.className = 'selector-body';

      const name = document.createElement('span');
      name.className = 'selector-name';
      name.textContent = nameOf(p);

      const trait = document.createElement('span');
      trait.className = 'selector-trait';
      trait.textContent = getLanguage() === 'de' ? p.trait : englishTrait(p.id);

      body.append(name, trait);
      card.append(level, body);

      // Der naechste Kampagnen-Gegner ist hervorgehoben.
      if (p.level === sortedList()[progress.index]?.level) {
        card.classList.add('selector-card--next');
      }

      card.addEventListener('click', () => {
        handlers.onPick(p);
        root.hidden = true;
      });

      list.append(card);
    }
  }

  /** Englische Eigenarten (die Daten selbst bleiben deutsch). */
  function englishTrait(id: string): string {
    const map: Record<string, string> = {
      recruit: 'Throws everything forward at once, ignoring counters.',
      wall: 'Stands still and lets them come. Charging breaks against it.',
      spearmaster: 'Spears against cavalry — everything else is secondary.',
      rider: 'Cavalry first, always hunting the archers.',
      tactician: 'Picks the counter and strikes in one mass.',
      pincer: 'Splits the army and attacks from two sides.',
      delayer: 'Waits long — then strikes as one fist.',
      hammer: 'Everything on one platoon, then the next. No splitting.',
      spider: 'Keeps its distance and lures into its own line.',
      commander: 'Adapts: uses ground, counters and reserves at once.',
    };
    return map[id] ?? id;
  }

  return {
    root,
    show() {
      buildList();
      refreshCampaign();
      root.hidden = false;
    },
    hide() {
      root.hidden = true;
    },
    advanceCampaign() {
      const max = PERSONALITIES.length - 1;
      progress = {
        index: Math.min(max, progress.index + 1),
        beaten: Math.min(PERSONALITIES.length, progress.beaten + 1),
      };
      saveProgress(progress);
      refreshCampaign();
    },
    progress: () => progress,
  };
}
