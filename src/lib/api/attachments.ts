import { supabase } from '../supabaseClient';
import type { PlaceAttachment } from '../../types';

/** Reads (via `fetchAllLists`) are RLS-filtered to the owner automatically, so this module only
 * needs a write path -- there is nothing to "fetch" here beyond what `composeTripList` already
 * assembles from `place_attachments`/`attachment_files`. */
export async function saveAttachment(placeId: string, attachment: PlaceAttachment | null): Promise<void> {
  if (!attachment) {
    const { error } = await supabase.from('place_attachments').delete().eq('place_id', placeId);
    if (error) throw error;
    return;
  }

  const { data: upserted, error: upsertError } = await supabase
    .from('place_attachments')
    .upsert({ place_id: placeId, note: attachment.note }, { onConflict: 'place_id' })
    .select('id')
    .single();
  if (upsertError) throw upsertError;

  const attachmentId = upserted.id as string;

  const { error: deleteFilesError } = await supabase.from('attachment_files').delete().eq('attachment_id', attachmentId);
  if (deleteFilesError) throw deleteFilesError;

  if (attachment.files.length > 0) {
    const { error: insertFilesError } = await supabase.from('attachment_files').insert(
      attachment.files.map((file) => ({
        attachment_id: attachmentId,
        file_name: file.fileName,
        file_type: file.fileType,
        file_url: file.fileDataUrl,
      })),
    );
    if (insertFilesError) throw insertFilesError;
  }
}
