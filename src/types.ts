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

export type Place = {
  id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
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
  season: string;
  budget: string;
  createdAt: string;
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

export type DraftPlace = {
  id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
};

export type DraftList = {
  title: string;
  coverImage: string;
  location: string;
  country: string;
  vibe: string;
  description: string;
  places: DraftPlace[];
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
