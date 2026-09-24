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
  /** Only meaningful when category is 'hotel' -- ISO "YYYY-MM-DD". Which nights of the trip this
   * accommodation covers, so the timeline can show it on the right days. */
  checkIn?: string;
  checkOut?: string;
  /** A short free-text note about why this place was saved -- set from the "Save to list" picker.
   * Distinct from PlaceAttachment.note, which is private/owner-only; this one is visible to
   * anyone who can see the place (owner + accepted collaborators). */
  notes?: string;
};

export type PlaceTimeRange = {
  /** 24h "HH:MM" (or "HH:MM:SS" as Postgres' `time` type returns it). */
  startTime?: string;
  endTime?: string;
};

export type TripDay = {
  id: string;
  label: string;
  placeIds: string[];
  /** Optional per-place time range, keyed by placeId. When a place has a startTime, the timeline
   * view sorts chronologically by it instead of the manual drag order; places without a time keep
   * their manual order, appended after every timed place. */
  placeTimes?: Record<string, PlaceTimeRange>;
  /** ISO "YYYY-MM-DD" -- only set when days were generated from the list's start/end date. Lets a
   * hotel's checkIn/checkOut range be matched against this specific day. */
  date?: string;
  /** Free-text sub-region within the trip (e.g. "Tokyo" vs "Kyoto"). Days sharing the same
   * destination get the same auto-assigned color in the UI. */
  destination?: string;
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
  /** Other users invited to co-edit this list -- see ListCollaborator. Always present (empty array
   * when nobody's been invited), unlike placeAttachments which is genuinely optional. */
  collaborators: ListCollaborator[];
  /** When true, hidden from Explore and from every other user's view of the owner's profile --
   * enforced by RLS (see can_view_list() in schema.sql), not just hidden client-side. Optional/falsy
   * means public, matching lists saved before this column existed. */
  isPrivate?: boolean;
};

export type ListCollaborator = {
  listId: string;
  userId: string;
  status: GroupMemberStatus;
  invitedBy: string;
  createdAt: string;
  respondedAt?: string;
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

export const EXPENSE_CATEGORIES = ['food', 'transport', 'lodging', 'activities', 'shopping', 'other'] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export type GroupMemberStatus = 'invited' | 'accepted' | 'declined';

export type ExpenseGroup = {
  id: string;
  listId: string;
  ownerId: string;
  name: string;
  baseCurrency: string;
  createdAt: string;
};

export type ExpenseGroupMember = {
  groupId: string;
  userId: string;
  status: GroupMemberStatus;
  invitedBy: string;
  createdAt: string;
  respondedAt?: string;
};

export type ExpenseShare = {
  userId: string;
  amount: number;
};

export type Expense = {
  id: string;
  groupId: string;
  paidBy: string;
  description: string;
  category: ExpenseCategory;
  amount: number;
  currency: string;
  /** Rate from `currency` to the group's base currency, snapshotted when the expense was added. */
  exchangeRate: number;
  /** amount * exchangeRate, in the group's base currency. */
  convertedAmount: number;
  spentAt: string;
  createdAt: string;
  shares: ExpenseShare[];
};

export type ExpenseSettlement = {
  id: string;
  groupId: string;
  fromUser: string;
  toUser: string;
  /** Always in the group's base currency. */
  amount: number;
  createdAt: string;
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
  isPrivate?: boolean;
};

export type ProfileDraft = {
  name: string;
  handle: string;
  city: string;
  bio: string;
  avatar: string;
  avatarImage: string;
};

export type PageMode = 'home' | 'explore' | 'account' | 'dm' | 'expenses';
