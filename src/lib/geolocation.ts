export type GeoPosition = { lat: number; lng: number; accuracy: number };

function describeGeolocationError(error: GeolocationPositionError): string {
  switch (error.code) {
    case error.PERMISSION_DENIED:
      return 'Location access was denied.';
    case error.POSITION_UNAVAILABLE:
      return 'Your location is currently unavailable.';
    case error.TIMEOUT:
      return 'Timed out while getting your location.';
    default:
      return 'Could not get your location.';
  }
}

/** One-shot read of the device's current position via the browser's own Geolocation API -- a
 * standard Web API gated behind the browser's own permission prompt, not a Google product; no key,
 * no billing. Kept as its own tiny wrapper (rather than inlined at the call site) so swapping this
 * for `navigator.geolocation.watchPosition` later, for live tracking, is a contained change to one
 * function instead of something scattered through the map component. */
export function getCurrentPosition(): Promise<GeoPosition> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Geolocation is not supported by this browser.'));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({ lat: position.coords.latitude, lng: position.coords.longitude, accuracy: position.coords.accuracy });
      },
      (error) => reject(new Error(describeGeolocationError(error))),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  });
}
