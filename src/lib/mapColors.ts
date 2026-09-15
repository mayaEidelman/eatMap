/** Shared between the map (marker color) and the list composer (color picker), so a list's
 * chosen color and its on-map appearance always agree. Soft, dusty/muted tones (the top,
 * most-saturated shade of a muted moodboard-style family) rather than vivid flat-UI colors --
 * still spaced around the color wheel so adjacent lists/pins stay easy to tell apart, and dark
 * enough for the white text/icons layered on top (marker labels, timeline time badges) to stay
 * legible. */
export const LIST_MARKER_COLORS = [
  '#5f8676', // dusty teal
  '#c97a56', // terracotta
  '#7f9159', // sage olive
  '#6c8ba3', // dusty blue
  '#bc7883', // dusty rose
  '#b3946a', // sand
  '#b8931f', // muted mustard
  '#8a6482', // muted plum
];

/** Falls back to a palette color derived from the list's position, for lists saved before a
 * `color` column existed. */
export function defaultColorForIndex(index: number): string {
  return LIST_MARKER_COLORS[index % LIST_MARKER_COLORS.length];
}
