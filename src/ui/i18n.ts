/**
 * Zweisprachigkeit: Deutsch und Englisch.
 *
 * Alle sichtbaren Texte stehen hier zentral. Die UI greift nur noch ueber
 * `t('schluessel')` zu — kein Text ist in den UI-Dateien fest verdrahtet.
 *
 * Die Sprache wird in `localStorage` gemerkt und kann im Spiel umgeschaltet
 * werden (Knopf im HUD).
 */

export type Lang = 'en' | 'de';

const STORAGE_KEY = 'fb.lang';

type Dict = Record<string, { en: string; de: string }>;

const TEXTS: Dict = {
  'game.title': { en: 'Formation Battle - v0.1.5', de: 'Formation Battle - v0.1.5' },
  pause: { en: 'Pause', de: 'Pause' },
  resume: { en: 'Resume', de: 'Weiter' },
  restart: { en: 'Restart', de: 'Neustart' },
  settings: { en: 'Settings', de: 'Einstellungen' },
  tips: { en: 'Tips', de: 'Tipps' },
  unitInfo: { en: 'Unit Info', de: 'Einheiten-Info' },
  close: { en: 'Close', de: 'Schliessen' },
  closeTips: { en: 'Close Tips', de: 'Tipps schliessen' },
  closeUnitInfo: { en: 'Close Unit Info', de: 'Einheiten-Info schliessen' },
  victory: { en: 'Victory', de: 'Sieg' },
  defeat: { en: 'Defeat', de: 'Niederlage' },
  time: { en: 'Time', de: 'Zeit' },
  language: { en: 'Language', de: 'Sprache' },

  autoAttack: { en: 'Auto Attack', de: 'Auto-Angriff' },
  autoApproach: { en: 'Auto Approach', de: 'Auto-Vorrücken' },
  switchWeapon: { en: 'Switch Weapon', de: 'Waffe wechseln' },
  on: { en: 'ON', de: 'AN' },
  off: { en: 'OFF', de: 'AUS' },
  bow: { en: 'Bow', de: 'Bogen' },
  spear: { en: 'Spear', de: 'Speer' },
  sword: { en: 'Sword', de: 'Schwert' },
  dagger: { en: 'Dagger', de: 'Dolch' },

  objective: { en: 'Objective', de: 'Ziel' },
  objectiveText: {
    en: 'Defeat all 5 enemy platoons to win the battle.',
    de: 'Besiege alle 5 gegnerischen Trupps, um die Schlacht zu gewinnen.',
  },
  objectiveText2: {
    en: 'You command 5 platoons of your own soldiers.',
    de: 'Du befehligst 5 eigene Trupps.',
  },
  basicControls: { en: 'Basic Controls', de: 'Steuerung' },
  leftClick: { en: 'Left Click', de: 'Linksklick' },
  rightClick: { en: 'Right Click', de: 'Rechtsklick' },
  selectPlatoon: { en: 'Select a platoon', de: 'Trupp auswählen' },
  moveOrAttack: { en: 'Move or Attack', de: 'Bewegen oder angreifen' },
  miniMap: { en: 'Mini Map', de: 'Minikarte' },
  miniMapNav: { en: 'Left click for quick navigation.', de: 'Linksklick für schnelle Navigation.' },
  miniMapMove: {
    en: 'Right click to move a selected platoon on it.',
    de: 'Rechtsklick bewegt den gewählten Trupp dorthin.',
  },
  strategies: { en: 'Strategies', de: 'Taktik' },
  strategiesIntro: {
    en: 'Choosing the right platoon to counter the enemy is crucial:',
    de: 'Den richtigen Trupp gegen den Feind zu wählen, entscheidet:',
  },
  strategy1: {
    en: 'Use defensive units to shield weaker units',
    de: 'Defensive Einheiten nach vorn, um schwächere zu schützen',
  },
  strategy2: {
    en: 'Protect Archers by keeping them behind.',
    de: 'Schütze die Bogenschützen, indem sie hinten bleiben.',
  },
  strategy3: { en: 'Use Cavalry to flank enemies', de: 'Nutze die Kavallerie für die Flanke' },
  strategy4: {
    en: 'Good positioning can turn the tide of battle',
    de: 'Gute Stellung kann die Schlacht drehen',
  },
  strategy5: {
    en: 'Each unit type has unique strengths and weaknesses.',
    de: 'Jeder Einheitentyp hat eigene Stärken und Schwächen.',
  },
  unitInfoHint: { en: 'Check the Unit Info Page for details:', de: 'Details auf der Einheiten-Seite:' },
  hotkeys: { en: 'Hotkeys', de: 'Tasten' },
  selectSquads: { en: 'Select Squads', de: 'Trupp wählen' },
  prevUnit: { en: 'Previous unit', de: 'Vorherige Einheit' },
  nextUnit: { en: 'Next unit', de: 'Nächste Einheit' },
  moveCamera: { en: 'Move Camera', de: 'Kamera' },

  health: { en: 'Health', de: 'Lebenspunkte' },
  meleeDamage: { en: 'Melee Damage', de: 'Nahkampfschaden' },
  rangedDamage: { en: 'Ranged Damage', de: 'Fernkampfschaden' },
  meleeDefense: { en: 'Melee Defense', de: 'Nahkampfabwehr' },
  rangedDefense: { en: 'Ranged Defense', de: 'Fernkampfabwehr' },
  speed: { en: 'Speed', de: 'Tempo' },
  squadSize: { en: 'Squad Size', de: 'Truppstärke' },
  strongAgainst: { en: 'Strong Against', de: 'Stark gegen' },

  'unit.archer': { en: 'Archer', de: 'Bogenschütze' },
  'unit.spearman': { en: 'Spearman', de: 'Speerkämpfer' },
  'unit.infantry': { en: 'Infantry', de: 'Infanterie' },
  'unit.housecarl': { en: 'Housecarl', de: 'Hauskarl' },
  'unit.cavalry': { en: 'Cavalry', de: 'Kavallerie' },

  'desc.archer': {
    en: 'Ranged unit with steady damage that breaks in melee.',
    de: 'Fernkämpfer mit stetigem Schaden, bricht im Nahkampf ein.',
  },
  'desc.spearman': {
    en: 'Defensive unit with large shields that blocks cavalry.',
    de: 'Defensive Einheit mit grossem Schild, stoppt Kavallerie.',
  },
  'desc.infantry': {
    en: 'Agile unit with balanced stats, strong against Archers.',
    de: 'Bewegliche Einheit mit ausgewogenen Werten, stark gegen Bogenschützen.',
  },
  'desc.housecarl': {
    en: 'Heavily armored and slow, holds the line.',
    de: 'Schwer gepanzert und langsam, hält die Linie.',
  },
  'desc.cavalry': {
    en: 'Mobile shock troops capable of swift flanks and devastating charges but vulnerable to spears.',
    de: 'Schnelle Stosstruppen für Flanken und harte Stösse, anfällig gegen Speere.',
  },

  buildPhase: { en: 'Build Phase', de: 'Bauphase' },
  buildPhaseHint: {
    en: 'Spend your resources before the battle starts.',
    de: 'Setze deine Rohstoffe ein, bevor die Schlacht beginnt.',
  },
  resources: { en: 'Resources', de: 'Rohstoffe' },
  buildWall: { en: 'Wall', de: 'Mauer' },
  buildBreakwater: { en: 'Breakwater', de: 'Wellenbrecher' },
  buildTower: { en: 'Watchtower', de: 'Wachturm' },
  buildPalisade: { en: 'Palisade', de: 'Palisade' },
  startBattle: { en: 'Start Battle', de: 'Schlacht beginnen' },
  notEnoughResources: { en: 'Not enough resources', de: 'Nicht genug Rohstoffe' },
  placeHint: {
    en: 'Click on the field to place. Right click to cancel.',
    de: 'Auf das Feld klicken zum Setzen. Rechtsklick bricht ab.',
  },
  tooSteep: { en: 'Cannot build here', de: 'Hier kann nicht gebaut werden' },
  buildTime: { en: 'Time left', de: 'Restzeit' },

  'msg.wallBlocks': { en: 'The wall blocks the way', de: 'Die Mauer versperrt den Weg' },

  // Gruende, warum an einer Stelle nicht gebaut werden kann.
  buildNeedsWater: { en: 'Only buildable in the river', de: 'Nur im Fluss baubar' },
  buildNoWater: { en: 'Not buildable in water', de: 'Nicht im Wasser baubar' },
  buildTooClose: { en: 'Too close to another structure', de: 'Zu nah an einer anderen Anlage' },
  buildInFormation: { en: 'Too close to your own troops', de: 'Zu nah an den eigenen Truppen' },
  buildOnlyInPhase: { en: 'Building is over', de: 'Die Bauphase ist vorbei' },
  // Gegnerauswahl und Kampagne (#16)
  chooseOpponent: { en: 'Choose your opponent', de: 'Gegner waehlen' },
  chooseMap: { en: 'Map', de: 'Karte' },
  chooseOpponentHint: {
    en: 'Ten commanders, each with their own habit. Pick one for a single battle, or run the campaign.',
    de: 'Zehn Befehlshaber, jeder mit eigener Eigenart. Einen fuer eine einzelne Schlacht waehlen, oder die Kampagne spielen.',
  },
  campaignProgress: { en: 'Campaign', de: 'Kampagne' },
  campaignStart: { en: 'Start campaign', de: 'Kampagne starten' },
  campaignContinue: { en: 'Continue campaign', de: 'Kampagne fortsetzen' },
  campaignReset: { en: 'Reset', de: 'Zuruecksetzen' },
  opponent: { en: 'Opponent', de: 'Gegner' },

};

