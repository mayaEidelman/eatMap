import { useEffect, useRef, useState } from 'react';
import { CATEGORY_META, guessCategoryFromTypes } from '../lib/categories';
import { loadGoogleMaps } from '../lib/googleMaps';
import { defaultColorForIndex } from '../lib/mapColors';
import { fetchPlaceDetails } from '../lib/placeDetails';
import type { PlaceSearchResult } from './PlaceAutocomplete';
import type { TripList } from '../types';

type MapPanelProps = {
  lists: TripList[];
  selectedListId: string;
  onSelectList: (listId: string) => void;
  /** A place the user just searched for but hasn't saved to a list yet -- shown as a
   * distinct marker so search feels immediate, the way Google Maps itself drops a pin. */
  previewPlace?: PlaceSearchResult | null;
  /** Fired when the Save button inside the preview pin's info window is clicked. */
  onSavePreviewPlace?: () => void;
  /** Fired when the preview pin's info window is closed (its own × button). */
  onDismissPreviewPlace?: () => void;
  /** Fired when the user clicks one of Google's own built-in place icons on the map --
   * hands back the same shape a search result produces, so the caller can treat it identically
   * (e.g. wire it straight to the same handler used for the search box). */
  onDiscoverPlace?: (place: PlaceSearchResult) => void;
};

const defaultCenter = { lat: 20, lng: 0 };
const defaultZoom = 2;

function colorForList(listId: string, lists: TripList[]) {
  const list = lists.find((item) => item.id === listId);
  if (list?.color) {
    return list.color;
  }

  const index = lists.findIndex((item) => item.id === listId);
  return defaultColorForIndex(index);
}

/** InfoWindow content is raw HTML, not JSX -- anything interpolated into it (list titles, place
 * names/addresses) can originate from another user's data, so it has to be escaped by hand to
 * avoid a stored-XSS hole. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function starString(rating: number): string {
  const rounded = Math.round(rating);
  return '★'.repeat(rounded) + '☆'.repeat(Math.max(0, 5 - rounded));
}

type PlaceCardDetails = {
  name: string;
  address: string;
  subtitle?: string;
  rating?: number;
  userRatingsTotal?: number;
  priceLevel?: number;
  openNow?: boolean;
  photoUrls?: string[];
  mapsUrl?: string;
  website?: string;
  phone?: string;
};

/** Shared by both the "just searched" preview pin and a click on an already-saved pin, so the
 * two look identical whenever the same Google data is available for both. */
function buildPlaceCardHtml(details: PlaceCardDetails, saveButtonId?: string): string {
  const photoHtml =
    details.photoUrls && details.photoUrls.length > 0
      ? `<div class="map-popup__photos">
          ${details.photoUrls.map((url) => `<img class="map-popup__photo" src="${escapeHtml(url)}" alt="" />`).join('')}
        </div>`
      : '';

  const subtitleHtml = details.subtitle ? `<span>${escapeHtml(details.subtitle)}</span>` : '';

  const ratingHtml = details.rating
    ? `<div class="map-popup__meta">
        <span class="map-popup__stars">${starString(details.rating)}</span>
        <span>${details.rating.toFixed(1)}${details.userRatingsTotal ? ` (${details.userRatingsTotal})` : ''}</span>
        ${details.priceLevel ? `<span>· ${'$'.repeat(details.priceLevel)}</span>` : ''}
      </div>`
    : '';

  const openNowHtml =
    details.openNow === undefined
      ? ''
      : `<span class="map-popup__open-badge ${details.openNow ? 'map-popup__open-badge--open' : 'map-popup__open-badge--closed'}">${
          details.openNow ? 'Open now' : 'Closed now'
        }</span>`;

  // Google's public Places API has no "menu" or "reservation link" field -- linking out to the
  // real Google Maps listing and the business's own site (which usually has the menu) is the
  // honest way to get someone to that information instead of faking a field that doesn't exist.
  const links: string[] = [];
  if (details.mapsUrl) {
    links.push(`<a href="${escapeHtml(details.mapsUrl)}" target="_blank" rel="noopener noreferrer">View on Google Maps</a>`);
  }
  if (details.website) {
    links.push(`<a href="${escapeHtml(details.website)}" target="_blank" rel="noopener noreferrer">Website</a>`);
  }
  if (details.phone) {
    links.push(`<a href="tel:${escapeHtml(details.phone)}">${escapeHtml(details.phone)}</a>`);
  }
  const linksHtml = links.length > 0 ? `<div class="map-popup__links">${links.join('<span>·</span>')}</div>` : '';

  const saveButtonHtml = saveButtonId
    ? `<button type="button" id="${saveButtonId}" class="map-popup__save-button">Save to a list</button>`
    : '';

  return `
    <div class="map-popup map-popup--preview">
      ${photoHtml}
      <strong>${escapeHtml(details.name)}</strong>
      ${subtitleHtml}
      ${ratingHtml}
      <p>${escapeHtml(details.address)}</p>
      ${openNowHtml}
      ${linksHtml}
      ${saveButtonHtml}
    </div>
  `;
}

