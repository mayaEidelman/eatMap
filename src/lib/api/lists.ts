import { supabase } from '../supabaseClient';
import {
  composeTripList,
  type AttachmentFileRow,
  type ListRow,
  type PlaceAttachmentRow,
  type PlaceRow,
  type TripDayPlaceRow,
  type TripDayRow,
} from '../db/mappers';
import type { DraftDay, DraftList, DraftPlace, PlaceTimeRange, TripList } from '../../types';

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
  const [listsRes, placesRes, daysRes, dayPlacesRes, attachmentsRes, filesRes] = await Promise.all([
    supabase.from('lists').select('*').order('created_at', { ascending: false }),
    supabase.from('places').select('*'),
    supabase.from('trip_days').select('*'),
    supabase.from('trip_day_places').select('*'),
    supabase.from('place_attachments').select('*'),
    supabase.from('attachment_files').select('*'),
  ]);

  for (const res of [listsRes, placesRes, daysRes, dayPlacesRes, attachmentsRes, filesRes]) {
    if (res.error) throw res.error;
  }

  const lists = (listsRes.data ?? []) as ListRow[];
  const places = (placesRes.data ?? []) as PlaceRow[];
  const days = (daysRes.data ?? []) as TripDayRow[];
  const dayPlaces = (dayPlacesRes.data ?? []) as TripDayPlaceRow[];
  const attachments = (attachmentsRes.data ?? []) as PlaceAttachmentRow[];
  const rawFiles = (filesRes.data ?? []) as AttachmentFileRow[];
  const files = await withSignedAttachmentUrls(rawFiles);

  return lists.map((list) =>
    composeTripList(
      list,
      places.filter((place) => place.list_id === list.id),
      days.filter((day) => day.list_id === list.id),
      dayPlaces,
      attachments,
      files,
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
    .insert(days.map((day, index) => ({ id: day.id, list_id: listId, label: day.label, sort_order: index })));
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
  });
  if (error) throw error;

  await savePlacesAndDays(listId, draft.places, draft.days);
  return listId;
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
    })
    .eq('id', listId);
  if (error) throw error;

  await savePlacesAndDays(listId, draft.places, draft.days);
}

/** Targeted update for a single place's time range -- unlike `updateList`, this doesn't go
 * through the full delete-and-reinsert of `savePlacesAndDays`, so setting a time from the
 * timeline view is a quick single-row write rather than a full list resave. */
export async function updatePlaceTime(dayId: string, placeId: string, range: PlaceTimeRange): Promise<void> {
  const { error } = await supabase
    .from('trip_day_places')
    .update({ start_time: range.startTime || null, end_time: range.endTime || null })
    .eq('day_id', dayId)
    .eq('place_id', placeId);
  if (error) throw error;
}
