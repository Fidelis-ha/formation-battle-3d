/**
 * Wegfindung fuer Truppen.
 *
 * Warum es das braucht: Die Truppen liefen bisher geradeaus auf ihr Ziel zu und
 * wichen nur seitlich aus, wenn etwas im Weg stand. Auf einer Karte mit Fluss
 * oder See reicht das nicht — gemessen blieben drei von zehn Karten im
 * Zeitlimit haengen, weil die Armeen gegen das Wasser liefen und den Uebergang
 * nie fanden ("Die Furt", "Die Insel", "Die Hochebene").
 *
 * Loesung: ein Distanzfeld. Vom Ziel aus wird ueber begehbaren Boden eine
 * Breitensuche gerechnet; jede Zelle kennt danach ihren Abstand zum Ziel. Eine
 * Truppe laeuft einfach die Abstandsberge hinunter — das ergibt von selbst den
 * Weg um Seen, durch Furten und durch Engstellen.
 *
 * Das Feld haengt nur vom Gelaende ab, nicht von Einheiten. Es wird einmal je
 * Schlacht gerechnet und fuer beide Seiten geteilt.
 */

import { FIELD_HALF, isPassable, isWater } from '../terrain';
import { BREAKWATER_WALK_HALF_WIDTH, bridgeSpansAt } from '../build';

/** Kantenlaenge einer Rasterzelle in Metern. */
const CELL = 2;

/** Zellen je Achse. */
const SIZE = Math.ceil((FIELD_HALF * 2) / CELL);

/** Abstandswert fuer unerreichbare Zellen. */
export const UNREACHABLE = 0xffff;

export interface NavField {
  /** Abstand zum Ziel in Zellen (Breitensuche), UNREACHABLE wenn gesperrt. */
  dist: Uint16Array;
  /** Zielzelle. */
  goalX: number;
  goalZ: number;
}

function cellIndex(ix: number, iz: number): number {
  return iz * SIZE + ix;
}

function toCell(v: number): number {
  return Math.max(0, Math.min(SIZE - 1, Math.round((v + FIELD_HALF) / CELL)));
}

function toWorld(i: number): number {
  return -FIELD_HALF + i * CELL;
}

/**
 * Ist diese Zelle fuer Truppen begehbar?
 *
 * Wasser ist gesperrt — ausser dort, wo ein eigener Wellenbrecher liegt. Ohne
 * das lief die Wegfindung immer um das Wasser herum, und der Damm wurde nie
 * benutzt: gemessen kamen Truppen mit und ohne Damm gleich weit.
 */
function cellWalkable(ix: number, iz: number, bridges: Uint8Array | null): boolean {
  const x = toWorld(ix);
  const z = toWorld(iz);
  if (isWater(x, z)) return bridges !== null && bridges[cellIndex(ix, iz)] === 1;
  return isPassable(x, z);
}

/**
 * Zellen, die ein eigener Wellenbrecher begehbar macht.
 *
 * Ein Wellenbrecher ist ein Damm: er spannt sich ueber die Wasserflaeche an
 * seiner Stelle, von Ufer zu Ufer. Deshalb wird nicht ein Kreis um den
 * Mittelpunkt freigegeben, sondern der Streifen entlang der Spannweite.
 *
 * Frueher war es ein Kreis von 8 m — bei einem 19 m breiten Fluss reichte der
 * nicht ans andere Ufer, und die Truppen liefen auf den Damm, kamen nicht
 * hinueber und blieben stehen (gemessen: mit Damm kamen sie nur bis z = 8,9,
 * ohne Damm bis z = -5,2).
 *
 * Die Spannweite kommt aus `bridgeSpanAt` — derselben Funktion, die auch die
 * Bewegung fragt. Wegfindung und Bewegung koennen damit nicht auseinanderlaufen.
 */
function bridgeCells(bridges: { x: number; z: number }[]): Uint8Array | null {
  if (bridges.length === 0) return null;
  const grid = new Uint8Array(SIZE * SIZE);

  for (const b of bridges) {
    // Alle Achsen, auf denen der Damm Ufer erreicht — bei einem runden See ein
    // Kreuz. Mit nur der kuerzesten Achse lag der Damm quer zur Laufrichtung.
    const spans = bridgeSpansAt(b.x, b.z);
    // Kein Ufer auf beiden Seiten: dieser Damm reicht nicht hinueber und
    // oeffnet nichts. Sonst waere er eine Falle.
    for (const span of spans) {

    const dx = span.bx - span.ax;
    const dz = span.bz - span.az;
    const len2 = dx * dx + dz * dz;
    if (len2 < 0.0001) continue;

    const reach = BREAKWATER_WALK_HALF_WIDTH;
    const minX = Math.min(span.ax, span.bx) - reach;
    const maxX = Math.max(span.ax, span.bx) + reach;
    const minZ = Math.min(span.az, span.bz) - reach;
    const maxZ = Math.max(span.az, span.bz) + reach;

    for (let x = Math.floor(minX); x <= Math.ceil(maxX); x += CELL) {
      for (let z = Math.floor(minZ); z <= Math.ceil(maxZ); z += CELL) {
        // Abstand des Punktes zur Damm-Linie, auf die Laenge begrenzt.
        let t = ((x - span.ax) * dx + (z - span.az) * dz) / len2;
        t = Math.max(0, Math.min(1, t));
        const px = span.ax + dx * t;
        const pz = span.az + dz * t;
        if (Math.hypot(x - px, z - pz) > reach) continue;
        grid[cellIndex(toCell(x), toCell(z))] = 1;
      }
    }
    }
  }

  let any = false;
  for (let i = 0; i < grid.length; i++) {
    if (grid[i] === 1) {
      any = true;
      break;
    }
  }
  return any ? grid : null;
}

