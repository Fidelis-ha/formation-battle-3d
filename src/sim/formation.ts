export const FORMATION_SPACING = 0.85;

// Spaltenanzahl des Rasters.
export function formationWidth(count: number): number {
  if (count <= 0) return 0;
  return Math.ceil(Math.sqrt(count * 1.6));
}

// Lokale Slots: +z zeigt nach vorne, x zur Seite.
export function formationSlots(count: number, spacing: number = FORMATION_SPACING): { x: number; z: number }[] {
  if (count <= 0) return [];
  const cols = formationWidth(count);
  const rows = Math.ceil(count / cols);
  const slots: { x: number; z: number }[] = [];
  for (let i = 0; i < count; i++) {
    const row = Math.floor(i / cols);
    const col = i % cols;
    const inRow = Math.min(cols, count - row * cols);
    const x = (col - (inRow - 1) / 2) * spacing;
    const z = ((rows - 1) / 2 - row) * spacing;
    slots.push({ x, z });
  }
  return slots;
}
