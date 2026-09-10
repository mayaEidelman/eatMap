import { useQuery } from '@tanstack/react-query';
import { fetchTravelTime, type TravelMode } from '../lib/travelTime';

type LatLng = { lat: number; lng: number };

/** Travel time doesn't meaningfully change within a session, and Distance Matrix calls are
 * billed, so this is tuned to call Google as little as possible:
 * - `staleTime: Infinity` + a 24h `gcTime` means switching modes back and forth, or closing and
 *   reopening the same list within a day, reuses the cached result instead of re-querying.
 * - `retry: false` because a failure here (e.g. REQUEST_DENIED from a misconfigured API key) is a
 *   permanent config problem, not a transient one -- react-query's default of silently retrying
 *   failed queries 3 more times would just triple the wasted/denied calls for no chance of success. */
export function useTravelTime(origin: LatLng, destination: LatLng, mode: TravelMode) {
  const query = useQuery({
    queryKey: ['travelTime', origin.lat, origin.lng, destination.lat, destination.lng, mode],
    queryFn: () => fetchTravelTime(origin, destination, mode),
    staleTime: Infinity,
    gcTime: 24 * 60 * 60 * 1000,
    retry: false,
  });

  return { result: query.data ?? null, isLoading: query.isPending, error: query.error };
}
