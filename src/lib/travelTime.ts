import { loadGoogleMaps } from './googleMaps';

export const TRAVEL_MODES = ['DRIVING', 'WALKING', 'TRANSIT'] as const;
export type TravelMode = (typeof TRAVEL_MODES)[number];

export type TravelTimeResult = {
  durationText: string;
  durationSeconds: number;
  distanceText: string;
};

let servicePromise: Promise<google.maps.DistanceMatrixService> | null = null;

function getService(): Promise<google.maps.DistanceMatrixService> {
  if (!servicePromise) {
    servicePromise = loadGoogleMaps().then((googleApi) => new googleApi.maps.DistanceMatrixService());
  }
  return servicePromise;
}

/** Travel time between two points for a given mode, via Google's Distance Matrix API -- the same
 * "walk / drive / transit" figure Google Maps shows for directions between two pins. Returns null
 * (rather than throwing) when a route can't be computed for that mode, e.g. no transit coverage
 * in the area, so the UI can show "not available" instead of an error. */
export async function fetchTravelTime(
  origin: { lat: number; lng: number },
  destination: { lat: number; lng: number },
  mode: TravelMode,
): Promise<TravelTimeResult | null> {
  const googleApi = await loadGoogleMaps();
  const service = await getService();

  return new Promise((resolve, reject) => {
    service.getDistanceMatrix(
      {
        origins: [origin],
        destinations: [destination],
        travelMode: googleApi.maps.TravelMode[mode],
      },
      (response, status) => {
        if (status !== 'OK') {
          reject(new Error(`Distance Matrix request failed: ${status}`));
          return;
        }

        const element = response?.rows?.[0]?.elements?.[0];
        if (!element || element.status !== 'OK') {
          resolve(null);
          return;
        }

        resolve({
          durationText: element.duration.text,
          durationSeconds: element.duration.value,
          distanceText: element.distance.text,
        });
      },
    );
  });
}
