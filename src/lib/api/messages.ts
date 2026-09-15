import { supabase } from '../supabaseClient';

export type DmMessage = {
  id: string;
  fromId: string;
  toId: string;
  text: string;
  createdAt: string;
};

export async function fetchMessages(currentUserId: string): Promise<DmMessage[]> {
  const { data, error } = await supabase
    .from('dm_messages')
    .select('*')
    .or(`from_id.eq.${currentUserId},to_id.eq.${currentUserId}`)
    .order('created_at', { ascending: true });
  if (error) throw error;

  return (data ?? []).map((row) => ({
    id: row.id,
    fromId: row.from_id,
    toId: row.to_id,
    text: row.text,
    createdAt: row.created_at,
  }));
}

export async function sendMessage(fromId: string, toId: string, text: string): Promise<void> {
  const { error } = await supabase.from('dm_messages').insert({ from_id: fromId, to_id: toId, text });
  if (error) throw error;
}
