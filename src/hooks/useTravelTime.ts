import { useQuery } from '@tanstack/react-query';
import { fetchTravelTime, type TravelMode } from '../lib/travelTime';

type LatLng = { lat: number; lng: number };

/** Driving/walking/transit duration between two fixed coordinates is effectively permanent, and
 * Distance Matrix calls are billed, so this is tuned to call Google as little as possible:
 * - `staleTime: Infinity` means a mounted/re-rendered/reopened Timeline never triggers a refetch
 *   on its own -- the query key already encodes the exact origin/destination/mode, so a segment
 *   is only ever re-requested when one of *those* actually changes (different stops, reordering,
 *   switching mode). Nothing here "re-checks on a timer."
 * - `gcTime` governs a different thing: how long an *unused* entry (no mounted TimelineTravelTime
 *   observing it) is kept before being dropped from the cache. 30 days rather than react-query's
 *   default few minutes, so a list you only revisit every so often doesn't silently re-pay for
 *   segments that were already fetched once. Keep this in sync with `persistOptions.maxAge` in
 *   main.tsx, which governs the same lifetime for the on-disk (localStorage) copy.
 * - `retry: false` because a failure here (e.g. REQUEST_DENIED from a misconfigured API key) is a
 *   permanent config problem, not a transient one -- react-query's default of silently retrying
 *   failed queries 3 more times would just triple the wasted/denied calls for no chance of success. */
const TRAVEL_TIME_GC_TIME = 30 * 24 * 60 * 60 * 1000;

// Bump this when fetchTravelTime's request shape changes in a way that could flip a previously
// cached result -- e.g. adding transitOptions.departureTime, which can turn old cached "no route"
// nulls for TRANSIT into real results. Without it, those wrong nulls would otherwise sit valid in
// the (now 30-day) cache until they happened to expire.
const TRAVEL_TIME_CACHE_VERSION = 'v2';

export function useTravelTime(origin: LatLng, destination: LatLng, mode: TravelMode) {
  const query = useQuery({
    queryKey: ['travelTime', TRAVEL_TIME_CACHE_VERSION, origin.lat, origin.lng, destination.lat, destination.lng, mode],
    queryFn: () => fetchTravelTime(origin, destination, mode),
    staleTime: Infinity,
    gcTime: TRAVEL_TIME_GC_TIME,
    retry: false,
  });

  return { result: query.data ?? null, isLoading: query.isPending, error: query.error };
}
