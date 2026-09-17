import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchAllLists } from '../lib/api/lists';
import { fetchAllProfiles } from '../lib/api/users';
import { fetchFollows, fetchLikes, fetchSavedLists } from '../lib/api/social';
import { fetchRatings } from '../lib/api/ratings';
import type { AppData } from '../types';

export const QUERY_KEYS = {
  profiles: ['profiles'] as const,
  lists: ['lists'] as const,
  follows: ['follows'] as const,
  savedLists: ['savedLists'] as const,
  likes: ['likes'] as const,
  ratings: ['ratings'] as const,
};

/** Combines every domain query into one `AppData`-shaped object, so the rest of the app (which
 * was built around a single synchronous blob) barely has to change -- only where that blob comes
 * from changes, not how it's read. */
export function useAppData(currentUserId: string | null) {
  const enabled = Boolean(currentUserId);

  const profiles = useQuery({ queryKey: QUERY_KEYS.profiles, queryFn: fetchAllProfiles, enabled });
  const lists = useQuery({ queryKey: QUERY_KEYS.lists, queryFn: fetchAllLists, enabled });
  const follows = useQuery({ queryKey: QUERY_KEYS.follows, queryFn: fetchFollows, enabled });
  const savedLists = useQuery({ queryKey: QUERY_KEYS.savedLists, queryFn: fetchSavedLists, enabled });
  const likes = useQuery({ queryKey: QUERY_KEYS.likes, queryFn: fetchLikes, enabled });
  const ratings = useQuery({ queryKey: QUERY_KEYS.ratings, queryFn: fetchRatings, enabled });

  const queries = [profiles, lists, follows, savedLists, likes, ratings];
  const isLoading = enabled && queries.some((query) => query.isPending);
  const error = queries.find((query) => query.error)?.error ?? null;

  // Memoized (keyed on the underlying query data, not recreated as a fresh object every render)
  // so consumers downstream -- every `useMemo` in AppShell that depends on `data`, e.g. the map's
  // list of markers -- stay referentially stable across renders that don't actually change any
  // data. Without this, a render triggered by something wholly unrelated (like toggling a map
  // marker's selection state) rebuilds `data` from scratch, which cascades into "new" list arrays
  // reaching MapPanel and made it re-fit/re-center the map on every click.
  const data: AppData | null = useMemo(
    () =>
      currentUserId && !isLoading
        ? {
            currentUserId,
            users: profiles.data ?? [],
            lists: lists.data ?? [],
            follows: follows.data ?? [],
            savedLists: savedLists.data ?? [],
            likes: likes.data ?? [],
            ratings: ratings.data ?? [],
          }
        : null,
    [currentUserId, isLoading, profiles.data, lists.data, follows.data, savedLists.data, likes.data, ratings.data],
  );

  return { data, isLoading, error };
}
