import { guessCategoryFromTypes } from './categories';
import type { DraftPlace } from '../types';

export type ImportRow = {
  label: string;
  place: DraftPlace | null;
};

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') {
        i++;
      }
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((cells) => cells.some((cell) => cell.trim().length > 0));
}

export function extractPlaceIdFromUrl(url: string): string | null {
  const match = url.match(/[?&](?:query_place_id|place_id)=([^&]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

let placesServiceInstance: google.maps.places.PlacesService | null = null;

function getPlacesService(googleApi: typeof google): google.maps.places.PlacesService {
  if (!placesServiceInstance) {
    placesServiceInstance = new googleApi.maps.places.PlacesService(document.createElement('div'));
  }
  return placesServiceInstance;
}

export function resolvePlaceById(googleApi: typeof google, placeId: string): Promise<DraftPlace | null> {
  return new Promise((resolve) => {
    const service = getPlacesService(googleApi);
    service.getDetails({ placeId, fields: ['name', 'formatted_address', 'geometry', 'types'] }, (place, status) => {
      if (status !== googleApi.maps.places.PlacesServiceStatus.OK || !place?.geometry?.location) {
        resolve(null);
        return;
      }

      resolve({
        id: crypto.randomUUID(),
        name: place.name ?? place.formatted_address ?? 'Saved place',
        address: place.formatted_address ?? '',
        lat: place.geometry.location.lat(),
        lng: place.geometry.location.lng(),
        category: guessCategoryFromTypes(place.types),
      });
    });
  });
}

export function resolvePlaceByText(googleApi: typeof google, query: string): Promise<DraftPlace | null> {
  return new Promise((resolve) => {
    const service = getPlacesService(googleApi);
    service.findPlaceFromQuery(
      { query, fields: ['name', 'formatted_address', 'geometry', 'types'] },
      (results, status) => {
        if (status !== googleApi.maps.places.PlacesServiceStatus.OK || !results?.length) {
          resolve(null);
          return;
        }

        const place = results[0];
        if (!place.geometry?.location) {
          resolve(null);
          return;
        }

        resolve({
          id: crypto.randomUUID(),
          name: place.name ?? query,
          address: place.formatted_address ?? '',
          lat: place.geometry.location.lat(),
          lng: place.geometry.location.lng(),
          category: guessCategoryFromTypes(place.types),
        });
      },
    );
  });
}

export async function resolveCsvRows(
  googleApi: typeof google,
  rows: string[][],
  onProgress?: (done: number, total: number) => void,
): Promise<ImportRow[]> {
  const looksLikeHeader = /title/i.test(rows[0]?.[0] ?? '');
  const dataRows = looksLikeHeader ? rows.slice(1) : rows;
  const results: ImportRow[] = [];

  for (let i = 0; i < dataRows.length; i++) {
    const cells = dataRows[i];
    const title = cells[0]?.trim() ?? '';
    const url = cells.find((cell) => /^https?:\/\//.test(cell.trim()))?.trim() ?? '';
    if (!title && !url) {
      continue;
    }

    const placeId = url ? extractPlaceIdFromUrl(url) : null;
    const place = placeId ? await resolvePlaceById(googleApi, placeId) : title ? await resolvePlaceByText(googleApi, title) : null;

    results.push({ label: title || url, place });
    onProgress?.(i + 1, dataRows.length);
  }

  return results;
}

export async function resolveTextLines(
  googleApi: typeof google,
  text: string,
  onProgress?: (done: number, total: number) => void,
): Promise<ImportRow[]> {
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const results: ImportRow[] = [];

  for (let i = 0; i < lines.length; i++) {
    const place = await resolvePlaceByText(googleApi, lines[i]);
    results.push({ label: lines[i], place });
    onProgress?.(i + 1, lines.length);
  }

  return results;
}
