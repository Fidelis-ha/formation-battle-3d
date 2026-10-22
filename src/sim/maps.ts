/**
 * Die zehn Karten.
 *
 * Jede Karte ist ein Datensatz: Startpositionen beider Armeen, Wasserkoerper,
 * Huegel und Waldschwerpunkte. `terrain.ts` rechnet daraus die Hoehenkarte, der
 * Renderer baut seine Geometrie aus denselben Werten — Bild und Simulation
 * koennen dadurch nicht auseinanderlaufen.
 *
 * Zwei Regeln, die fuer alle Karten gelten und in `terrain.ts` durchgesetzt
 * werden:
 *
 *  1. Wasser ist UNPASSIERBAR. Ausnahme: liegt an der Stelle ein Wellenbrecher,
 *     ist der Uebergang offen. Ein Wellenbrecher ist also eine Bruecke.
 *  2. Zwischen beiden Startpositionen muss ein begehbarer Weg liegen. Das ist
 *     keine Annahme, sondern wird in `tests/karten.test.ts` gemessen: das Test
 *     sucht mit einer Breitensuche einen Weg ueber begehbaren Boden. Findet es
 *     keinen, schlaegt es fehl.
 *
 * Wasseranteil bewusst niedrig: die meisten Karten liegen unter 12 % Wasser.
 * Mehr Wasser heisst weniger Wege, und dann treffen sich die Armeen nicht.
 */

export interface HillSpec {
  x: number;
  z: number;
  height: number;
  radius: number;
  /** Steilheit 0..1. 1 = steile Wand. */
  steep: number;
  /** Nur von dieser Richtung ersteigbar (0 = von Norden, PI = Sueden ...).
   *  null = rundum gleich begehbar. */
  climbFrom: number | null;
}

/**
 * Ein Wasserkoerper.
 *
 * - `river`: ein geschwungenes Band. Verlaueft quer zur Verbindungslinie der
 *   Armeen, sonst liegt es nur am Rand und aendert nichts.
 * - `lake`: runder See.
 * - `marsh`: flaches Feuchtgebiet, breit und unregelmaessig — ein Umweg, kein
 *   Hindernis.
 */
export type WaterSpec =
  | {
      kind: 'river';
      /** Hoehe der Mittellinie im Welt-Z. */
      offset: number;
      amplitude: number;
      frequency: number;
      halfWidth: number;
      bankWidth: number;
      /** Drehung des Bandes in Radiant. 0 = laeuft Ost-West. */
      angle?: number;
      /**
       * Furten: Stellen, an denen der Fluss unterbrochen ist.
       *
       * Ein Fluss, der die ganze Karte durchzieht, trennt beide Haelften
       * vollstaendig — dann gibt es keinen Weg und die Armeen treffen sich nie.
       * Gemessen: "Die Furt" und "Die Kreuzung" hatten ohne Furten keinen
       * begehbaren Weg zwischen den Startpositionen. Die Furten sind der
       * Grund, warum es diese Karten ueberhaupt gibt.
       */
      gaps?: { at: number; width: number }[];
    }
  | { kind: 'lake'; x: number; z: number; radius: number; bankWidth: number }
  | { kind: 'marsh'; x: number; z: number; radius: number; bankWidth: number };

/** Wald: ein Schwerpunkt, um den herum dichter Bestand steht. */
export interface WoodSpec {
  x: number;
  z: number;
  radius: number;
  /** 0..1 — wie dicht der Bestand wird. */
  density: number;
}

export interface BattleMap {
  id: string;
  name: string;
  /** Ein Satz, der die Eigenart der Karte nennt. */
  trait: string;
  /** Startpositionen beider Armeen. Der Winkel `facing` zeigt zur Mitte. */
  playerStart: { x: number; z: number };
  enemyStart: { x: number; z: number };
  hills: HillSpec[];
  water: WaterSpec[];
  woods: WoodSpec[];
  /** Grundrauschen der Karte — 0 = flach, 1 = wellig. */
  roughness: number;
}

/** Aufstellungsbreite: die Trupps stehen 7 m auseinander, fuenf Trupps. */
const LINE_HALF = 14;

