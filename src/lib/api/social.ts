import { supabase } from '../supabaseClient';
import type { Follow, Like, SavedList } from '../../types';

export async function fetchFollows(): Promise<Follow[]> {
  const { data, error } = await supabase.from('follows').select('*');
  if (error) throw error;
  return (data ?? []).map((row) => ({ followerId: row.follower_id, followingId: row.following_id }));
}

export async function followUser(followerId: string, followingId: string): Promise<void> {
  const { error } = await supabase.from('follows').insert({ follower_id: followerId, following_id: followingId });
  if (error) throw error;
}

export async function unfollowUser(followerId: string, followingId: string): Promise<void> {
  const { error } = await supabase.from('follows').delete().eq('follower_id', followerId).eq('following_id', followingId);
  if (error) throw error;
}

export async function fetchSavedLists(): Promise<SavedList[]> {
  const { data, error } = await supabase.from('saved_lists').select('*');
  if (error) throw error;
  return (data ?? []).map((row) => ({ userId: row.user_id, listId: row.list_id }));
}

export async function saveList(userId: string, listId: string): Promise<void> {
  const { error } = await supabase.from('saved_lists').insert({ user_id: userId, list_id: listId });
  if (error) throw error;
}

export async function unsaveList(userId: string, listId: string): Promise<void> {
  const { error } = await supabase.from('saved_lists').delete().eq('user_id', userId).eq('list_id', listId);
  if (error) throw error;
}

export async function fetchLikes(): Promise<Like[]> {
  const { data, error } = await supabase.from('likes').select('*');
  if (error) throw error;
  return (data ?? []).map((row) => ({ userId: row.user_id, listId: row.list_id }));
}

export async function likeList(userId: string, listId: string): Promise<void> {
  const { error } = await supabase.from('likes').insert({ user_id: userId, list_id: listId });
  if (error) throw error;
}

export async function unlikeList(userId: string, listId: string): Promise<void> {
  const { error } = await supabase.from('likes').delete().eq('user_id', userId).eq('list_id', listId);
  if (error) throw error;
}
