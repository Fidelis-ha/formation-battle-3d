/**
 * Schlachten auf allen zehn Karten.
 *
 * Der wichtigste Test dieser Datei: kommt es auf jeder Karte ueberhaupt zum
 * Gefecht? Eine Karte mit schoenem Gelaende, auf der sich die Armeen nie
 * treffen, ist keine Karte, sondern eine Wand.
 *
 * Gemessen wird je Karte:
 *  - Kommt es zu Kontakt (erster Zusammenstoss)?
 *  - Endet die Schlacht mit Sieg oder Niederlage statt im Zeitlimit?
 *  - Bewegen sich die Truppen ueberhaupt?
 */

import { describe, expect, it } from 'vitest';
import { MAPS } from '../../src/sim/maps';
import { runMatch } from '../../src/sim/ai/league';
import { personalityById } from '../../src/sim/ai/personality';

describe('Schlachten auf allen Karten', () => {
  for (const map of MAPS) {
    it(`${map.name}: die Armeen treffen aufeinander`, () => {
      // Zwei GLEICHE Spieler: gemessen wird die Karte, nicht der Unterschied
      // zwischen zwei Doktrinen. Mit Taktiker gegen Mauer blieb auf "Die Furt"
      // der Bogenschuetze der Mauer hinten (er ist Verteidiger) und die Partie
      // lief ins Zeitlimit — das sagt nichts ueber das Gelaende.
      const a = personalityById('tactician');
      const b = personalityById('tactician');
      expect(a).not.toBeNull();
      expect(b).not.toBeNull();
      if (!a || !b) return;

      // Auf der Karte der Persoenlichkeit kaempfen: `runMatch` nimmt die Karte
      // aus dem vierten Parameter.
      const result = runMatch(a, b, 7, { mapId: map.id });

      // Kontakt heisst: die ersten Soldaten haben sich getroffen.
      expect(result.contactA, `${map.id}: kein Kontakt`).not.toBeNull();
      // Und die Schlacht muss entschieden werden, nicht im Zeitlimit haengen.
      expect(result.duration, `${map.id}: lief ins Zeitlimit`).not.toBeNull();
      expect(['a', 'b', 'draw']).toContain(result.winner);
    }, 120000);
  }

  it('auf jeder Karte bewegen sich die Truppen vom Start weg', () => {
    // Ein Startpunkt in einer Wand oder im Wasser wuerde dazu fuehren, dass
    // eine Armee feststeckt und die Schlacht nie beginnt.
    for (const map of MAPS) {
      const a = personalityById('recruit');
      const b = personalityById('recruit');
      if (!a || !b) continue;
      const result = runMatch(a, b, 13, { mapId: map.id });
      expect(result.contactA, `${map.id}: keine Bewegung`).not.toBeNull();
    }
  }, 180000);
});
