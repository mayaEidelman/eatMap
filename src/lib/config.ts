/** Small app-wide knobs that are more "flip this one number" than a real feature flag system --
 * things worth adjusting in a hurry without hunting through the call sites that use them. */

/** Photos fetched per place (map popups, the place preview modal, and search results). Each one
 * loaded is a billed Google "Places Photo" request, so this is the first thing to turn down if
 * that starts costing real money -- try 1, or 0 to stop fetching photos entirely. */
export const MAX_PLACE_PHOTOS = 0;
