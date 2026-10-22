/**
 * Gelaende des Schlachtfelds.
 *
 * Diese Datei rechnet die Hoehe der Karte aus und beantwortet Fragen, die
 * Simulation und Renderer gemeinsam brauchen: Wie hoch ist der Boden hier?
 * Wie steil? Ist das Wasser? Steht Wald?
 *
 * Wichtig: Hier darf nichts aus `three` importiert werden. Der Renderer baut
 * seine Geometrie aus genau diesen Werten, damit Bild und Simulation nie
 * auseinanderlaufen.
 */

import { MAPS, type BattleMap, type HillSpec, type WaterSpec } from './maps';

export const FIELD_HALF = 90;
export const SEED = 20261021;

/**
 * Die gerade aktive Karte.
 *
 * `setMap()` setzt sie; alles darunter rechnet gegen diese Karte. Vorher war
 * das Gelaende fest verdrahtet (ein Fluss, fuenf Huegel) — jetzt ist es ein
 * Datensatz aus `maps.ts`, und dieselben Funktionen gelten fuer alle zehn
 * Karten.
 */
let activeMap: BattleMap = MAPS[0];

export function setMap(map: BattleMap): void {
  activeMap = map;
  resetCaches();
}

export function currentMap(): BattleMap {
  return activeMap;
}

export type GroundKind = 'grass' | 'hill' | 'rock' | 'forest' | 'water' | 'bank';

/** Zufall mit festem Startwert — gleiche Karte bei gleichem Seed. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Weiches Rauschen: mehrere Oktaven Sinus, ohne Tabellen. */
function noise2(x: number, z: number, seed: number): number {
  const s = seed * 0.017;
  return (
    Math.sin(x * 0.061 + z * 0.043 + s) * 0.5 +
    Math.sin(x * 0.127 - z * 0.089 + s * 2.1) * 0.3 +
    Math.sin(x * 0.311 + z * 0.271 + s * 3.7) * 0.12 +
    Math.sin(x * 0.717 - z * 0.611 + s * 5.3) * 0.08
  );
}

/**
 * Die Huegel der aktiven Karte.
 *
 * Vorher stand hier eine feste Liste mit fuenf Huegeln; jetzt kommt sie aus dem
 * Kartendatensatz. `hillHeight` bleibt unveraendert und rechnet weiter mit
 * einem HillSpec.
 */
export function hillsOf(): HillSpec[] {
  return activeMap.hills;
}

/**
 * Wasser der aktiven Karte.
 *
 * Der Fluss ist kein gemaltes Polygon, sondern eine Funktion: dadurch liegt das
 * Wasser immer genau in der Mulde, die die Hoehenkarte vorgibt. Seen und
 * Feuchtgebiete werden genauso gerechnet.
 */
function riversOf(): Extract<WaterSpec, { kind: 'river' }>[] {
  return activeMap.water.filter((w): w is Extract<WaterSpec, { kind: 'river' }> => w.kind === 'river');
}

function lakesOf(): Extract<WaterSpec, { kind: 'lake' | 'marsh' }>[] {
  return activeMap.water.filter(
    (w): w is Extract<WaterSpec, { kind: 'lake' | 'marsh' }> => w.kind === 'lake' || w.kind === 'marsh',
  );
}

/**
 * Liegt dieser Punkt in einer Furt des Flusses?
 *
 * Furten sind Unterbrechungen im Band. Dort steht kein Wasser und das Ufer
 * faellt nicht ab — eine Armee kann hier trockenen Fusses hinueber.
 */
export function isFord(x: number, z: number): boolean {
  const river = riversOf()[0];
  if (!river?.gaps) return false;
  const angle = river.angle ?? 0;
  const rx = x * Math.cos(-angle) - z * Math.sin(-angle);
  for (const gap of river.gaps) {
    if (Math.abs(rx - gap.at) <= gap.width / 2) return true;
  }
  return false;
}