let current: Lang = 'en';

export function initLanguage(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'de' || saved === 'en') current = saved;
  } catch {
    // localStorage kann gesperrt sein (Privatmodus) — dann bleibt Englisch.
  }
  return current;
}

export function getLanguage(): Lang {
  return current;
}

export function setLanguage(lang: Lang): void {
  current = lang;
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    // kein Speicher verfuegbar: Sprache gilt nur fuer diese Sitzung
  }
}

export function toggleLanguage(): Lang {
  setLanguage(current === 'en' ? 'de' : 'en');
  return current;
}

/**
 * Text holen. Fehlt ein Schluessel, wird der Schluessel selbst zurueckgegeben —
 * so faellt ein vergessener Text sofort auf, statt leer zu bleiben.
 */
export function t(key: string, vars?: Record<string, string | number>): string {
  const entry = TEXTS[key];
  let text = entry ? entry[current] : key;
  if (vars) {
    for (const [name, value] of Object.entries(vars)) {
      text = text.replace(`{${name}}`, String(value));
    }
  }
  return text;
}

export function allKeys(): string[] {
  return Object.keys(TEXTS);
}

/** Pruefen, ob ein Schluessel in beiden Sprachen belegt ist. */
export function missingTranslations(): string[] {
  const missing: string[] = [];
  for (const [key, value] of Object.entries(TEXTS)) {
    if (!value.en || !value.de) missing.push(key);
  }
  return missing;
}

export function unitName(kind: string): string {
  return t(`unit.${kind}`);
}

export function unitDescription(kind: string): string {
  return t(`desc.${kind}`);
}
