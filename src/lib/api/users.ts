import { supabase } from '../supabaseClient';
import { mapProfileRow, type ProfileRow } from '../db/mappers';
import type { User } from '../../types';

export async function fetchAllProfiles(): Promise<User[]> {
  const { data, error } = await supabase.from('profiles').select('*');
  if (error) throw error;
  return ((data ?? []) as ProfileRow[]).map(mapProfileRow);
}

export type ProfileUpdate = {
  name?: string;
  handle?: string;
  city?: string;
  bio?: string;
  avatar?: string;
  avatarImageUrl?: string;
};

export async function updateProfile(userId: string, patch: ProfileUpdate): Promise<void> {
  const { error } = await supabase
    .from('profiles')
    .update({
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.handle !== undefined ? { handle: patch.handle } : {}),
      ...(patch.city !== undefined ? { city: patch.city } : {}),
      ...(patch.bio !== undefined ? { bio: patch.bio } : {}),
      ...(patch.avatar !== undefined ? { avatar: patch.avatar } : {}),
      ...(patch.avatarImageUrl !== undefined ? { avatar_image_url: patch.avatarImageUrl } : {}),
    })
    .eq('id', userId);
  if (error) throw error;
}

export async function isHandleTaken(handle: string, excludingUserId: string): Promise<boolean> {
  const { data, error } = await supabase.from('profiles').select('id').eq('handle', handle).neq('id', excludingUserId).maybeSingle();
  if (error) throw error;
  return Boolean(data);
}