/** Abstand eines Punktes zur Mittellinie des ersten Flusses (nur quer). */
export function riverCenterAt(x: number): number {
  const river = riversOf()[0];
  if (!river) return 1e6;
  const angle = river.angle ?? 0;
  // Bei gedrehtem Band laeuft die Mittellinie laengs einer anderen Achse.
  const along = angle === 0 ? x : riverDistanceAlong(x);
  return (
    river.offset +
    Math.sin(along * river.frequency) * river.amplitude +
    Math.sin(along * 0.011 + 1.3) * river.amplitude * 0.45
  );
}

/** Hilfsachse fuer ein gedrehtes Flussband. */
function riverDistanceAlong(v: number): number {
  return v;
}

/** Wie weit ein Punkt vom Flussmittelpunkt entfernt ist (quer). */
export function riverDistanceAt(x: number, z: number): number {
  const river = riversOf()[0];
  if (!river) return 1e6;
  const angle = river.angle ?? 0;
  // Punkt in das Koordinatensystem des Bandes drehen.
  const rx = x * Math.cos(-angle) - z * Math.sin(-angle);
  const rz = x * Math.sin(-angle) + z * Math.cos(-angle);
  const centre = river.offset + Math.sin(rx * river.frequency) * river.amplitude +
    Math.sin(rx * 0.011 + 1.3) * river.amplitude * 0.45;
  return Math.abs(rz - centre);
}

/** Der Fluss der aktiven Karte (oder null). */
export function activeRiver(): Extract<WaterSpec, { kind: 'river' }> | null {
  return riversOf()[0] ?? null;
}

/** Seen und Feuchtgebiete der aktiven Karte. */
export function activeLakes(): Extract<WaterSpec, { kind: 'lake' | 'marsh' }>[] {
  return lakesOf();
}

/** Halbe Breite des Flussbandes (0, wenn die Karte keinen Fluss hat). */
export function riverHalfWidth(): number {
  return riversOf()[0]?.halfWidth ?? 0;
}

/** Halbe Breite der Uferboeschung. */
export function riverBankWidth(): number {
  return riversOf()[0]?.bankWidth ?? 0;
}

/**
 * Hoehe eines Huegels an einer Stelle. Gibt 0 zurueck, wenn der Punkt
 * ausserhalb liegt.
 */
function hillHeight(hill: HillSpec, x: number, z: number): number {
  const dx = x - hill.x;
  const dz = z - hill.z;
  const d = Math.hypot(dx, dz);
  if (d >= hill.radius) return 0;

  // Form: oben abgeflacht (Plateau), aussen auslaufend.
  const t = 1 - d / hill.radius;
  const profile = Math.pow(t, 1.35) * (1 - 0.18 * Math.pow(t, 6));

  // Neigung: steile Huegel steigen schneller an und enden abrupt.
  const shaped = hill.steep > 0.7 ? Math.pow(profile, 0.72) : profile;

  // Einseitig ersteigbar: eine Rampe auf der einen, eine Klippe auf der
  // anderen Seite. Beides wird aus demselben Hoehenprofil gerechnet, damit
  // der Huegel eine einzige zusammenhaengende Form bleibt.
  if (hill.climbFrom !== null) {
    const angle = Math.atan2(dz, dx);
    let diff = angle - hill.climbFrom;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;

    // facing: 1 = genau auf der Aufstiegsseite, 0 = genau gegenueber.
    const facing = (Math.cos(diff) + 1) / 2;

    // Beide Seiten steigen von aussen nach innen an. Der Unterschied ist, wie
    // steil: die Rampe verteilt die Hoehe ueber den ganzen Radius, die Klippe
    // staut sie auf ein kurzes Stueck am Rand.
    const rise = 1 - d / hill.radius;              // 0 aussen, 1 innen

    // Rampe: flache Gerade — ueber 22 m verteilt ergibt 12 m Hoehe rund 0.55
    // Steigung, also klar unter dem Klettergrenzwert.
    const ramp = rise;

    // Klippe: Plateau innen, Wand zwischen 0.52 und 0.80 des Radius.
    const wallT = Math.min(1, Math.max(0, (rise - 0.52) / 0.28));
    const cliff = 0.1 + 0.9 * (wallT * wallT * (3 - 2 * wallT));

    const blend = Math.pow(facing, 1.4);
    return hill.height * (ramp * blend + cliff * (1 - blend));
  }

  return hill.height * shaped;
}

