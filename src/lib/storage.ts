import { supabase } from './supabaseClient';

const PUBLIC_BUCKET = 'public-media';
const ATTACHMENTS_BUCKET = 'attachments';

function buildPath(userId: string, file: File) {
  const safeName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, '_');
  return `${userId}/${crypto.randomUUID()}-${safeName}`;
}

/** Cover images and avatar photos -- public, permanent URL. */
export async function uploadPublicMedia(userId: string, file: File): Promise<string> {
  const path = buildPath(userId, file);
  const { error } = await supabase.storage.from(PUBLIC_BUCKET).upload(path, file);
  if (error) throw error;

  const { data } = supabase.storage.from(PUBLIC_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

/** Private ticket/confirmation files. Returns both the storage PATH (what gets persisted via
 * `saveAttachment`, `src/lib/api/attachments.ts`) and a short-lived signed URL for immediate
 * local preview -- the persisted, owner-scoped link used everywhere else is only ever minted
 * at read time by `fetchAllLists`. */
export async function uploadAttachmentFile(userId: string, file: File): Promise<{ path: string; previewUrl: string }> {
  const path = buildPath(userId, file);
  const { error } = await supabase.storage.from(ATTACHMENTS_BUCKET).upload(path, file);
  if (error) throw error;

  const { data: signed, error: signError } = await supabase.storage.from(ATTACHMENTS_BUCKET).createSignedUrl(path, 60 * 60);
  if (signError) throw signError;

  return { path, previewUrl: signed.signedUrl };
}
