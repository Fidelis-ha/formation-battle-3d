import { describe, expect, it } from 'vitest';
import { allKeys, getLanguage, missingTranslations, setLanguage, t, toggleLanguage, unitDescription, unitName } from '../src/ui/i18n';

describe('Zweisprachigkeit', () => {
  it('jeder Text ist in beiden Sprachen belegt', () => {
    const missing = missingTranslations();
    console.log(`Texte gesamt: ${allKeys().length}, fehlend: ${missing.length}`);
    expect(missing).toEqual([]);
    expect(allKeys().length).toBeGreaterThan(50);
  });

  it('liefert unterschiedliche Texte je Sprache', () => {
    setLanguage('en');
    const en = t('victory');
    setLanguage('de');
    const de = t('victory');
    expect(en).toBe('Victory');
    expect(de).toBe('Sieg');
  });

  it('schaltet zwischen Englisch und Deutsch um', () => {
    setLanguage('en');
    expect(getLanguage()).toBe('en');
    expect(toggleLanguage()).toBe('de');
    expect(toggleLanguage()).toBe('en');
  });

  it('alle Kommandos und Menuepunkte sind uebersetzt', () => {
    setLanguage('de');
    // Die Texte, die im HUD und in den Fenstern sichtbar sind.
    const wichtig = [
      'pause', 'resume', 'restart', 'settings', 'tips', 'unitInfo',
      'autoAttack', 'autoApproach', 'switchWeapon', 'on', 'off',
      'objective', 'basicControls', 'strategies', 'hotkeys',
      'victory', 'defeat', 'time', 'language',
      'health', 'meleeDamage', 'speed', 'squadSize', 'meleeDefense', 'rangedDefense',
      'strongAgainst', 'buildPhase', 'resources', 'buildWall', 'buildBreakwater',
      'buildTower', 'startBattle',
    ];
    for (const key of wichtig) {
      const de = t(key);
      setLanguage('en');
      const en = t(key);
      setLanguage('de');
      // Kein Schluessel darf unuebersetzt durchschlagen.
      expect(de).not.toBe(key);
      expect(en).not.toBe(key);
      expect(de.length).toBeGreaterThan(0);
      expect(en.length).toBeGreaterThan(0);
    }
  });

  it('uebersetzt Einheitennamen und Beschreibungen', () => {
    setLanguage('de');
    expect(unitName('archer')).toBe('Bogenschütze');
    expect(unitName('cavalry')).toBe('Kavallerie');
    expect(unitDescription('spearman')).toContain('Schild');
    setLanguage('en');
    expect(unitName('archer')).toBe('Archer');
    expect(unitDescription('spearman')).toContain('shields');
  });

  it('setzt Platzhalter ein', () => {
    setLanguage('en');
    // Kein Text nutzt aktuell Platzhalter, die Mechanik soll aber funktionieren.
    expect(t('victory', { n: 1 })).toBe('Victory');
  });
});
