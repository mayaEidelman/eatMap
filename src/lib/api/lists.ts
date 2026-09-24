import { supabase } from '../supabaseClient';
import {
  composeTripList,
  type AttachmentFileRow,
  type ListCollaboratorRow,
  type ListRow,
  type PlaceAttachmentRow,
  type PlaceRow,
  type TripDayPlaceRow,
  type TripDayRow,
} from '../db/mappers';
import type { DraftDay, DraftList, DraftPlace, TripList } from '../../types';

const ATTACHMENTS_BUCKET = 'attachments';

/** `attachment_files.file_url` stores a storage PATH, not a URL -- the "attachments" bucket is
 * private, so a usable link is only ever minted here, at read time, scoped to whoever is asking.
 * Storage RLS means this silently returns no signed URL for paths the caller isn't allowed to
 * read, so this can never leak another user's private file even if a row somehow came back. */
async function withSignedAttachmentUrls(files: AttachmentFileRow[]): Promise<AttachmentFileRow[]> {
  if (files.length === 0) {
    return files;
  }

  const paths = files.map((file) => file.file_url);
  const { data: signed, error } = await supabase.storage.from(ATTACHMENTS_BUCKET).createSignedUrls(paths, 60 * 60);
  if (error) throw error;

  const signedByPath = new Map<string, string>();
  signed?.forEach((entry, index) => {
    if (entry.signedUrl) {
      signedByPath.set(paths[index], entry.signedUrl);
    }
  });

  return files.map((file) => ({ ...file, file_url: signedByPath.get(file.file_url) ?? file.file_url }));
}

export async function fetchAllLists(): Promise<TripList[]> {
  const [listsRes, placesRes, daysRes, dayPlacesRes, attachmentsRes, filesRes, collaboratorsRes] = await Promise.all([
    supabase.from('lists').select('*').order('created_at', { ascending: false }),
    supabase.from('places').select('*'),
    supabase.from('trip_days').select('*'),
    supabase.from('trip_day_places').select('*'),
    supabase.from('place_attachments').select('*'),
    supabase.from('attachment_files').select('*'),
    supabase.from('list_collaborators').select('*'),
  ]);

  for (const res of [listsRes, placesRes, daysRes, dayPlacesRes, attachmentsRes, filesRes, collaboratorsRes]) {
    if (res.error) throw res.error;
  }

  const lists = (listsRes.data ?? []) as ListRow[];
  const places = (placesRes.data ?? []) as PlaceRow[];
  const days = (daysRes.data ?? []) as TripDayRow[];
  const dayPlaces = (dayPlacesRes.data ?? []) as TripDayPlaceRow[];
  const attachments = (attachmentsRes.data ?? []) as PlaceAttachmentRow[];
  const rawFiles = (filesRes.data ?? []) as AttachmentFileRow[];
  const files = await withSignedAttachmentUrls(rawFiles);
  const collaborators = (collaboratorsRes.data ?? []) as ListCollaboratorRow[];

  return lists.map((list) =>
    composeTripList(
      list,
      places.filter((place) => place.list_id === list.id),
      days.filter((day) => day.list_id === list.id),
      dayPlaces,
      attachments,
      files,
      collaborators.filter((collaborator) => collaborator.list_id === list.id),
    ),
  );
}

/** Upserts places by their (client-generated, stable) id, deletes any that were removed from
 * the draft, then wholesale-replaces trip_days/trip_day_places. Place attachments live on the
 * place row's id and are left untouched unless their place was deleted. */
async function savePlacesAndDays(listId: string, places: DraftPlace[], days: DraftDay[]) {
  if (places.length > 0) {
    const { error } = await supabase.from('places').upsert(
      places.map((place) => ({
        id: place.id,
        list_id: listId,
        name: place.name,
        address: place.address,
        lat: place.lat,
        lng: place.lng,
        category: place.category,
        google_place_id: place.googlePlaceId ?? null,
        check_in: place.checkIn || null,
        check_out: place.checkOut || null,
        notes: place.notes || '',
      })),
    );
    if (error) throw error;
  }

  const { data: existingPlaces, error: fetchError } = await supabase.from('places').select('id').eq('list_id', listId);
  if (fetchError) throw fetchError;

  const keepIds = new Set(places.map((place) => place.id));
  const toDelete = (existingPlaces ?? []).map((row) => row.id as string).filter((id) => !keepIds.has(id));
  if (toDelete.length > 0) {
    const { error } = await supabase.from('places').delete().in('id', toDelete);
    if (error) throw error;
  }

  const { error: deleteDaysError } = await supabase.from('trip_days').delete().eq('list_id', listId);
  if (deleteDaysError) throw deleteDaysError;

  if (days.length === 0) {
    return;
  }

  // One insert for every day, and one for every day's places -- not one round trip per day.
  // A list with a couple weeks of generated days used to mean dozens of sequential requests
  // here, which is exactly what made saving feel like it hung.
  const { error: daysError } = await supabase
    .from('trip_days')
    .insert(
      days.map((day, index) => ({
        id: day.id,
        list_id: listId,
        label: day.label,
        sort_order: index,
        date: day.date || null,
        destination: day.destination || null,
      })),
    );
  if (daysError) throw daysError;

  // Reinsert preserves each place's previously-set time range -- `savePlacesAndDays` fully
  // replaces trip_day_places on every save (even ones unrelated to time, like editing the title),
  // so times have to be carried through here or they'd silently disappear on the next unrelated edit.
  const dayPlaceRows = days.flatMap((day) =>
    day.placeIds.map((placeId, placeIndex) => ({
      day_id: day.id,
      place_id: placeId,
      sort_order: placeIndex,
      start_time: day.placeTimes?.[placeId]?.startTime || null,
      end_time: day.placeTimes?.[placeId]?.endTime || null,
    })),
  );
  if (dayPlaceRows.length > 0) {
    const { error: dayPlacesError } = await supabase.from('trip_day_places').insert(dayPlaceRows);
    if (dayPlacesError) throw dayPlacesError;
  }
}

