import { defineConfig } from 'vitest/config';

/**
 * Testkonfiguration.
 *
 * Die schnelle Suite laeuft bei jedem Deploy mit und muss unter einer Minute
 * bleiben — sonst bricht der GitHub-Workflow ab (das ist bereits einmal
 * passiert).
 *
 * Die schweren Schlachtsimulationen in `tests/e2e/` spielen ganze Partien
 * durch: zehn Karten, je 100 Sekunden Schlachtzeit. Das sind zusammen ueber
 * zwei Minuten und gehoert nicht in jeden Deploy. Sie laufen mit
 * `npm run test:full`.
 *
 * Damit die schnelle Suite nicht blind wird, steht in `tests/e2e-smoke.test.ts`
 * ein einzelner Durchlauf, der prueft, dass eine Schlacht ueberhaupt beginnt
 * und entschieden wird.
 */
export default defineConfig({
  test: {
    // Die Simulationstests brauchen mehr als die 5 s Standard.
    testTimeout: 60000,
    // Schwere Partien nur auf Anforderung.
    exclude: ['node_modules/**', 'dist/**', 'tests/e2e/**'],
  },
});
