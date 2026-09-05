import { useEffect, useRef, useState } from 'react';
import { guessCategoryFromTypes } from '../lib/categories';
import { loadGoogleMaps } from '../lib/googleMaps';
import type { DraftPlace } from '../types';

/** A place straight from Google's Autocomplete, before it's ever saved anywhere. The extra
 * fields here are display-only -- `savePlacesAndDays` only ever persists the plain `DraftPlace`
 * columns, so nothing here needs a database column of its own. */
export type PlaceSearchResult = DraftPlace & {
  rating?: number;
  userRatingsTotal?: number;
  priceLevel?: number;
  openNow?: boolean;
  photoUrls?: string[];
  /** Google's own page for this place -- the honest way to surface reservations/menus, since
   * neither is a field the public Places API actually exposes (see PlaceAutocomplete usage). */
  mapsUrl?: string;
  website?: string;
  phone?: string;
};

type PlaceAutocompleteProps = {
  onAdd: (place: PlaceSearchResult) => void;
};

export function PlaceAutocomplete({ onAdd }: PlaceAutocompleteProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const autocompleteRef = useRef<google.maps.places.Autocomplete | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    loadGoogleMaps()
      .then((googleApi) => {
        if (cancelled || !inputRef.current || autocompleteRef.current) {
          return;
        }

        const autocomplete = new googleApi.maps.places.Autocomplete(inputRef.current, {
          fields: [
            'name',
            'formatted_address',
            'geometry',
            'types',
            'photos',
            'rating',
            'user_ratings_total',
            'price_level',
            'opening_hours',
            'url',
            'website',
            'formatted_phone_number',
            'place_id',
          ],
        });

        autocomplete.addListener('place_changed', () => {
          const place = autocomplete.getPlace();
          const location = place.geometry?.location;
          if (!location) {
            return;
          }

          onAdd({
            id: crypto.randomUUID(),
            name: place.name ?? place.formatted_address ?? 'Saved place',
            address: place.formatted_address ?? '',
            lat: location.lat(),
            lng: location.lng(),
            category: guessCategoryFromTypes(place.types),
            rating: place.rating,
            userRatingsTotal: place.user_ratings_total,
            priceLevel: place.price_level,
            openNow: place.opening_hours?.open_now,
            photoUrls: place.photos?.slice(0, 4).map((photo) => photo.getUrl({ maxWidth: 400, maxHeight: 300 })),
            mapsUrl: place.url,
            website: place.website,
            phone: place.formatted_phone_number,
            googlePlaceId: place.place_id,
          });

          if (inputRef.current) {
            inputRef.current.value = '';
          }
        });

        autocompleteRef.current = autocomplete;
      })
      .catch((loadError: Error) => {
        if (!cancelled) {
          setError(loadError.message);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [onAdd]);

  return (
    <label className="place-autocomplete">
      <span>Search and add a place</span>
      <input ref={inputRef} type="text" placeholder="Search a restaurant, viewpoint, or address..." disabled={Boolean(error)} />
      {error ? <small className="place-autocomplete__error">{error}</small> : null}
    </label>
  );
}
