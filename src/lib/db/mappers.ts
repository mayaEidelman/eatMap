import type { AttachmentFile, Place, PlaceAttachment, PlaceCategory, TripDay, TripList, User } from '../../types';

// Row shapes as they come back from Postgres (snake_case). Keeping these separate from the
// app-facing camelCase types in `src/types.ts` means the rest of the app never has to think
// about the database's column-naming convention.

export type ProfileRow = {
  id: string;
  name: string;
  handle: string;
  city: string;
  bio: string;
  avatar: string;
  avatar_image_url: string | null;
  accent: string;
  email: string | null;
};

export type ListRow = {
  id: string;
  owner_id: string;
  title: string;
  cover_image_url: string | null;
  location: string;
  country: string;
  vibe: string;
  description: string;
  season: string;
  budget: string;
  created_at: string;
};

export type PlaceRow = {
  id: string;
  list_id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  category: string;
};

export type TripDayRow = {
  id: string;
  list_id: string;
  label: string;
  sort_order: number;
};

export type TripDayPlaceRow = {
  day_id: string;
  place_id: string;
  sort_order: number;
};

export type PlaceAttachmentRow = {
  id: string;
  place_id: string;
  note: string;
};

export type AttachmentFileRow = {
  id: string;
  attachment_id: string;
  file_name: string;
  file_type: string;
  file_url: string;
};

export type RatingRow = {
  id: string;
  list_id: string;
  user_id: string;
  score: number;
};

export type FollowRow = {
  follower_id: string;
  following_id: string;
};

export type SavedListRow = {
  user_id: string;
  list_id: string;
};

export type LikeRow = {
  user_id: string;
  list_id: string;
};

export type DmMessageRow = {
  id: string;
  from_id: string;
  to_id: string;
  text: string;
  created_at: string;
};

export function mapProfileRow(row: ProfileRow): User {
  return {
    id: row.id,
    name: row.name,
    handle: row.handle,
    city: row.city,
    bio: row.bio,
    avatar: row.avatar,
    avatarImage: row.avatar_image_url ?? undefined,
    accent: row.accent,
    email: row.email ?? undefined,
  };
}

export function mapPlaceRow(row: PlaceRow): Place {
  return {
    id: row.id,
    name: row.name,
    address: row.address,
    lat: row.lat,
    lng: row.lng,
    category: row.category as PlaceCategory,
  };
}

/** Assembles one TripList from a list row plus its already-fetched related rows. */
export function composeTripList(
  listRow: ListRow,
  placeRows: PlaceRow[],
  dayRows: TripDayRow[],
  dayPlaceRows: TripDayPlaceRow[],
  attachmentRows: PlaceAttachmentRow[],
  attachmentFileRows: AttachmentFileRow[],
): TripList {
  const days: TripDay[] = dayRows
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((dayRow) => ({
      id: dayRow.id,
      label: dayRow.label,
      placeIds: dayPlaceRows
        .filter((dayPlace) => dayPlace.day_id === dayRow.id)
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((dayPlace) => dayPlace.place_id),
    }));

  const placeAttachments: Record<string, PlaceAttachment> = {};
  for (const attachmentRow of attachmentRows) {
    const files: AttachmentFile[] = attachmentFileRows
      .filter((fileRow) => fileRow.attachment_id === attachmentRow.id)
      .map((fileRow) => ({
        id: fileRow.id,
        fileName: fileRow.file_name,
        fileType: fileRow.file_type,
        fileDataUrl: fileRow.file_url,
      }));

    placeAttachments[attachmentRow.place_id] = { note: attachmentRow.note, files };
  }

  return {
    id: listRow.id,
    ownerId: listRow.owner_id,
    title: listRow.title,
    coverImage: listRow.cover_image_url ?? '',
    location: listRow.location,
    country: listRow.country,
    vibe: listRow.vibe,
    description: listRow.description,
    places: placeRows.map(mapPlaceRow),
    days,
    season: listRow.season,
    budget: listRow.budget,
    createdAt: listRow.created_at,
    placeAttachments,
  };
}