/**
 * Grundhoehe ohne Fluss und ohne Rauschen. Das ist der ruhige Untergrund.
 */
function baseHeight(x: number, z: number): number {
  let h = 0;
  for (const hill of hillsOf()) h += hillHeight(hill, x, z);
  // Leichte Wellen ueber die ganze Karte. Wie wellig, sagt die Karte selbst:
  // ein offenes Feld ist ruhiger als ein Huegelland.
  h += noise2(x, z, SEED) * 1.15 * activeMap.roughness;
  // Kartenrand leicht anheben: das Feld wirkt wie eine Lichtung im Wald.
  const edge = Math.max(Math.abs(x), Math.abs(z)) / FIELD_HALF;
  h += Math.pow(Math.max(0, edge - 0.72) / 0.28, 2) * 11;
  return h;
}

/**
 * Endgueltige Bodenhoehe.
 *
 * Wasser schneidet eine Mulde ein: innen Wasser, danach eine Boeschung, dann
 * wieder normales Gelaende. Das gilt fuer Fluesse, Seen und Feuchtgebiete —
 * alle drei sind dieselbe Rechnung mit anderer Form.
 */
export function heightAt(x: number, z: number): number {
  let h = baseHeight(x, z);

  // Fluss: Band mit Boeschung — ausser an einer Furt, dort bleibt das
  // Gelaende stehen und der Fluss ist unterbrochen.
  const river = riversOf()[0];
  if (river && !isFord(x, z)) {
    const d = riverDistanceAt(x, z);
    if (d <= river.halfWidth + river.bankWidth) {
      const bed = WATER_LEVEL - RIVER_DEPTH;
      if (d <= river.halfWidth) {
        const t = d / river.halfWidth;
        h = bed + Math.pow(t, 2) * RIVER_DEPTH * 0.35;
      } else {
        const t = (d - river.halfWidth) / river.bankWidth;
        const smooth = t * t * (3 - 2 * t);
        h = bed + (h - bed) * smooth;
      }
    }
  }

  // Seen und Feuchtgebiete: rund, mit Boeschung.
  for (const water of lakesOf()) {
    const d = Math.hypot(x - water.x, z - water.z);
    if (d > water.radius + water.bankWidth) continue;
    // Ein Feuchtgebiet liegt flacher: es ist ein Umweg, kein Abgrund.
    const depth = water.kind === 'marsh' ? 0.35 : 1.6;
    const bed = WATER_LEVEL - depth;
    if (d <= water.radius) {
      const t = d / water.radius;
      h = Math.min(h, bed + Math.pow(t, 2) * depth * 0.35);
    } else {
      const t = (d - water.radius) / water.bankWidth;
      const smooth = t * t * (3 - 2 * t);
      h = Math.min(h, bed + (h - bed) * smooth);
    }
  }

  // Trockenes Land darf nicht unter den Wasserspiegel rutschen. Das Rauschen
  // allein reichte, um flaches Feld auf -0.8 zu druecken — gemessen lagen
  // dadurch Startpunkte von Armeen im Wasser, auf Karten ohne jedes Gewaesser.
  // Wo kein Wasserkorper ist, bleibt der Boden ueber dem Spiegel.
  if (!inWaterBody(x, z) && !nearWaterBody(x, z)) h = Math.max(h, WATER_LEVEL + 0.25);

  return h;
}

/**
 * Liegt der Punkt in einem Wasserkorper ODER auf seiner Boeschung?
 *
 * Die Sicherung gegen Wasser muss auch das Ufer aussparen: sonst hebt sie die
 * Flussrinne an und das Wasser verschwindet ganz.
 */
