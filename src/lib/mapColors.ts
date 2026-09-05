/** Shared between the map (marker color) and the list composer (color picker), so a list's
 * chosen color and its on-map appearance always agree. */
export const LIST_MARKER_COLORS = [
  '#f97316',
  '#2563eb',
  '#14b8a6',
  '#7c3aed',
  '#ea580c',
  '#0ea5e9',
  '#dc2626',
  '#65a30d',
];

/** Falls back to a palette color derived from the list's position, for lists saved before a
 * `color` column existed. */
export function defaultColorForIndex(index: number): string {
  return LIST_MARKER_COLORS[index % LIST_MARKER_COLORS.length];
}
