export type User = {
  id: string;
  name: string;
  handle: string;
  city: string;
  bio: string;
  avatar: string;
  avatarImage?: string;
  accent: string;
  /** Present when this account was created via real Google sign-in. */
  googleId?: string;
  email?: string;
};

export const PLACE_CATEGORIES = ['food', 'attraction', 'hotel', 'cafe', 'shopping', 'nature', 'nightlife', 'other'] as const;
export type PlaceCategory = (typeof PLACE_CATEGORIES)[number];

export type Place = {
  id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  category: PlaceCategory;
  /** Google's place_id, when this place came from the map search box -- lets the map re-fetch
   * rich Google details (photos, rating, hours) on click instead of just the bare pin info.
   * Absent for places added via CSV/paste import, which have no Google place behind them. */
  googlePlaceId?: string;
};

export type TripDay = {
  id: string;
  label: string;
  placeIds: string[];
};

export type AttachmentFile = {
  id: string;
  fileName: string;
  fileType: string;
  fileDataUrl: string;
};

/** A private note and/or files (images or PDFs) attached to a place. Visible only to the list owner. */
export type PlaceAttachment = {
  note: string;
  files: AttachmentFile[];
};

export type TripList = {
  id: string;
  ownerId: string;
  title: string;
  coverImage: string;
  location: string;
  country: string;
  vibe: string;
  description: string;
  places: Place[];
  days: TripDay[];
  season: string;
  budget: string;
  createdAt: string;
  /** Hex color for this list's markers on the map. Falls back to a palette color derived from
   * list position (see `lib/mapColors.ts`) when unset, for lists saved before this existed. */
  color?: string;
  /** ISO 'YYYY-MM-DD' dates. When both are set, the trip-plan editor can generate `days` to
   * match the range instead of adding them one at a time. */
  startDate?: string;
  endDate?: string;
  /** Private attachments per place (booking notes, tickets, confirmations). Visible only to the list owner. */
  placeAttachments?: Record<string, PlaceAttachment>;
};

export type Rating = {
  id: string;
  listId: string;
  userId: string;
  score: number;
  createdAt: string;
};

export type Follow = {
  followerId: string;
  followingId: string;
};

export type SavedList = {
  userId: string;
  listId: string;
};

export type Like = {
  userId: string;
  listId: string;
};

export type AppData = {
  currentUserId: string;
  users: User[];
  lists: TripList[];
  ratings: Rating[];
  follows: Follow[];
  savedLists: SavedList[];
  likes: Like[];
};

export type DraftPlace = Place;

export type DraftDay = TripDay;

export type DraftList = {
  title: string;
  coverImage: string;
  location: string;
  country: string;
  vibe: string;
  description: string;
  places: DraftPlace[];
  days: DraftDay[];
  season: string;
  budget: string;
  color?: string;
  startDate?: string;
  endDate?: string;
};

export type ProfileDraft = {
  name: string;
  handle: string;
  city: string;
  bio: string;
  avatar: string;
  avatarImage: string;
};

export type PageMode = 'home' | 'explore' | 'account' | 'dm';