function nearWaterBody(x: number, z: number): boolean {
  const river = riversOf()[0];
  if (river && !isFord(x, z) && riverDistanceAt(x, z) <= river.halfWidth + river.bankWidth) return true;
  for (const water of lakesOf()) {
    if (Math.hypot(x - water.x, z - water.z) <= water.radius + water.bankWidth) return true;
  }
  return false;
}

/**
 * Liegt der Punkt in einem Wasserkorper (Fluss ohne Furt, See, Feuchtgebiet)?
 *
 * Anders als `isWater` fragt das die FORM ab, nicht die Hoehe — dadurch ist es
 * von der Hoehenrechnung unabhaengig und kann sie korrigieren.
 */
function inWaterBody(x: number, z: number): boolean {
  const river = riversOf()[0];
  if (river && !isFord(x, z) && riverDistanceAt(x, z) <= river.halfWidth) return true;
  for (const water of lakesOf()) {
    if (Math.hypot(x - water.x, z - water.z) <= water.radius) return true;
  }
  return false;
}

/** Tiefe eines Flussbetts. */
const RIVER_DEPTH = 1.6;

/** Steigung an einer Stelle (0 = flach, 1 = senkrecht), als Anstieg pro Meter. */
export function slopeAt(x: number, z: number): number {
  const s = 0.6;
  const dx = (heightAt(x + s, z) - heightAt(x - s, z)) / (2 * s);
  const dz = (heightAt(x, z + s) - heightAt(x, z - s)) / (2 * s);
  return Math.hypot(dx, dz);
}

/** Wasserstand: alles unter dieser Hoehe ist Wasser. */
export const WATER_LEVEL = -0.55;

export function isWater(x: number, z: number): boolean {
  return heightAt(x, z) < WATER_LEVEL;
}

export function isRiverBand(x: number, z: number): boolean {
  const river = riversOf()[0];
  if (!river) return false;
  return riverDistanceAt(x, z) <= river.halfWidth;
}

/** Boeschung: nah am Wasser, aber nicht im Wasser. */
export function isBank(x: number, z: number): boolean {
  if (isWater(x, z)) return false;
  const river = riversOf()[0];
  if (river && riverDistanceAt(x, z) <= river.halfWidth + river.bankWidth) return true;
  for (const water of lakesOf()) {
    const d = Math.hypot(x - water.x, z - water.z);
    if (d <= water.radius + water.bankWidth) return true;
  }
  return false;
}

/**
 * Wald: zusammenhaengende Bestaende mit Lichtungen.
 *
 * Der Wert ist ein "Walddichte-Feld" 0..1. Baumstandorte werden daraus
 * gezogen. Lichte Flaechen entstehen dort, wo das Feld unter der Schwelle
 * bleibt — sie liegen als Inseln in den Bestaenden.
 */
export function forestDensityAt(x: number, z: number): number {
  // Grundmuster: grosse Waldflaechen. Der Faktor 1.35 spreizt das Rauschen,
  // dadurch entstehen zusammenhaengende Bestaende statt duenner Inseln.
  let n = ((noise2(x * 0.42, z * 0.42, SEED + 11) + 1) / 2 - 0.5) * 1.35 + 0.55;
  // Lichtungen: eigene, kleinere Rauschschicht, die Loecher stanzt. Nur die
  // staerksten Spitzen stanzen — sonst zerreisst der Bestand in Einzelbaeume.
  const glade = (noise2(x * 0.85, z * 0.85, SEED + 29) + 1) / 2;
  n -= Math.max(0, glade - 0.78) * 2.6;
  // Waldraender an den Flanken der Karte: links und rechts reiht sich der
  // Bestand am Feldrand, damit das Schlachtfeld eingerahmt wirkt.
  const flank = Math.max(0, (Math.abs(x) - 34) / 46);
  n += flank * 0.55;
  // Am Fluss entlang keine Baeume (Uferwiese).
  const river = riversOf()[0];
  if (river && riverDistanceAt(x, z) < river.halfWidth + river.bankWidth + 3) n *= 0.15;
  // Wald-Schwerpunkte der Karte: dort wird der Bestand dichter.
  for (const wood of activeMap.woods) {
    const dw = Math.hypot(x - wood.x, z - wood.z);
    if (dw < wood.radius) {
      const t = 1 - dw / wood.radius;
      n = Math.max(n, wood.density * (0.55 + 0.45 * t));
    }
  }
  // Auf steilen Haengen und auf dem Huegelplateau keine dichten Bestaende.
  if (slopeAt(x, z) > 0.62) n *= 0.3;
  return Math.max(0, Math.min(1, n));
}

