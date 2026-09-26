import { useEffect, useRef, useState } from 'react';
import { CATEGORY_META, guessCategoryFromTypes } from '../lib/categories';
import { getCurrentPosition } from '../lib/geolocation';
import { loadGoogleMaps } from '../lib/googleMaps';
import { defaultColorForIndex } from '../lib/mapColors';
import { fetchPlaceDetails } from '../lib/placeDetails';
import type { PlaceSearchResult } from './PlaceAutocomplete';
import type { TripList } from '../types';

/** DOM id for whichever popup's bookmark/save button is currently rendered -- only one popup is
 * ever open at a time (they all share the single `infoWindow` instance below), so every place
 * that can open one (preview pin, native POI, an already-saved marker) reuses the same id rather
 * than needing its own. */
const SAVE_BUTTON_ID = 'map-popup-save-btn';

type MapPanelProps = {
  lists: TripList[];
  selectedListId: string;
  onSelectList: (listId: string) => void;
  /** A place the user just searched for but hasn't saved to a list yet -- shown as a
   * distinct marker so search feels immediate, the way Google Maps itself drops a pin. */
  previewPlace?: PlaceSearchResult | null;
  /** Whether `previewPlace` already exists in one of the current user's own lists -- drives
   * the save icon's filled/outline state in the preview pin's info window. */
  previewPlaceSaved?: boolean;
  /** Fired when the Save button inside the preview pin's info window is clicked. */
  onSavePreviewPlace?: () => void;
  /** Fired when the preview pin's info window is closed (its own × button). */
  onDismissPreviewPlace?: () => void;
  /** Fired when the user clicks one of Google's own built-in place icons on the map --
   * hands back the same shape a search result produces, so the caller can treat it identically
   * (e.g. wire it straight to the same handler used for the search box). */
  onDiscoverPlace?: (place: PlaceSearchResult) => void;
  /** While true, clicking a marker that belongs to the selected list toggles its selection
   * (for grouping places into a trip day) instead of opening its info window. Markers for other
   * lists keep their normal click behavior either way. */
  selectMode?: boolean;
  selectedPlaceIds?: Set<string>;
  onTogglePlaceSelect?: (placeId: string) => void;
  /** Places to render faded (lower opacity, thinner outline) instead of at full strength --
   * used to keep a trip day's own places easy to pick out while the rest of the list's places
   * stay visible on the map for context rather than being hidden outright. */
  dimmedPlaceIds?: Set<string>;
  /** Id of a place to pan/zoom the map to and "click" open, paired with focusRequestToken so a
   * repeat click on the same place (token bumped, id unchanged) still re-triggers it -- same
   * counter-prop pattern as locateRequestToken below. */
  focusPlaceId?: string | null;
  focusRequestToken?: number;
  /** Bump this (e.g. a counter incremented on button click) to trigger a one-time "locate me" --
   * pans/zooms to the device's current position and drops a "you are here" marker. A counter prop
   * rather than an imperative ref method, to match how `previewPlace` etc. already drive this
   * component from AppShell. Swapping the one-shot `getCurrentPosition` call this triggers for
   * `watchPosition` (live tracking) later only touches the effect below, not this prop's shape. */
  locateRequestToken?: number;
  /** Fired when a locate request (see `locateRequestToken`) fails -- permission denied, position
   * unavailable, etc. -- so the caller can surface it near whatever button triggered it. */
  onLocationError?: (message: string) => void;
};

const defaultCenter = { lat: 20, lng: 0 };
const defaultZoom = 2;

/** Google's world map is exactly `256 * 2^zoom` pixels square at a given zoom level. Zooming out
 * past the point where that's smaller than the map's own container leaves gray padding around the
 * edges -- which shows up more the bigger/wider the screen (a 3000px-wide monitor runs out of
 * world well before a phone does). Picking minZoom off the container's actual size, rather than a
 * fixed constant, keeps "zoomed all the way out" edge-to-edge on every screen. */
function computeMinZoom(containerWidth: number, containerHeight: number): number {
  const longestSide = Math.max(containerWidth, containerHeight, 1);
  const zoomForFullWorld = Math.log2(longestSide / 256);
  return Math.max(2, Math.ceil(zoomForFullWorld));
}

