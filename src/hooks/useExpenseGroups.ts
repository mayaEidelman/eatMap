import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createExpenseGroup,
  fetchExpenseGroups,
  inviteMember as inviteMemberApi,
  removeMember as removeMemberApi,
  respondToInvite as respondToInviteApi,
} from '../lib/api/expenses';

export function useExpenseGroups(currentUserId: string | null) {
  const queryClient = useQueryClient();
  const queryKey = ['expenseGroups', currentUserId] as const;

  const query = useQuery({
    queryKey,
    queryFn: () => fetchExpenseGroups(currentUserId as string),
    enabled: Boolean(currentUserId),
  });

  async function createGroup(listId: string, name: string, baseCurrency: string, inviteUserIds: string[]): Promise<string> {
    if (!currentUserId) throw new Error('Not signed in.');
    const groupId = await createExpenseGroup(currentUserId, listId, name, baseCurrency, inviteUserIds);
    await queryClient.invalidateQueries({ queryKey });
    return groupId;
  }

  async function inviteMember(groupId: string, userId: string) {
    if (!currentUserId) return;
    await inviteMemberApi(groupId, userId, currentUserId);
    await queryClient.invalidateQueries({ queryKey });
  }

  async function respondToInvite(groupId: string, status: 'accepted' | 'declined') {
    if (!currentUserId) return;
    await respondToInviteApi(groupId, currentUserId, status);
    await queryClient.invalidateQueries({ queryKey });
  }

  async function removeMember(groupId: string, userId: string) {
    await removeMemberApi(groupId, userId);
    await queryClient.invalidateQueries({ queryKey });
  }

  return {
    groups: query.data ?? [],
    isLoading: query.isPending,
    error: query.error,
    createGroup,
    inviteMember,
    respondToInvite,
    removeMember,
  };
}