/** Ab dieser Dichte steht Wald. */
export const FOREST_THRESHOLD = 0.48;

export function isForest(x: number, z: number): boolean {
  return forestDensityAt(x, z) >= FOREST_THRESHOLD;
}

/** Bodenart an einer Stelle — fuer Farbe und fuer die Simulation. */
export function groundKindAt(x: number, z: number): GroundKind {
  if (isWater(x, z)) return 'water';
  if (isBank(x, z)) return 'bank';
  if (isForest(x, z)) return 'forest';
  const slope = slopeAt(x, z);
  if (slope > 0.75) return 'rock';
  if (heightAt(x, z) > 2.2) return 'hill';
  return 'grass';
}

/**
 * Kann eine Truppe diesen Hang ersteigen? Sehr steile Haenge sperren.
 * Der Grenzwert ist absichtlich so gesetzt, dass die Klippe des mittleren
 * Huegels nicht passierbar ist, die flache Seite aber schon.
 */
export const MAX_CLIMB_SLOPE = 0.62;

/**
 * Wie abrupt steigt der Hang hier an? Verglichen wird die Steigung etwas
 * weiter aussen mit der hier. Bei einer Rampe ist der Unterschied klein,
 * bei einer Klippe springt der Wert.
 */
function slopeJump(x: number, z: number): number {
  // Richtung des staerksten Anstiegs bestimmen.
  const s = 0.6;
  const dx = (heightAt(x + s, z) - heightAt(x - s, z)) / (2 * s);
  const dz = (heightAt(x, z + s) - heightAt(x, z - s)) / (2 * s);
  const len = Math.hypot(dx, dz);
  if (len < 1e-6) return 0;
  const ux = dx / len;
  const uz = dz / len;

  const here = heightAt(x, z);
  const outer = heightAt(x - ux * 2.2, z - uz * 2.2);
  return here - outer;
}

export function isPassable(x: number, z: number): boolean {
  if (isWater(x, z)) return false;
  const slope = slopeAt(x, z);
  if (slope <= MAX_CLIMB_SLOPE) return true;
  // Ueber dem Grenzwert: nur sperren, wenn der Anstieg abrupt ist. Ein
  // gleichmaessiger Steilhang (Rampe) bleibt begehbar — er kostet nur Tempo.
  return slopeJump(x, z) < 1.2;
}

/**
 * Sucht einen passierbaren Punkt in der Naehe. Truppen, die gegen eine Klippe
 * laufen, sollen daran entlang rutschen statt zu kleben.
 */
export function nudgePassable(x: number, z: number, radius = 6): { x: number; z: number } {
  // Immer innerhalb der Karte bleiben. Vorher fuehrte die Suche Truppen bis
  // an den Kartenrand, weil auch Punkte ausserhalb als "passierbar" galten.
  const limit = FIELD_HALF - 4;
  const cx = Math.max(-limit, Math.min(limit, x));
  const cz = Math.max(-limit, Math.min(limit, z));

  if (isPassable(cx, cz)) return { x: cx, z: cz };
  // Ringweise nach aussen suchen — aber nicht ueber den Kartenrand hinaus.
  for (let r = 0.8; r <= radius; r += 0.8) {
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const nx = cx + Math.cos(a) * r;
      const nz = cz + Math.sin(a) * r;
      if (Math.abs(nx) > limit || Math.abs(nz) > limit) continue;
      if (isPassable(nx, nz)) return { x: nx, z: nz };
    }
  }
  return { x: cx, z: cz };
}

