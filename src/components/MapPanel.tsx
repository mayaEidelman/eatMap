import { useEffect, useRef, useState } from 'react';
import { loadGoogleMaps } from '../lib/googleMaps';
import type { TripList } from '../types';

type MapPanelProps = {
  lists: TripList[];
  selectedListId: string;
  onSelectList: (listId: string) => void;
};

const defaultCenter = { lat: 20, lng: 0 };
const defaultZoom = 2;

const MARKER_COLORS = ['#f97316', '#2563eb', '#14b8a6', '#7c3aed', '#ea580c', '#0ea5e9'];

function colorForList(listId: string, lists: TripList[]) {
  const index = lists.findIndex((list) => list.id === listId);
  return MARKER_COLORS[index % MARKER_COLORS.length];
}

export function MapPanel({ lists, selectedListId, onSelectList }: MapPanelProps) {
  const mapRef = useRef<HTMLDivElement | null>(null);
  const mapInstance = useRef<google.maps.Map | null>(null);
  const markers = useRef<google.maps.Marker[]>([]);
  const infoWindow = useRef<google.maps.InfoWindow | null>(null);
  const [mapError, setMapError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

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
          clickableIcons: false,
          styles: MAP_STYLE,
        });
        infoWindow.current = new googleApi.maps.InfoWindow();
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
          icon: {
            path: window.google.maps.SymbolPath.CIRCLE,
            scale: active ? 9 : 6,
            fillColor: color,
            fillOpacity: 1,
            strokeColor: '#ffffff',
            strokeWeight: 2,
          },
          zIndex: active ? 999 : 1,
        });

        marker.addListener('click', () => {
          onSelectList(list.id);
          infoWindow.current?.setContent(`
            <div class="map-popup">
              <strong>${placeItem.name}</strong>
              <span>${list.title} · ${list.location}, ${list.country}</span>
              <p>${placeItem.address}</p>
            </div>
          `);
          infoWindow.current?.open({ map, anchor: marker });
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
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
];
