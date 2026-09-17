import { useQueryClient } from '@tanstack/react-query';
import { saveAttachment as saveAttachmentApi } from '../lib/api/attachments';
import {
  addPlaceToList,
  assignPlacesToDay as assignPlacesToDayApi,
  createList,
  inviteListCollaborator as inviteListCollaboratorApi,
  removeListCollaborator as removeListCollaboratorApi,
  removePlaceFromList,
  respondToListInvite as respondToListInviteApi,
  updateList,
} from '../lib/api/lists';
import { rateList as rateListApi } from '../lib/api/ratings';
import { followUser, likeList, saveList as saveListApi, unfollowUser, unlikeList, unsaveList } from '../lib/api/social';
import { updateProfile, type ProfileUpdate } from '../lib/api/users';
import { QUERY_KEYS } from './useAppData';
import type { DraftList, DraftPlace, PlaceAttachment } from '../types';

/** Every function here mirrors an existing AppShell mutator by name and intent -- only the body
 * changed, from a synchronous `setData` update to an async Supabase call followed by invalidating
 * the query keys that depend on it. */
export function useAppActions(currentUserId: string | null) {
  const queryClient = useQueryClient();

  async function toggleFollow(targetUserId: string, currentlyFollowing: boolean) {
    if (!currentUserId || targetUserId === currentUserId) return;
    if (currentlyFollowing) {
      await unfollowUser(currentUserId, targetUserId);
    } else {
      await followUser(currentUserId, targetUserId);
    }
    await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.follows });
  }

  async function toggleSaveList(listId: string, currentlySaved: boolean) {
    if (!currentUserId) return;
    if (currentlySaved) {
      await unsaveList(currentUserId, listId);
    } else {
      await saveListApi(currentUserId, listId);
    }
    await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.savedLists });
  }

  async function toggleLike(listId: string, currentlyLiked: boolean) {
    if (!currentUserId) return;
    if (currentlyLiked) {
      await unlikeList(currentUserId, listId);
    } else {
      await likeList(currentUserId, listId);
    }
    await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.likes });
  }

  async function rateList(listId: string, ownerId: string | undefined, score: number) {
    if (!currentUserId || ownerId === currentUserId) return;
    await rateListApi(listId, currentUserId, score);
    await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.ratings });
  }

  async function saveList(mode: 'create' | 'edit', listId: string | undefined, draft: DraftList): Promise<string> {
    if (!currentUserId) throw new Error('Not signed in.');

    let resultId: string;
    if (mode === 'edit' && listId) {
      await updateList(listId, draft);
      resultId = listId;
    } else {
      resultId = await createList(currentUserId, draft);
    }

    await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.lists });
    return resultId;
  }

  async function saveProfile(patch: ProfileUpdate) {
    if (!currentUserId) return;
    await updateProfile(currentUserId, patch);
    await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.profiles });
  }

  async function saveAttachment(placeId: string, attachment: PlaceAttachment | null) {
    await saveAttachmentApi(placeId, attachment);
    await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.lists });
  }

  async function togglePlaceInList(listId: string, place: DraftPlace, existingPlaceId: string | undefined) {
    if (existingPlaceId) {
      await removePlaceFromList(existingPlaceId);
    } else {
      await addPlaceToList(listId, place);
    }
    await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.lists });
  }

  async function inviteListCollaborator(listId: string, userId: string) {
    if (!currentUserId) return;
    await inviteListCollaboratorApi(listId, userId, currentUserId);
    await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.lists });
  }

  async function respondToListInvite(listId: string, status: 'accepted' | 'declined') {
    if (!currentUserId) return;
    await respondToListInviteApi(listId, currentUserId, status);
    await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.lists });
  }

  async function removeListCollaborator(listId: string, userId: string) {
    await removeListCollaboratorApi(listId, userId);
    await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.lists });
  }

  async function assignPlacesToDay(dayId: string, placeIds: string[]) {
    await assignPlacesToDayApi(dayId, placeIds);
    await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.lists });
  }

  return {
    toggleFollow,
    toggleSaveList,
    toggleLike,
    rateList,
    saveList,
    saveProfile,
    saveAttachment,
    togglePlaceInList,
    inviteListCollaborator,
    respondToListInvite,
    removeListCollaborator,
    assignPlacesToDay,
  };
}
