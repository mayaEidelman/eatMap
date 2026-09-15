import { supabase } from '../supabaseClient';
import type { Rating } from '../../types';

export async function fetchRatings(): Promise<Rating[]> {
  const { data, error } = await supabase.from('ratings').select('*');
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id,
    listId: row.list_id,
    userId: row.user_id,
    score: row.score,
    createdAt: row.created_at,
  }));
}

export async function rateList(listId: string, userId: string, score: number): Promise<void> {
  const { error } = await supabase.from('ratings').upsert({ list_id: listId, user_id: userId, score }, { onConflict: 'list_id,user_id' });
  if (error) throw error;
}