/**
 * Distanzfeld zum Zielpunkt.
 *
 * `bridges` sind die Wellenbrecher der eigenen Seite — nur die machen Wasser
 * begehbar, fremde Daemme nicht.
 */
export function buildNavField(
  goalX: number,
  goalZ: number,
  bridges: { x: number; z: number }[] = [],
): NavField {
  const dist = new Uint16Array(SIZE * SIZE).fill(UNREACHABLE);
  const cells = bridgeCells(bridges);
  const gx = toCell(goalX);
  const gz = toCell(goalZ);

  // Das Ziel selbst kann auf unwegsamem Boden liegen (z. B. auf einem Huegel).
  // Dann den naechsten begehbaren Punkt nehmen, sonst ist das Feld leer.
  let startX = gx;
  let startZ = gz;
  if (!cellWalkable(startX, startZ, cells)) {
    let best = Infinity;
    for (let r = 1; r <= 12 && best === Infinity; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          const nx = gx + dx;
          const nz = gz + dz;
          if (nx < 0 || nz < 0 || nx >= SIZE || nz >= SIZE) continue;
          if (!cellWalkable(nx, nz, cells)) continue;
          const d = Math.hypot(dx, dz);
          if (d < best) {
            best = d;
            startX = nx;
            startZ = nz;
          }
        }
      }
    }
  }

  const queue = new Int32Array(SIZE * SIZE);
  let head = 0;
  let tail = 0;
  dist[cellIndex(startX, startZ)] = 0;
  queue[tail++] = cellIndex(startX, startZ);

  const neighbours: [number, number][] = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ];

  while (head < tail) {
    const current = queue[head++];
    const ix = current % SIZE;
    const iz = Math.floor(current / SIZE);
    const d = dist[current];
    for (const [dx, dz] of neighbours) {
      const nx = ix + dx;
      const nz = iz + dz;
      if (nx < 0 || nz < 0 || nx >= SIZE || nz >= SIZE) continue;
      const k = cellIndex(nx, nz);
      if (dist[k] !== UNREACHABLE) continue;
      if (!cellWalkable(nx, nz, cells)) continue;
      dist[k] = d + 1;
      queue[tail++] = k;
    }
  }

  return { dist, goalX: startX, goalZ: startZ };
}

/**
 * Naechster Wegpunkt von einer Position aus.
 *
 * Sucht in der Umgebung die Zelle mit dem kleinsten Abstand und gibt deren
 * Mittelpunkt zurueck. Ist kein Feld vorhanden oder die Position unerreichbar,
 * kommt `null` — dann laeuft die Truppe wie bisher geradeaus.
 */
export function nextWaypoint(field: NavField | null, x: number, z: number): { x: number; z: number } | null {
  if (!field) return null;
  const cx = toCell(x);
  const cz = toCell(z);
  const here = field.dist[cellIndex(cx, cz)];
  if (here === UNREACHABLE) return null;
  if (here === 0) return null;

  // Im Umkreis von zwei Zellen den steilsten Abstieg suchen. Zwei Zellen
  // statt einer, damit eine Truppe nicht an einer Zellkante klebt.
  let bestD = here;
  let bestX = -1;
  let bestZ = -1;
  for (let dz = -2; dz <= 2; dz++) {
    for (let dx = -2; dx <= 2; dx++) {
      const nx = cx + dx;
      const nz = cz + dz;
      if (nx < 0 || nz < 0 || nx >= SIZE || nz >= SIZE) continue;
      const d = field.dist[cellIndex(nx, nz)];
      if (d >= bestD) continue;
      bestD = d;
      bestX = nx;
      bestZ = nz;
    }
  }
  if (bestX < 0) return null;
  return { x: toWorld(bestX), z: toWorld(bestZ) };
}

/** Abstand zum Ziel in Metern (grob, fuer Entscheidungen der KI). */
export function distanceToGoal(field: NavField | null, x: number, z: number): number {
  if (!field) return Infinity;
  const d = field.dist[cellIndex(toCell(x), toCell(z))];
  return d === UNREACHABLE ? Infinity : d * CELL;
}