/** Google's own saved-place pins shrink at low zoom (country/world view, lots of pins crowded
 * together) and grow back to full size once zoomed into a city/neighborhood -- our markers stayed
 * a constant size regardless, which made a zoomed-out trip look far more cluttered/heavy than the
 * same map in the actual Google Maps app. Returns a 0-1 multiplier to scale a marker's base size
 * by, given the map's current zoom level. */
function zoomScaleFactor(zoom: number): number {
  const minZoom = 4; // country/continent view -- markers at their smallest
  const maxZoom = 12; // city/neighborhood view and closer -- full size
  const minFactor = 0.5;
  const t = Math.min(1, Math.max(0, (zoom - minZoom) / (maxZoom - minZoom)));
  return minFactor + (1 - minFactor) * t;
}

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
  notes?: string;
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
function buildPlaceCardHtml(details: PlaceCardDetails, saveButtonId?: string, saved?: boolean): string {
  const photoHtml =
    details.photoUrls && details.photoUrls.length > 0
      ? `<div class="map-popup__photos">
          ${details.photoUrls.map((url) => `<img class="map-popup__photo" src="${escapeHtml(url)}" alt="" />`).join('')}
        </div>`
      : '';

  const ratingHtml = details.rating
    ? `<div class="map-popup__meta">
        <span class="map-popup__stars">${starString(details.rating)}</span>
        <span>${details.rating.toFixed(1)}${details.userRatingsTotal ? ` (${details.userRatingsTotal})` : ''}</span>
        ${details.priceLevel ? `<span>· ${'$'.repeat(details.priceLevel)}</span>` : ''}
      </div>`
    : '';

  const notesHtml = details.notes ? `<p class="map-popup__notes">📝 ${escapeHtml(details.notes)}</p>` : '';

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

  // A bookmark icon like Google Maps' own save button -- outlined when this place hasn't been
  // saved to any of your lists yet, filled solid once it has.
  const saveButtonHtml = saveButtonId
    ? `<button
        type="button"
        id="${saveButtonId}"
        class="map-popup__save-icon${saved ? ' map-popup__save-icon--active' : ''}"
        aria-label="${saved ? 'Already saved to a list' : 'Save to a list'}"
        aria-pressed="${saved ? 'true' : 'false'}"
        title="${saved ? 'Already saved to a list' : 'Save to a list'}"
      >
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
          <path
            d="M6 3a2 2 0 0 0-2 2v16l8-5 8 5V5a2 2 0 0 0-2-2H6z"
            fill="${saved ? 'currentColor' : 'none'}"
            stroke="currentColor"
            stroke-width="2"
            stroke-linejoin="round"
          />
        </svg>
      </button>`
    : '';

  return `
    <div class="map-popup map-popup--preview">
      ${photoHtml}
      <div class="map-popup__header">
        <strong>${escapeHtml(details.name)}</strong>
        ${saveButtonHtml}
      </div>
      ${ratingHtml}
      <p>${escapeHtml(details.address)}</p>
      ${notesHtml}
      ${openNowHtml}
      ${linksHtml}
    </div>
  `;
}

