export type User = {
  id: string;
  name: string;
  handle: string;
  city: string;
  bio: string;
  avatar: string;
  avatarImage?: string;
  accent: string;
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
