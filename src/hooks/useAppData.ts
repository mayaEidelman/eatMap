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

  const data: AppData | null = currentUserId && !isLoading
    ? {
        currentUserId,
        users: profiles.data ?? [],
        lists: lists.data ?? [],
        follows: follows.data ?? [],
        savedLists: savedLists.data ?? [],
        likes: likes.data ?? [],
        ratings: ratings.data ?? [],
      }
    : null;

  return { data, isLoading, error };
}
