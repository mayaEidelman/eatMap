import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchMessages, sendMessage as sendMessageApi } from '../lib/api/messages';

export function useMessages(currentUserId: string | null) {
  const queryClient = useQueryClient();
  const queryKey = ['messages', currentUserId] as const;

  const query = useQuery({
    queryKey,
    queryFn: () => fetchMessages(currentUserId as string),
    enabled: Boolean(currentUserId),
  });

  async function sendMessage(toId: string, text: string) {
    if (!currentUserId) return;
    await sendMessageApi(currentUserId, toId, text);
    await queryClient.invalidateQueries({ queryKey });
  }

  return { messages: query.data ?? [], isLoading: query.isPending, sendMessage };
}