/**
 * Alle Baumstandorte der Karte. Wird einmal berechnet und von Renderer und
 * Simulation geteilt.
 */
export interface TreeSpot {
  x: number;
  z: number;
  y: number;
  scale: number;
  rotation: number;
  /** 0 = Laubbaum, 1 = Nadelbaum, 2 = Busch */
  kind: number;
}

let treeCache: TreeSpot[] | null = null;

export function treeSpots(): TreeSpot[] {
  if (treeCache) return treeCache;
  const rand = mulberry32(SEED);
  const spots: TreeSpot[] = [];
  const step = 2.6;

  for (let x = -FIELD_HALF + 4; x < FIELD_HALF - 4; x += step) {
    for (let z = -FIELD_HALF + 4; z < FIELD_HALF - 4; z += step) {
      // Etwas Unregelmaessigkeit, damit keine Rasterreihen entstehen.
      const px = x + (rand() - 0.5) * step * 0.9;
      const pz = z + (rand() - 0.5) * step * 0.9;
      const density = forestDensityAt(px, pz);
      if (density < FOREST_THRESHOLD) continue;
      // Dichter Wald = mehr Baeume pro Rasterzelle.
      if (rand() > (density - FOREST_THRESHOLD) / (1 - FOREST_THRESHOLD) * 1.35 + 0.12) continue;
      if (isWater(px, pz) || isBank(px, pz)) continue;
      if (slopeAt(px, pz) > 0.8) continue;

      // Am Rand des Bestands kleiner, im Kern groesser.
      const edge = Math.min(1, (density - FOREST_THRESHOLD) * 4);
      const kind = rand() < 0.55 ? 0 : rand() < 0.82 ? 1 : 2;
      spots.push({
        x: px,
        z: pz,
        y: heightAt(px, pz),
        scale: 0.75 + rand() * 0.55 + edge * 0.25,
        rotation: rand() * Math.PI * 2,
        kind,
      });
    }
  }
  treeCache = spots;
  return spots;
}

/** Grasbueschel: nur auf Wiese, nicht im Wasser und nicht in dichtem Wald. */
export function grassTufts(count = 2600): { x: number; z: number; y: number; scale: number; rotation: number }[] {
  const rand = mulberry32(SEED + 77);
  const out: { x: number; z: number; y: number; scale: number; rotation: number }[] = [];
  let guard = 0;
  while (out.length < count && guard++ < count * 12) {
    const x = (rand() * 2 - 1) * (FIELD_HALF - 6);
    const z = (rand() * 2 - 1) * (FIELD_HALF - 6);
    if (isWater(x, z) || isBank(x, z)) continue;
    if (forestDensityAt(x, z) > 0.34) continue;
    if (slopeAt(x, z) > 0.6) continue;
    out.push({
      x,
      z,
      y: heightAt(x, z),
      scale: 0.6 + rand() * 0.7,
      rotation: rand() * Math.PI * 2,
    });
  }
  return out;
}

/** Steinbrocken: auf Haengen und an Klippen. */
export function rockSpots(count = 160): { x: number; z: number; y: number; scale: number; rotation: number }[] {
  const rand = mulberry32(SEED + 131);
  const out: { x: number; z: number; y: number; scale: number; rotation: number }[] = [];
  let guard = 0;
  while (out.length < count && guard++ < count * 20) {
    const x = (rand() * 2 - 1) * (FIELD_HALF - 5);
    const z = (rand() * 2 - 1) * (FIELD_HALF - 5);
    if (isWater(x, z)) continue;
    const slope = slopeAt(x, z);
    if (slope < 0.28 && rand() > 0.25) continue;
    out.push({
      x,
      z,
      y: heightAt(x, z),
      scale: 0.5 + rand() * 1.5,
      rotation: rand() * Math.PI * 2,
    });
  }
  return out;
}

/** Nur zum Testen: Zwischenspeicher leeren. */
export function resetCaches(): void {
  treeCache = null;
}