export async function createList(ownerId: string, draft: DraftList): Promise<string> {
  const listId = crypto.randomUUID();

  const { error } = await supabase.from('lists').insert({
    id: listId,
    owner_id: ownerId,
    title: draft.title,
    cover_image_url: draft.coverImage || null,
    location: draft.location,
    country: draft.country || 'Unknown',
    vibe: draft.vibe || 'custom route',
    description: draft.description || 'A new list from the community.',
    season: draft.season,
    budget: draft.budget,
    color: draft.color || null,
    start_date: draft.startDate || null,
    end_date: draft.endDate || null,
    is_private: draft.isPrivate ?? false,
  });
  if (error) throw error;

  await savePlacesAndDays(listId, draft.places, draft.days);
  return listId;
}

/** Toggling a place's membership in a list (the map's "Save to list" popup) used to go through
 * `updateList`/`savePlacesAndDays` -- a whole-list resave that upserts every place, then deletes
 * and reinserts every trip_day and trip_day_place, regardless of the fact that only one place's
 * membership actually changed. That's up to ~7 sequential writes for what's really a single-row
 * change, which is what made marking a list feel slow. These do only the one write that's
 * actually needed; `removePlaceFromList` doesn't need to touch trip_day_places or
 * place_attachments at all, since both reference places with `on delete cascade`. */
/** `place.id` is left out on purpose -- it's whatever id the search result/preview pin happened to
 * be built with client-side, and the same DraftPlace object gets reused for every list the "Save
 * to list" modal's buttons are clicked for. Reinserting with that same id a second time (for a
 * second list) would collide with the row the first insert already created, since `places.id` is
 * a single global primary key, not scoped per list. Leaving `id` out lets the column's own
 * `gen_random_uuid()` default assign each list's copy its own row. */
export async function addPlaceToList(listId: string, place: DraftPlace): Promise<void> {
  const { error } = await supabase.from('places').insert({
    list_id: listId,
    name: place.name,
    address: place.address,
    lat: place.lat,
    lng: place.lng,
    category: place.category,
    google_place_id: place.googlePlaceId ?? null,
    notes: place.notes || '',
  });
  if (error) throw error;
}

export async function removePlaceFromList(placeId: string): Promise<void> {
  const { error } = await supabase.from('places').delete().eq('id', placeId);
  if (error) throw error;
}

/** Assigns one or more places to a day -- used by the map's "select places, then group into a
 * day" flow, so grouping stops requiring a trip back to the Edit List page. Upserts on the
 * (day_id, place_id) pair rather than place_id alone, so a place already scheduled on a *different*
 * day is added to this one too instead of being moved -- a place can now sit on more than one day
 * at once. The pair conflict target still means re-running this for a place already on *this* day
 * is a harmless no-op rather than a duplicate row. Only sort_order/day_id are in the payload, so an
 * existing place's start_time/end_time survive untouched. */
export async function assignPlacesToDay(dayId: string, placeIds: string[]): Promise<void> {
  if (placeIds.length === 0) return;

  const { data: existing, error: fetchError } = await supabase
    .from('trip_day_places')
    .select('sort_order')
    .eq('day_id', dayId)
    .order('sort_order', { ascending: false })
    .limit(1);
  if (fetchError) throw fetchError;

  const startOrder = (existing?.[0]?.sort_order ?? -1) + 1;

  const { error } = await supabase.from('trip_day_places').upsert(
    placeIds.map((placeId, index) => ({ day_id: dayId, place_id: placeId, sort_order: startOrder + index })),
    { onConflict: 'day_id,place_id' },
  );
  if (error) throw error;
}

export async function updateList(listId: string, draft: DraftList): Promise<void> {
  const { error } = await supabase
    .from('lists')
    .update({
      title: draft.title,
      cover_image_url: draft.coverImage || null,
      location: draft.location,
      country: draft.country || 'Unknown',
      vibe: draft.vibe || 'custom route',
      description: draft.description || 'A new list from the community.',
      season: draft.season,
      budget: draft.budget,
      color: draft.color || null,
      start_date: draft.startDate || null,
      end_date: draft.endDate || null,
      is_private: draft.isPrivate ?? false,
    })
    .eq('id', listId);
  if (error) throw error;

  await savePlacesAndDays(listId, draft.places, draft.days);
}

export async function inviteListCollaborator(listId: string, userId: string, invitedBy: string): Promise<void> {
  const { error } = await supabase
    .from('list_collaborators')
    .insert({ list_id: listId, user_id: userId, status: 'invited', invited_by: invitedBy });
  if (error) throw error;
}

export async function respondToListInvite(listId: string, userId: string, status: 'accepted' | 'declined'): Promise<void> {
  // Mirrors respondToInvite for expense groups: a decline removes the row outright rather than
  // keeping a 'declined' one around, so it disappears from both sides in one place.
  if (status === 'declined') {
    const { error } = await supabase.from('list_collaborators').delete().eq('list_id', listId).eq('user_id', userId);
    if (error) throw error;
    return;
  }

  const { error } = await supabase
    .from('list_collaborators')
    .update({ status, responded_at: new Date().toISOString() })
    .eq('list_id', listId)
    .eq('user_id', userId);
  if (error) throw error;
}

export async function removeListCollaborator(listId: string, userId: string): Promise<void> {
  const { error } = await supabase.from('list_collaborators').delete().eq('list_id', listId).eq('user_id', userId);
  if (error) throw error;
}
