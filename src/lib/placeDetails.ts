import { MAX_PLACE_PHOTOS } from './config';
import { loadGoogleMaps } from './googleMaps';

export type PlaceDetails = {
  rating?: number;
  userRatingsTotal?: number;
  priceLevel?: number;
  openNow?: boolean;
  photoUrls?: string[];
  mapsUrl?: string;
  website?: string;
  phone?: string;
};

const DETAILS_FIELDS = [
  'photos',
  'rating',
  'user_ratings_total',
  'price_level',
  'opening_hours',
  'url',
  'website',
  'formatted_phone_number',
];

let servicePromise: Promise<google.maps.places.PlacesService> | null = null;

function getService(): Promise<google.maps.places.PlacesService> {
  if (!servicePromise) {
    // PlacesService accepts a plain div in place of a live Map -- there's no map on screen
    // wherever this is called from (e.g. the list-detail modal), so a detached node is enough.
    servicePromise = loadGoogleMaps().then((googleApi) => new googleApi.maps.places.PlacesService(document.createElement('div')));
  }
  return servicePromise;
}

// Places Details (and especially Places Photo, billed per image loaded) calls are billed with no
// free-call cushion as generous as e.g. Autocomplete -- re-clicking the same marker twice in a
// session used to mean two full Details+Photo round trips for identical data. A simple in-memory
// cache keyed by place id kills that for the lifetime of the tab; it's intentionally *not*
// persisted to localStorage like travel time is, since a `photo.getUrl()` result can rotate with
// the underlying photo reference and shouldn't be trusted to still be valid after a reload.
const detailsCache = new Map<string, PlaceDetails | null>();

/** Fetches the same "enrichment" fields MapPanel shows on a marker click/preview -- rating,
 * photos, hours, links -- for a Google place by id. Returns null if the place has no id, or the
 * lookup fails. */
export async function fetchPlaceDetails(placeId: string | undefined): Promise<PlaceDetails | null> {
  if (!placeId) {
    return null;
  }

  if (detailsCache.has(placeId)) {
    return detailsCache.get(placeId) ?? null;
  }

  const service = await getService();

  return new Promise((resolve) => {
    service.getDetails({ placeId, fields: DETAILS_FIELDS }, (result, status) => {
      if (status !== window.google.maps.places.PlacesServiceStatus.OK || !result) {
        detailsCache.set(placeId, null);
        resolve(null);
        return;
      }

      const details: PlaceDetails = {
        rating: result.rating,
        userRatingsTotal: result.user_ratings_total,
        priceLevel: result.price_level,
        openNow: result.opening_hours?.open_now,
        photoUrls: result.photos?.slice(0, MAX_PLACE_PHOTOS).map((photo) => photo.getUrl({ maxWidth: 400, maxHeight: 300 })),
        mapsUrl: result.url,
        website: result.website,
        phone: result.formatted_phone_number,
      };
      detailsCache.set(placeId, details);
      resolve(details);
    });
  });
}
