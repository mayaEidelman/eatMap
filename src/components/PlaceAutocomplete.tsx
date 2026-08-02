import { useEffect, useRef, useState } from 'react';
import { guessCategoryFromTypes } from '../lib/categories';
import { loadGoogleMaps } from '../lib/googleMaps';
import type { DraftPlace } from '../types';

type PlaceAutocompleteProps = {
  onAdd: (place: DraftPlace) => void;
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
          fields: ['name', 'formatted_address', 'geometry', 'types'],
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