export function MapPanel({
  lists,
  selectedListId,
  onSelectList,
  previewPlace,
  previewPlaceSaved,
  onSavePreviewPlace,
  onDismissPreviewPlace,
  onDiscoverPlace,
  selectMode,
  selectedPlaceIds,
  onTogglePlaceSelect,
  dimmedPlaceIds,
  focusPlaceId,
  focusRequestToken,
  locateRequestToken,
  onLocationError,
}: MapPanelProps) {
  const mapRef = useRef<HTMLDivElement | null>(null);
  const mapInstance = useRef<google.maps.Map | null>(null);
  const markers = useRef<google.maps.Marker[]>([]);
  const markersByPlaceId = useRef<Map<string, google.maps.Marker>>(new Map());
  /** Each marker's un-scaled icon/label/outline size, so the zoom listener below can re-derive
   * "base size × current zoom factor" on every zoom change without needing to rebuild the markers
   * themselves. */
  const markerBaseSize = useRef<Map<google.maps.Marker, { scale: number; fontSize: number; strokeWeight: number }>>(
    new Map(),
  );
  const previewMarker = useRef<google.maps.Marker | null>(null);
  const userLocationMarker = useRef<google.maps.Marker | null>(null);
  const userLocationAccuracy = useRef<google.maps.Circle | null>(null);
  const infoWindow = useRef<google.maps.InfoWindow | null>(null);
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
  const onLocationErrorRef = useRef(onLocationError);
  useEffect(() => {
    onSavePreviewPlaceRef.current = onSavePreviewPlace;
    onDismissPreviewPlaceRef.current = onDismissPreviewPlace;
    onDiscoverPlaceRef.current = onDiscoverPlace;
    onLocationErrorRef.current = onLocationError;
  });

  useEffect(() => {
    let cancelled = false;
    let resizeObserver: ResizeObserver | undefined;

    loadGoogleMaps()
      .then((googleApi) => {
        if (cancelled || !mapRef.current || mapInstance.current) {
          return;
        }

        const { width, height } = mapRef.current.getBoundingClientRect();

        mapInstance.current = new googleApi.maps.Map(mapRef.current, {
          center: defaultCenter,
          zoom: defaultZoom,
          minZoom: computeMinZoom(width, height),
          // minZoom alone only stops the world from rendering *smaller* than the container --
          // it doesn't stop the user from dragging the viewport's center up past the map's real
          // north/south edge (Mercator projection has no data past ~85 degrees). `restriction`
          // clamps panning itself so the visible area can never show past the world's actual
          // bounds, which is what was still leaking gray on drag.
          restriction: {
            latLngBounds: { north: 85, south: -85, west: -180, east: 180 },
            strictBounds: true,
          },
          disableDefaultUI: true,
          zoomControl: true,
          clickableIcons: true,
          // Google defaults touch devices to 'cooperative' (two fingers to pan, one finger scrolls
          // the page instead) so an embedded map doesn't hijack page scroll -- but this map *is*
          // the whole page, not embedded in a longer one, so there's nothing for a one-finger drag
          // to conflict with. 'greedy' makes a single finger pan/zoom directly, no "use two fingers"
          // nag overlay.
          gestureHandling: 'greedy',
          styles: MAP_STYLE,
        });

        // Recompute on every resize (window resize, sidebar toggle, orientation change) rather
        // than once at load -- a map that started small (e.g. sidebar open) and then grows must
        // tighten minZoom too, or the world can end up smaller than the now-bigger container.
        resizeObserver = new ResizeObserver((entries) => {
          const entry = entries[0];
          if (!entry || !mapInstance.current) return;
          const { width: nextWidth, height: nextHeight } = entry.contentRect;
          mapInstance.current.setOptions({ minZoom: computeMinZoom(nextWidth, nextHeight) });
        });
        resizeObserver.observe(mapRef.current);

        infoWindow.current = new googleApi.maps.InfoWindow();
        infoWindow.current.addListener('closeclick', () => onDismissPreviewPlaceRef.current?.());

        // Google's own POI icons (restaurants, shops, attractions) are now visible on the base
        // map. Clicking one normally opens Google's own unstylable mini-card -- intercept it via
        // `event.placeId` instead, fetch the same rich details as a search result, and hand it to
        // `onDiscoverPlace` so the caller can treat "found by clicking a POI" identically to
        // "found by searching." Routed through the shared `fetchPlaceDetails` (rather than a
        // one-off `PlacesService.getDetails` call here) so clicking the same POI twice is served
        // from its cache instead of re-billing Details + Photo every time.
        mapInstance.current.addListener('click', (event: google.maps.MapMouseEvent | google.maps.IconMouseEvent) => {
          if (!('placeId' in event) || !event.placeId) {
            return;
          }

          event.stop();
          const placeId = event.placeId;
          const requestId = ++openRequestId.current;

          fetchPlaceDetails(placeId).then((details) => {
            const isCurrent = requestId === openRequestId.current;
            if (!isCurrent || !details || details.lat === undefined || details.lng === undefined) {
              return;
            }

            onDiscoverPlaceRef.current?.({
              id: crypto.randomUUID(),
              name: details.placeName ?? 'Selected place',
              address: details.formattedAddress ?? '',
              lat: details.lat,
              lng: details.lng,
              category: guessCategoryFromTypes(details.types),
              rating: details.rating,
              userRatingsTotal: details.userRatingsTotal,
              priceLevel: details.priceLevel,
              openNow: details.openNow,
              photoUrls: details.photoUrls,
              mapsUrl: details.mapsUrl,
              website: details.website,
              phone: details.phone,
              googlePlaceId: placeId,
            });
          });
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
      resizeObserver?.disconnect();
    };
  }, []);

  useEffect(() => {
    const map = mapInstance.current;
    if (!ready || !map || !window.google) {
      return;
    }

    markers.current.forEach((marker) => marker.setMap(null));
    markers.current = [];
    markersByPlaceId.current = new Map();
    markerBaseSize.current = new Map();

    const zoomFactor = zoomScaleFactor(map.getZoom() ?? defaultZoom);

    lists.forEach((list) => {
      const active = list.id === selectedListId;
      const color = colorForList(list.id, lists);

      list.places.forEach((placeItem) => {
        const position = { lat: placeItem.lat, lng: placeItem.lng };
        const isSelectable = Boolean(selectMode) && active;
        const isSelected = isSelectable && Boolean(selectedPlaceIds?.has(placeItem.id));
        const isDimmed = Boolean(dimmedPlaceIds?.has(placeItem.id));
        const baseScale = isSelected ? 16 : active ? 15 : 12;
        const baseFontSize = active ? 15 : 12;
        const baseStrokeWeight = isSelected ? 3 : isDimmed ? 1 : 2;
        const marker = new window.google.maps.Marker({
          position,
          map,
          title: `${placeItem.name} — ${list.title}`,
          // Bigger than Google's own POI icons and carrying a category emoji + the list's chosen
          // color, so these read as clearly distinct from the native icons now sharing the map.
          // Selected markers (grouping mode) get a green fill + checkmark instead, so which pins
          // are already picked is obvious without opening anything. Places not scheduled into the
          // day currently being viewed are faded (lower fill opacity, thinner outline) rather than
          // hidden, so the day's own places stand out without losing the rest of the trip. Scaled
          // down further at low zoom (see zoomScaleFactor) so a zoomed-out trip doesn't look like a
          // wall of oversized pins the way a constant size would.
          icon: {
            path: window.google.maps.SymbolPath.CIRCLE,
            scale: baseScale * zoomFactor,
            fillColor: isSelected ? '#2f8f5b' : color,
            fillOpacity: isDimmed ? 0.35 : 1,
            strokeColor: '#ffffff',
            strokeOpacity: isDimmed ? 0.6 : 1,
            strokeWeight: Math.max(1, baseStrokeWeight * zoomFactor),
          },
          label: {
            text: isSelected ? '✓' : CATEGORY_META[placeItem.category].icon,
            fontSize: `${Math.max(9, baseFontSize * zoomFactor)}px`,
          },
          zIndex: isSelected ? 1000 : active ? 999 : isDimmed ? 0 : 1,
        });

        marker.addListener('click', () => {
          if (isSelectable) {
            onTogglePlaceSelect?.(placeItem.id);
            return;
          }

          onSelectList(list.id);

          // A saved marker's popup gets the same bookmark button as a freshly-searched/POI preview
          // pin, wired to open the same "Save to list" picker (pre-filled as already-saved, notes
          // editable there) -- previously this popup had no save button at all, so it looked and
          // behaved differently from every other pin on the map for no real reason.
          const openInSaveToListModal = () => {
            onDiscoverPlaceRef.current?.({
              id: placeItem.id,
              name: placeItem.name,
              address: placeItem.address,
              lat: placeItem.lat,
              lng: placeItem.lng,
              category: placeItem.category,
              googlePlaceId: placeItem.googlePlaceId,
              notes: placeItem.notes,
            });
            onSavePreviewPlaceRef.current?.();
          };

          const attachSaveButtonListener = () => {
            if (!infoWindow.current) return;
            window.google.maps.event.clearListeners(infoWindow.current, 'domready');
            infoWindow.current.addListener('domready', () => {
              document.getElementById(SAVE_BUTTON_ID)?.addEventListener('click', openInSaveToListModal);
            });
          };

          infoWindow.current?.setContent(
            buildPlaceCardHtml(
              { name: placeItem.name, address: placeItem.address, notes: placeItem.notes },
              SAVE_BUTTON_ID,
              true,
            ),
          );
          attachSaveButtonListener();
          infoWindow.current?.open({ map, anchor: marker });

          const requestId = ++openRequestId.current;
          if (placeItem.googlePlaceId) {
            fetchPlaceDetails(placeItem.googlePlaceId).then((details) => {
              const isCurrent = requestId === openRequestId.current;
              if (!isCurrent || !details) {
                return;
              }

              infoWindow.current?.setContent(
                buildPlaceCardHtml(
                  {
                    name: placeItem.name,
                    address: placeItem.address,
                    notes: placeItem.notes,
                    ...details,
                  },
                  SAVE_BUTTON_ID,
                  true,
                ),
              );
              attachSaveButtonListener();
            });
          }
        });

        markers.current.push(marker);
        markersByPlaceId.current.set(placeItem.id, marker);
        markerBaseSize.current.set(marker, { scale: baseScale, fontSize: baseFontSize, strokeWeight: baseStrokeWeight });
      });
    });
  }, [lists, selectedListId, onSelectList, ready, selectMode, selectedPlaceIds, onTogglePlaceSelect, dimmedPlaceIds]);

  // Re-scales every current marker's icon/label in place on each zoom change, rather than
  // rebuilding the markers themselves (which would also tear down and reattach every click
  // listener on every zoom tick). Attached once markers can exist, not per-rebuild -- it always
  // reads markers.current/markerBaseSize.current fresh, so it stays correct across rebuilds
  // without needing to be re-attached itself.
  useEffect(() => {
    const map = mapInstance.current;
    if (!ready || !map || !window.google) {
      return;
    }

    const listener = map.addListener('zoom_changed', () => {
      const factor = zoomScaleFactor(map.getZoom() ?? defaultZoom);
      markers.current.forEach((marker) => {
        const base = markerBaseSize.current.get(marker);
        if (!base) return;

        const icon = marker.getIcon();
        if (!icon || typeof icon !== 'object' || !('path' in icon)) return;

        marker.setIcon({ ...icon, scale: base.scale * factor, strokeWeight: Math.max(1, base.strokeWeight * factor) });

        const label = marker.getLabel();
        if (label && typeof label === 'object') {
          marker.setLabel({ ...label, fontSize: `${Math.max(9, base.fontSize * factor)}px` });
        }
      });
    });

    return () => listener.remove();
  }, [ready]);

  // Sidebar timeline entries are clickable -- this re-runs the same "open this marker" behavior
  // the marker's own click listener above uses, so a sidebar click and a direct map tap on the
  // pin land on identical behavior (select its list, pan in, open the info window).
  useEffect(() => {
    const map = mapInstance.current;
    if (!ready || !map || !window.google || !focusPlaceId) {
      return;
    }

    const marker = markersByPlaceId.current.get(focusPlaceId);
    const position = marker?.getPosition();
    if (!marker || !position) {
      return;
    }

    map.panTo(position);
    if ((map.getZoom() ?? 0) < 15) {
      map.setZoom(15);
    }
    window.google.maps.event.trigger(marker, 'click');
    // focusRequestToken isn't read here -- it only exists so a repeat click on the same place
    // (id unchanged, token bumped) still re-triggers this effect.
  }, [focusPlaceId, focusRequestToken, ready]);

  // Split out from marker rebuilding above so toggling a place's selection (which also rebuilds
  // markers, to recolor the clicked pin) never re-fits/re-zooms the viewport -- only an actual
  // list switch or the underlying place data changing should move the camera.
  useEffect(() => {
    const map = mapInstance.current;
    if (!ready || !map || !window.google) {
      return;
    }

    const bounds = new window.google.maps.LatLngBounds();
    let hasPoints = false;
    lists.forEach((list) => {
      list.places.forEach((placeItem) => {
        bounds.extend({ lat: placeItem.lat, lng: placeItem.lng });
        hasPoints = true;
      });
    });

    const selected = lists.find((list) => list.id === selectedListId);
    if (selected && selected.places.length) {
      // Faded (dimmed) places stay on the map for context but shouldn't pull the camera's fit
      // wide to include them -- zoom in on whichever places are currently highlighted, falling
      // back to the full list only if every one of its places happens to be dimmed.
      const highlightedPlaces = selected.places.filter((placeItem) => !dimmedPlaceIds?.has(placeItem.id));
      const placesToFit = highlightedPlaces.length ? highlightedPlaces : selected.places;
      const selectedBounds = new window.google.maps.LatLngBounds();
      placesToFit.forEach((placeItem) => selectedBounds.extend({ lat: placeItem.lat, lng: placeItem.lng }));
      map.fitBounds(selectedBounds, 80);
      if (placesToFit.length === 1) {
        map.setZoom(13);
      }
    } else if (hasPoints) {
      map.fitBounds(bounds, 60);
    } else {
      map.setCenter(defaultCenter);
      map.setZoom(defaultZoom);
    }
  }, [lists, selectedListId, ready, dimmedPlaceIds]);

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
          notes: previewPlace.notes,
          rating: previewPlace.rating,
          userRatingsTotal: previewPlace.userRatingsTotal,
          priceLevel: previewPlace.priceLevel,
          openNow: previewPlace.openNow,
          photoUrls: previewPlace.photoUrls,
          mapsUrl: previewPlace.mapsUrl,
          website: previewPlace.website,
          phone: previewPlace.phone,
        },
        SAVE_BUTTON_ID,
        previewPlaceSaved,
      ),
    );
    infoWindow.current?.open({ map, anchor: previewMarker.current });

    if (infoWindow.current) {
      window.google.maps.event.clearListeners(infoWindow.current, 'domready');
      infoWindow.current.addListener('domready', () => {
        document.getElementById(SAVE_BUTTON_ID)?.addEventListener('click', () => {
          onSavePreviewPlaceRef.current?.();
        });
      });
    }

    map.panTo(position);
    // 15 was close to street-level (a block or two of context around the pin) -- 14 keeps the pin
    // clearly centered while leaving enough of the surrounding area visible to actually orient
    // yourself, which also makes it easier to line up the next tap (the bookmark icon in the
    // popup) without the map having jumped in tight right before it.
    map.setZoom(14);
  }, [previewPlace, previewPlaceSaved, ready]);

  // `locateRequestToken` starts undefined/0, which is falsy, so this is a no-op until the caller
  // actually bumps it (e.g. on a "locate me" button click) -- never fires on mount by itself.
  useEffect(() => {
    const map = mapInstance.current;
    if (!ready || !map || !window.google || !locateRequestToken) {
      return;
    }

    getCurrentPosition()
      .then((position) => {
        map.panTo(position);
        if ((map.getZoom() ?? 0) < 14) {
          map.setZoom(15);
        }

        if (userLocationMarker.current) {
          userLocationMarker.current.setPosition(position);
        } else {
          userLocationMarker.current = new window.google.maps.Marker({
            position,
            map,
            title: 'Your location',
            zIndex: 1001,
            icon: {
              path: window.google.maps.SymbolPath.CIRCLE,
              scale: 8,
              fillColor: '#4285f4',
              fillOpacity: 1,
              strokeColor: '#ffffff',
              strokeWeight: 3,
            },
          });
        }

        if (userLocationAccuracy.current) {
          userLocationAccuracy.current.setCenter(position);
          userLocationAccuracy.current.setRadius(position.accuracy);
        } else {
          userLocationAccuracy.current = new window.google.maps.Circle({
            map,
            center: position,
            radius: position.accuracy,
            fillColor: '#4285f4',
            fillOpacity: 0.15,
            strokeColor: '#4285f4',
            strokeOpacity: 0.35,
            strokeWeight: 1,
          });
        }
      })
      .catch((error: Error) => {
        onLocationErrorRef.current?.(error.message);
      });
  }, [locateRequestToken, ready]);

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