export const MAPS: BattleMap[] = [
  {
    id: 'open-field',
    name: 'Offenes Feld',
    trait: 'Kein Wasser. Zwei Linien, freie Sicht, nichts im Weg.',
    playerStart: { x: 0, z: 46 },
    enemyStart: { x: 0, z: -46 },
    hills: [
      { x: 0, z: 0, height: 7, radius: 18, steep: 0.5, climbFrom: null },
      { x: -52, z: 24, height: 6, radius: 14, steep: 0.45, climbFrom: null },
      { x: 50, z: -22, height: 6, radius: 15, steep: 0.45, climbFrom: null },
    ],
    water: [],
    woods: [
      { x: -62, z: -50, radius: 22, density: 0.75 },
      { x: 62, z: 48, radius: 22, density: 0.75 },
    ],
    roughness: 0.8,
  },
  {
    id: 'shallow-ford',
    name: 'Die Furt',
    trait: 'Ein Fluss quer ueber das ganze Feld. Nur ein Wellenbrecher bringt hinueber.',
    playerStart: { x: 0, z: 48 },
    enemyStart: { x: 0, z: -48 },
    hills: [
      { x: -38, z: 0, height: 6, radius: 15, steep: 0.45, climbFrom: null },
      { x: 40, z: 6, height: 5, radius: 13, steep: 0.4, climbFrom: null },
    ],
    water: [
      {
        kind: 'river',
        offset: 0,
        amplitude: 7,
        frequency: 0.03,
        halfWidth: 3.0,
        bankWidth: 8,
        // EINE Furt, seitlich versetzt. Sie liegt bewusst nicht auf der
        // Verbindungslinie der Startpunkte: dort ist der Fluss eine Wand, und
        // ein Wellenbrecher ist der kurze Weg hinueber. Wer nicht baut, muss
        // 35 m Umweg laufen — spuerbar, aber nicht so weit, dass sich die
        // Armeen im Zeitlimit verfehlen (gemessen bei 62 m: kein Kontakt).
        gaps: [{ at: 34, width: 14 }],
      },
    ],
    woods: [{ x: 60, z: -46, radius: 20, density: 0.7 }],
    roughness: 0.7,
  },
  {
    id: 'two-hills',
    name: 'Zwei Huegel',
    trait: 'Zwei Anhoehen links und rechts, dazwischen eine Senke.',
    playerStart: { x: 0, z: 48 },
    enemyStart: { x: 0, z: -48 },
    hills: [
      { x: -32, z: 0, height: 12, radius: 20, steep: 0.72, climbFrom: null },
      { x: 32, z: 0, height: 12, radius: 20, steep: 0.72, climbFrom: null },
      { x: 0, z: 0, height: 2, radius: 12, steep: 0.3, climbFrom: null },
    ],
    water: [],
    woods: [{ x: 0, z: -60, radius: 18, density: 0.6 }],
    roughness: 0.9,
  },
  {
    id: 'lake-pass',
    name: 'Der See',
    trait: 'Ein See in der Mitte. Man muss links oder rechts herum.',
    playerStart: { x: -10, z: 48 },
    enemyStart: { x: 10, z: -48 },
    hills: [{ x: 56, z: 44, height: 8, radius: 16, steep: 0.5, climbFrom: null }],
    water: [{ kind: 'lake', x: 0, z: 0, radius: 20, bankWidth: 7 }],
    woods: [
      { x: -58, z: -30, radius: 20, density: 0.7 },
      { x: 58, z: 34, radius: 18, density: 0.7 },
    ],
    roughness: 0.75,
  },
  {
    id: 'forest-road',
    name: 'Waldweg',
    trait: 'Dichter Wald auf beiden Seiten, ein Korridor in der Mitte.',
    playerStart: { x: 0, z: 50 },
    enemyStart: { x: 0, z: -50 },
    hills: [{ x: 0, z: 10, height: 4, radius: 12, steep: 0.35, climbFrom: null }],
    water: [],
    woods: [
      { x: -44, z: 0, radius: 30, density: 0.95 },
      { x: 44, z: 0, radius: 30, density: 0.95 },
    ],
    roughness: 0.6,
  },
  {
    id: 'narrow-defile',
    name: 'Die Enge',
    trait: 'Felswaende links und rechts, nur ein schmaler Durchlass.',
    playerStart: { x: 0, z: 52 },
    enemyStart: { x: 0, z: -52 },
    hills: [
      { x: -30, z: 0, height: 18, radius: 26, steep: 0.95, climbFrom: null },
      { x: 30, z: 0, height: 18, radius: 26, steep: 0.95, climbFrom: null },
    ],
    water: [],
    woods: [],
    roughness: 0.5,
  },
  {
    id: 'crossing',
    name: 'Die Kreuzung',
    trait: 'Ost gegen West. Der Fluss laeuft laengs, man kaempft um den Uebergang.',
    playerStart: { x: 48, z: 0 },
    enemyStart: { x: -48, z: 0 },
    hills: [
      { x: 0, z: 44, height: 7, radius: 14, steep: 0.45, climbFrom: null },
      { x: 0, z: -44, height: 7, radius: 14, steep: 0.45, climbFrom: null },
    ],
    water: [
      {
        kind: 'river',
        offset: 0,
        amplitude: 6,
        frequency: 0.028,
        halfWidth: 3.2,
        bankWidth: 9,
        angle: Math.PI / 2,
        // Eine Furt in der Mitte — der Kampf dreht sich um sie.
        gaps: [{ at: 0, width: 20 }],
      },
    ],
    woods: [{ x: 60, z: 60, radius: 18, density: 0.65 }],
    roughness: 0.75,
  },
  {
    id: 'marshland',
    name: 'Das Bruch',
    trait: 'Breites Feuchtgebiet vor der feindlichen Linie. Umweg kostet Zeit.',
    playerStart: { x: 0, z: 48 },
    enemyStart: { x: 0, z: -48 },
    hills: [{ x: 48, z: 0, height: 9, radius: 16, steep: 0.55, climbFrom: null }],
    water: [{ kind: 'marsh', x: -6, z: 12, radius: 24, bankWidth: 8 }],
    woods: [{ x: -58, z: 40, radius: 20, density: 0.75 }],
    roughness: 0.85,
  },
  {
    id: 'island',
    name: 'Die Insel',
    trait: 'Eine Furt fuehrt auf eine Insel in der Mitte. Wer sie haelt, hat die Mitte.',
    playerStart: { x: 0, z: 50 },
    enemyStart: { x: 0, z: -50 },
    hills: [{ x: 0, z: 0, height: 6, radius: 11, steep: 0.5, climbFrom: null }],
    water: [
      { kind: 'lake', x: 0, z: 0, radius: 13, bankWidth: 5 },
      { kind: 'lake', x: -34, z: 0, radius: 14, bankWidth: 6 },
      { kind: 'lake', x: 34, z: 0, radius: 14, bankWidth: 6 },
    ],
    woods: [{ x: 58, z: 54, radius: 16, density: 0.6 }],
    roughness: 0.7,
  },
  {
    id: 'high-plateau',
    name: 'Die Hochebene',
    trait: 'Eine Anhoehe mit einer Rampe. Wer oben steht, schiesst weiter.',
    playerStart: { x: 0, z: 52 },
    enemyStart: { x: 0, z: -52 },
    hills: [
      { x: 0, z: 0, height: 14, radius: 26, steep: 0.85, climbFrom: Math.PI / 2 },
      { x: -50, z: 40, height: 7, radius: 15, steep: 0.5, climbFrom: null },
    ],
    water: [],
    woods: [{ x: 52, z: -44, radius: 20, density: 0.7 }],
    roughness: 0.8,
  },
];