const PLACE_DETAILS_FIELDS = [
  'photos',
  'rating',
  'user_ratings_total',
  'price_level',
  'opening_hours',
  'url',
  'website',
  'formatted_phone_number',
];

export function MapPanel({
  lists,
  selectedListId,
  onSelectList,
  previewPlace,
  onSavePreviewPlace,
  onDismissPreviewPlace,
  onDiscoverPlace,
}: MapPanelProps) {
  const mapRef = useRef<HTMLDivElement | null>(null);
  const mapInstance = useRef<google.maps.Map | null>(null);
  const markers = useRef<google.maps.Marker[]>([]);
  const previewMarker = useRef<google.maps.Marker | null>(null);
  const infoWindow = useRef<google.maps.InfoWindow | null>(null);
  const placesService = useRef<google.maps.places.PlacesService | null>(null);
  /** Bumped every time a popup opens; an in-flight `getDetails` call only applies its result if
   * this hasn't moved on to a different popup by the time it resolves. */
  const openRequestId = useRef(0);
  const [mapError, setMapError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  // Kept in refs (rather than effect deps) so the Google-native listeners below -- attached once
  // on mount, or re-attached only when the preview place itself changes -- always call the
  // latest callback instead of whichever one was in scope when the listener was first added.
  const onSavePreviewPlaceRef = useRef(onSavePreviewPlace);
  const onDismissPreviewPlaceRef = useRef(onDismissPreviewPlace);
  const onDiscoverPlaceRef = useRef(onDiscoverPlace);
  useEffect(() => {
    onSavePreviewPlaceRef.current = onSavePreviewPlace;
    onDismissPreviewPlaceRef.current = onDismissPreviewPlace;
    onDiscoverPlaceRef.current = onDiscoverPlace;
  });

  useEffect(() => {
    let cancelled = false;

    loadGoogleMaps()
      .then((googleApi) => {
        if (cancelled || !mapRef.current || mapInstance.current) {
          return;
        }

        mapInstance.current = new googleApi.maps.Map(mapRef.current, {
          center: defaultCenter,
          zoom: defaultZoom,
          disableDefaultUI: true,
          zoomControl: true,
          clickableIcons: true,
          styles: MAP_STYLE,
        });
        infoWindow.current = new googleApi.maps.InfoWindow();
        infoWindow.current.addListener('closeclick', () => onDismissPreviewPlaceRef.current?.());
        placesService.current = new googleApi.maps.places.PlacesService(mapInstance.current);

        // Google's own POI icons (restaurants, shops, attractions) are now visible on the base
        // map. Clicking one normally opens Google's own unstylable mini-card -- intercept it via
        // `event.placeId` instead, fetch the same rich details as a search result, and hand it to
        // `onDiscoverPlace` so the caller can treat "found by clicking a POI" identically to
        // "found by searching."
        mapInstance.current.addListener('click', (event: google.maps.MapMouseEvent | google.maps.IconMouseEvent) => {
          if (!('placeId' in event) || !event.placeId || !placesService.current) {
            return;
          }

          event.stop();
          const placeId = event.placeId;
          const requestId = ++openRequestId.current;

          placesService.current.getDetails(
            { placeId, fields: [...PLACE_DETAILS_FIELDS, 'name', 'formatted_address', 'geometry', 'types'] },
            (result, status) => {
              const isCurrent = requestId === openRequestId.current;
              const ok = status === window.google.maps.places.PlacesServiceStatus.OK;
              const location = result?.geometry?.location;
              if (!isCurrent || !ok || !result || !location) {
                return;
              }

              onDiscoverPlaceRef.current?.({
                id: crypto.randomUUID(),
                name: result.name ?? 'Selected place',
                address: result.formatted_address ?? '',
                lat: location.lat(),
                lng: location.lng(),
                category: guessCategoryFromTypes(result.types),
                rating: result.rating,
                userRatingsTotal: result.user_ratings_total,
                priceLevel: result.price_level,
                openNow: result.opening_hours?.open_now,
                photoUrls: result.photos?.slice(0, 4).map((photo) => photo.getUrl({ maxWidth: 400, maxHeight: 300 })),
                mapsUrl: result.url,
                website: result.website,
                phone: result.formatted_phone_number,
                googlePlaceId: placeId,
              });
            },
          );
        });

        setReady(true);
      })
      .catch((error: Error) => {
        if (!cancelled) {
          setMapError(error.message);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const map = mapInstance.current;
    if (!ready || !map || !window.google) {
      return;
    }

    markers.current.forEach((marker) => marker.setMap(null));
    markers.current = [];

    const bounds = new window.google.maps.LatLngBounds();
    let hasPoints = false;

    lists.forEach((list) => {
      const active = list.id === selectedListId;
      const color = colorForList(list.id, lists);

      list.places.forEach((placeItem) => {
        const position = { lat: placeItem.lat, lng: placeItem.lng };
        const marker = new window.google.maps.Marker({
          position,
          map,
          title: `${placeItem.name} — ${list.title}`,
          // Bigger than Google's own POI icons and carrying a category emoji + the list's chosen
          // color, so these read as clearly distinct from the native icons now sharing the map.
          icon: {
            path: window.google.maps.SymbolPath.CIRCLE,
            scale: active ? 15 : 12,
            fillColor: color,
            fillOpacity: 1,
            strokeColor: '#ffffff',
            strokeWeight: 2,
          },
          label: {
            text: CATEGORY_META[placeItem.category].icon,
            fontSize: active ? '15px' : '12px',
          },
          zIndex: active ? 999 : 1,
        });

        marker.addListener('click', () => {
          onSelectList(list.id);

          const subtitle = `${list.title} · ${list.location}, ${list.country}`;
          infoWindow.current?.setContent(buildPlaceCardHtml({ name: placeItem.name, address: placeItem.address, subtitle }));
          infoWindow.current?.open({ map, anchor: marker });

          const requestId = ++openRequestId.current;
          if (placeItem.googlePlaceId) {
            fetchPlaceDetails(placeItem.googlePlaceId).then((details) => {
              const isCurrent = requestId === openRequestId.current;
              if (!isCurrent || !details) {
                return;
              }

              infoWindow.current?.setContent(
                buildPlaceCardHtml({
                  name: placeItem.name,
                  address: placeItem.address,
                  subtitle,
                  ...details,
                }),
              );
            });
          }
        });

        markers.current.push(marker);
        bounds.extend(position);
        hasPoints = true;
      });
    });

    const selected = lists.find((list) => list.id === selectedListId);
    if (selected && selected.places.length) {
      const selectedBounds = new window.google.maps.LatLngBounds();
      selected.places.forEach((placeItem) => selectedBounds.extend({ lat: placeItem.lat, lng: placeItem.lng }));
      map.fitBounds(selectedBounds, 80);
      if (selected.places.length === 1) {
        map.setZoom(13);
      }
    } else if (hasPoints) {
      map.fitBounds(bounds, 60);
    } else {
      map.setCenter(defaultCenter);
      map.setZoom(defaultZoom);
    }
  }, [lists, selectedListId, onSelectList, ready]);

  useEffect(() => {
    const map = mapInstance.current;
    if (!ready || !map || !window.google) {
      return;
    }

    if (!previewPlace) {
      previewMarker.current?.setMap(null);
      previewMarker.current = null;
      return;
    }

    const position = { lat: previewPlace.lat, lng: previewPlace.lng };

    if (previewMarker.current) {
      previewMarker.current.setPosition(position);
    } else {
      previewMarker.current = new window.google.maps.Marker({
        position,
        map,
        title: previewPlace.name,
        animation: window.google.maps.Animation.DROP,
        icon: {
          path: window.google.maps.SymbolPath.CIRCLE,
          scale: 10,
          fillColor: '#dc2626',
          fillOpacity: 1,
          strokeColor: '#ffffff',
          strokeWeight: 3,
        },
        zIndex: 1000,
      });
    }

    openRequestId.current += 1;

    infoWindow.current?.setContent(
      buildPlaceCardHtml(
        {
          name: previewPlace.name,
          address: previewPlace.address,
          rating: previewPlace.rating,
          userRatingsTotal: previewPlace.userRatingsTotal,
          priceLevel: previewPlace.priceLevel,
          openNow: previewPlace.openNow,
          photoUrls: previewPlace.photoUrls,
          mapsUrl: previewPlace.mapsUrl,
          website: previewPlace.website,
          phone: previewPlace.phone,
        },
        'map-popup-save-btn',
      ),
    );
    infoWindow.current?.open({ map, anchor: previewMarker.current });

    if (infoWindow.current) {
      window.google.maps.event.clearListeners(infoWindow.current, 'domready');
      infoWindow.current.addListener('domready', () => {
        document.getElementById('map-popup-save-btn')?.addEventListener('click', () => {
          onSavePreviewPlaceRef.current?.();
        });
      });
    }

    map.panTo(position);
    map.setZoom(15);
  }, [previewPlace, ready]);

  return (
    <div className="map-panel">
      {mapError ? (
        <div className="map-panel__error">
          <strong>Map can't load.</strong>
          <p>{mapError}</p>
        </div>
      ) : (
        <div ref={mapRef} className="google-map" aria-label="Trip map" />
      )}
    </div>
  );
}

const MAP_STYLE: google.maps.MapTypeStyle[] = [
  { elementType: 'geometry', stylers: [{ color: '#f6f1e8' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#f6f1e8' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#64748b' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#cfe0f7' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#ffffff' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
];