/** Karte ueber ihre Kennung. */
export function mapById(id: string): BattleMap | null {
  return MAPS.find((m) => m.id === id) ?? null;
}

/** Index einer Karte in der Liste (fuer "naechste Karte"). */
export function mapIndex(id: string): number {
  return MAPS.findIndex((m) => m.id === id);
}

/**
 * Die Startlinie einer Armee: fuenf Trupps quer zur Blickrichtung.
 *
 * Die Trupps stehen 7 m auseinander. `facing` zeigt von der Startposition zur
 * Kartenmitte, damit beide Armeen einander zugewandt beginnen.
 */
export function startLine(
  map: BattleMap,
  side: 'player' | 'enemy',
): { x: number; z: number; facing: number }[] {
  const start = side === 'player' ? map.playerStart : map.enemyStart;
  const dx = -start.x;
  const dz = -start.z;
  const facing = Math.atan2(dx, dz);
  // Querrichtung: senkrecht zur Blickrichtung.
  const qx = Math.cos(facing);
  const qz = -Math.sin(facing);
  const out: { x: number; z: number; facing: number }[] = [];
  for (let i = 0; i < 5; i++) {
    const t = (i - 2) * 7;
    out.push({
      x: start.x + qx * t,
      z: start.z + qz * t,
      facing,
    });
  }
  // Der Spieler steht suedlich, seine Linie laeuft gespiegelt — sonst stehen
  // sich die Trupps nicht gegenueber, sondern versetzt.
  if (side === 'player') {
    out.reverse();
  }
  return out;
}

export { LINE_HALF };
