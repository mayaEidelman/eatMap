import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { Compass, DollarSign, Map as MapIcon, MessageCircle, Plus, Search, Trash2, User as UserIcon, UserPlus } from 'lucide-react';
import { ImportPlacesModal } from './components/ImportPlacesModal';
import { MapPanel } from './components/MapPanel';
import { PlaceAutocomplete, type PlaceSearchResult } from './components/PlaceAutocomplete';
import { CATEGORY_META, groupPlacesByCategory } from './lib/categories';
import { CURRENCIES } from './lib/currency';
import { EXPENSE_CATEGORY_META, groupExpensesByCategory } from './lib/expenseCategories';
import { computeBalances, isEquallySplit, simplifyDebts, sharesSumTo, splitEqually } from './lib/expenseMath';
import type { ExpenseGroupWithMembers } from './lib/api/expenses';
import { useAppActions } from './hooks/useAppActions';
import { useAppData } from './hooks/useAppData';
import { useAuthSession } from './hooks/useAuthSession';
import { useExpenseGroups } from './hooks/useExpenseGroups';
import { useGroupExpenses } from './hooks/useGroupExpenses';
import { useMessages } from './hooks/useMessages';
import { defaultColorForIndex, LIST_MARKER_COLORS } from './lib/mapColors';
import { fetchPlaceDetails, type PlaceDetails } from './lib/placeDetails';
import { signInWithGoogle, signInWithMagicLink, signOut as signOutOfSupabase } from './lib/supabaseAuth';
import { isSupabaseConfigured, supabaseConfigError } from './lib/supabaseClient';
import { uploadAttachmentFile, uploadPublicMedia } from './lib/storage';
import { TRAVEL_MODES, type TravelMode } from './lib/travelTime';
import { useTravelTime } from './hooks/useTravelTime';
import { emptyDraft } from './mock';
import { EXPENSE_CATEGORIES, PLACE_CATEGORIES } from './types';
import type {
  AppData,
  AttachmentFile,
  DraftDay,
  DraftList,
  DraftPlace,
  Expense,
  ExpenseCategory,
  PageMode,
  Place,
  PlaceAttachment,
  PlaceCategory,
  PlaceTimeRange,
  ProfileDraft,
  Rating,
  TripDay,
  TripList,
  User,
} from './types';

const DEFAULT_COVER = 'https://images.unsplash.com/photo-1502920917128-1aa500764cbd?q=80&w=1200&auto=format&fit=crop';

const RECENTLY_WATCHED_KEY = 'eatmap:recently-watched-lists';
const RECENTLY_WATCHED_LIMIT = 3;

/** Places actually assigned to some day -- excludes places saved to the list but never dragged
 * into the trip plan, so "All days" in the timeline means "everything scheduled," not
 * "everything saved." */
function getScheduledPlaceIds(list: TripList): Set<string> {
  const ids = new Set<string>();
  list.days.forEach((day) => day.placeIds.forEach((placeId) => ids.add(placeId)));
  return ids;
}

/** The accommodation covering a given calendar day, if any -- a hotel place whose
 * checkIn/checkOut range includes that date. Only possible when the day has a real date (i.e. its
 * list's days were generated from a start/end date) and the hotel has both dates set. Checkout day
 * itself still counts as covered, since that's still the night before you leave. */
type HotelForDay =
  | { kind: 'single'; hotel: Place }
  | { kind: 'switch'; from: Place; to: Place }
  | { kind: 'checkout'; hotel: Place };

/** A "switch" day is one where a hotel's checkOut and a *different* hotel's checkIn both land on
 * the same date -- checking out of one place and into another the same day. That's detected first
 * so it doesn't just silently resolve to whichever hotel `.find()` happens to hit first; only once
 * that's ruled out does this fall back to "which single hotel covers this date." */
function findHotelForDay(places: Place[], date: string | undefined): HotelForDay | undefined {
  if (!date) return undefined;

  const hotels = places.filter((place) => place.category === 'hotel' && place.checkIn && place.checkOut);
  const checkingOut = hotels.find((place) => place.checkOut === date);
  const checkingIn = hotels.find((place) => place.checkIn === date && place.id !== checkingOut?.id);

  if (checkingOut && checkingIn) {
    return { kind: 'switch', from: checkingOut, to: checkingIn };
  }

  // Checking out with nowhere new to check into that same day (end of trip, or a gap before the
  // next hotel) -- worth flagging on its own rather than quietly reading as just "staying" through
  // the day you're actually packing up and leaving.
  if (checkingOut) {
    return { kind: 'checkout', hotel: checkingOut };
  }

  const covering = hotels.find((place) => date >= place.checkIn! && date <= place.checkOut!);
  return covering ? { kind: 'single', hotel: covering } : undefined;
}

/** One color per distinct destination (e.g. "Tokyo" vs "Kyoto"), assigned by order of first
 * appearance across the day list so the same destination always gets the same color within a
 * given list -- reuses the same palette as map/list markers rather than a separate one. */
function buildDestinationColors(days: TripDay[]): Map<string, string> {
  const colors = new Map<string, string>();
  for (const day of days) {
    if (day.destination && !colors.has(day.destination)) {
      colors.set(day.destination, LIST_MARKER_COLORS[colors.size % LIST_MARKER_COLORS.length]);
    }
  }
  return colors;
}

/** Places with a startTime sort chronologically; places without one keep their manual drag order,
 * appended after every timed place (stable within each group). */
function sortPlaceIdsByTime(placeIds: string[], placeTimes: Record<string, PlaceTimeRange> | undefined): string[] {
  if (!placeTimes) {
    return placeIds;
  }

  return placeIds
    .map((placeId, index) => ({ placeId, index, startTime: placeTimes[placeId]?.startTime }))
    .sort((a, b) => {
      if (a.startTime && b.startTime) return a.startTime.localeCompare(b.startTime);
      if (a.startTime) return -1;
      if (b.startTime) return 1;
      return a.index - b.index;
    })
    .map((entry) => entry.placeId);
}

function formatClockTime(value: string | undefined): string {
  if (!value) return '';
  const [hoursRaw, minutesRaw] = value.split(':');
  const hours = Number(hoursRaw);
  const minutes = Number(minutesRaw);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return value;

  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
}

function formatTimeRange(range: PlaceTimeRange | undefined): string {
  if (!range) return '';
  const start = formatClockTime(range.startTime);
  const end = formatClockTime(range.endTime);
  if (start && end) return `${start} – ${end}`;
  return start || end;
}

function getListSummary(listId: string, ratings: Rating[]) {
  const matching = ratings.filter((rating) => rating.listId === listId);
  const count = matching.length;
  const average = count ? matching.reduce((sum, rating) => sum + rating.score, 0) / count : 0;

  return { count, average };
}

function getUserStats(userId: string, data: AppData) {
  const ownedListIds = new Set(data.lists.filter((list) => list.ownerId === userId).map((list) => list.id));
  const ownedRatings = data.ratings.filter((rating) => ownedListIds.has(rating.listId));
  const avgRating = ownedRatings.length
    ? ownedRatings.reduce((sum, rating) => sum + rating.score, 0) / ownedRatings.length
    : 0;

  return {
    followers: data.follows.filter((follow) => follow.followingId === userId).length,
    following: data.follows.filter((follow) => follow.followerId === userId).length,
    trips: ownedListIds.size,
    avgRating,
  };
}

function getFollowerUsers(userId: string, data: AppData) {
  return data.follows
    .filter((follow) => follow.followingId === userId)
    .map((follow) => data.users.find((user) => user.id === follow.followerId))
    .filter((user): user is AppData['users'][number] => Boolean(user));
}

function getFollowingUsers(userId: string, data: AppData) {
  return data.follows
    .filter((follow) => follow.followerId === userId)
    .map((follow) => data.users.find((user) => user.id === follow.followingId))
    .filter((user): user is AppData['users'][number] => Boolean(user));
}

function isFollowing(follows: AppData['follows'], followerId: string, followingId: string) {
  return follows.some((follow) => follow.followerId === followerId && follow.followingId === followingId);
}

function isSaved(savedLists: AppData['savedLists'], userId: string, listId: string) {
  return savedLists.some((saved) => saved.userId === userId && saved.listId === listId);
}

function isLiked(likes: AppData['likes'], userId: string, listId: string) {
  return likes.some((like) => like.userId === userId && like.listId === listId);
}

function getLikeCount(likes: AppData['likes'], listId: string) {
  return likes.filter((like) => like.listId === listId).length;
}

function formatRating(value: number) {
  return value ? value.toFixed(1) : 'New';
}

function buildProfileDraft(user: AppData['users'][number]): ProfileDraft {
  return {
    name: user.name,
    handle: user.handle,
    city: user.city,
    bio: user.bio,
    avatar: user.avatar,
    avatarImage: user.avatarImage ?? '',
  };
}

function buildListDraft(list?: TripList): DraftList {
  if (!list) {
    return emptyDraft;
  }

  return {
    title: list.title,
    coverImage: list.coverImage,
    location: list.location,
    country: list.country,
    vibe: list.vibe,
    description: list.description,
    places: list.places.map((place) => ({ ...place })),
    days: list.days.map((tripDay) => ({ ...tripDay, placeIds: [...tripDay.placeIds] })),
    season: list.season,
    budget: list.budget,
    color: list.color,
    startDate: list.startDate,
    endDate: list.endDate,
    isPrivate: list.isPrivate,
  };
}

const MAX_GENERATED_DAYS = 60;

/** Builds one DraftDay per calendar day in [startDate, endDate], labeled with its date. Dates
 * are parsed as local midnight (not UTC) so the generated label always matches the date the
 * user actually picked, regardless of timezone. */
/** "YYYY-MM-DD" from a Date's *local* fields -- `.toISOString()` converts to UTC first, which can
 * silently shift the date by one depending on the browser's timezone. */
function toLocalIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const day = date.getDate().toString().padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function buildDaysFromDateRange(startDate: string, endDate: string): DraftDay[] {
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) {
    return [];
  }

  const days: DraftDay[] = [];
  const cursor = new Date(start);
  let index = 1;

  while (cursor <= end && days.length < MAX_GENERATED_DAYS) {
    days.push({
      id: crypto.randomUUID(),
      label: `Day ${index} · ${cursor.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}`,
      placeIds: [],
      date: toLocalIsoDate(cursor),
    });
    cursor.setDate(cursor.getDate() + 1);
    index += 1;
  }

  return days;
}

/** Same physical place, not just same name -- two different places can share a name (e.g. a
 * chain), so name alone isn't a safe identity check. Google's place_id is authoritative when
 * both sides have one; otherwise falls back to name+address both matching. */
function isSamePlace(a: DraftPlace, b: DraftPlace): boolean {
  if (a.googlePlaceId && b.googlePlaceId) {
    return a.googlePlaceId === b.googlePlaceId;
  }

  return (
    a.name.trim().toLowerCase() === b.name.trim().toLowerCase() &&
    a.address.trim().toLowerCase() === b.address.trim().toLowerCase()
  );
}

function findDuplicatePlace(places: DraftPlace[], candidate: DraftPlace): DraftPlace | undefined {
  return places.find((place) => isSamePlace(place, candidate));
}

/** Supabase-js doesn't always throw a real `Error` -- when the underlying `fetch()` itself fails
 * (network-level failure, not an HTTP error response), postgrest-js hands back a plain
 * `{ message, details, hint, code }` object instead. Checking `instanceof Error` alone silently
 * discards that entire object, which is how a real failure turned into a useless "Unknown error." */
function describeQueryError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (error && typeof error === 'object') {
    const shaped = error as { message?: string; hint?: string; details?: string; code?: string };
    const parts = [shaped.message, shaped.hint, shaped.code ? `(${shaped.code})` : undefined].filter(Boolean);
    if (parts.length > 0) {
      return parts.join(' — ');
    }
  }

  return 'Unknown error.';
}

function filterByQuery(lists: TripList[], query: string) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return lists;
  }

  return lists.filter((list) =>
    [list.title, list.location, list.country, list.vibe].some((value) => value.toLowerCase().includes(normalized)),
  );
}

const EMPTY_PROFILE_DRAFT: ProfileDraft = { name: '', handle: '', city: '', bio: '', avatar: '', avatarImage: '' };

// Expense group invites are sent as regular DM text with a machine-readable tag prefix, so the
// chat bubble can be rendered with live Accept/Decline buttons instead of plain text -- there's no
// separate "system message" concept in dm_messages, so the tag is how a bubble is told apart from
// an ordinary note.
const EXPENSE_INVITE_TAG = /^\[\[expense-invite:([0-9a-fA-F-]{36})\]\]/;

function buildExpenseInviteMessage(groupId: string, tripTitle: string, groupName: string): string {
  return `[[expense-invite:${groupId}]]Invited you to split expenses for "${tripTitle}" in the "${groupName}" group.`;
}

function parseExpenseInviteMessage(text: string): { groupId: string; text: string } | null {
  const match = text.match(EXPENSE_INVITE_TAG);
  if (!match) return null;
  return { groupId: match[1], text: text.slice(match[0].length).trim() };
}

// Same tagged-DM-message trick as expense invites, for inviting a collaborator to co-edit a list.
const LIST_INVITE_TAG = /^\[\[list-invite:([0-9a-fA-F-]{36})\]\]/;

function buildListInviteMessage(listId: string, listTitle: string): string {
  return `[[list-invite:${listId}]]Invited you to co-edit the list "${listTitle}".`;
}

function parseListInviteMessage(text: string): { listId: string; text: string } | null {
  const match = text.match(LIST_INVITE_TAG);
  if (!match) return null;
  return { listId: match[1], text: text.slice(match[0].length).trim() };
}

function AppShell() {
  const { currentUserId, isAuthenticated, isLoading: authLoading } = useAuthSession();
  const { data, isLoading: dataLoading, error: dataError } = useAppData(currentUserId);
  const actions = useAppActions(currentUserId);
  const { messages: dmMessages, sendMessage: sendDmMessage } = useMessages(currentUserId);
  const {
    groups: expenseGroups,
    error: expenseGroupsError,
    createGroup: createExpenseGroup,
    inviteMember: inviteExpenseGroupMember,
    respondToInvite: respondToExpenseInvite,
    removeMember: removeExpenseGroupMember,
    renameGroup: renameExpenseGroup,
    deleteGroup: deleteExpenseGroup,
  } = useExpenseGroups(currentUserId);

  const [magicLinkEmail, setMagicLinkEmail] = useState('');
  const [magicLinkSent, setMagicLinkSent] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const [page, setPage] = useState<PageMode>('home');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mapSearchPopoverOpen, setMapSearchPopoverOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedListId, setSelectedListId] = useState('');
  const [listDetailId, setListDetailId] = useState<string | null>(null);
  const [peopleListOpen, setPeopleListOpen] = useState<{ userId: string; mode: 'followers' | 'following' } | null>(null);
  const [viewedProfileId, setViewedProfileId] = useState<string | null>(null);
  const [dmThreadUserId, setDmThreadUserId] = useState<string>('');
  const [dmDraft, setDmDraft] = useState('');
  const [composerOpen, setComposerOpen] = useState(false);
  const [profileEditorOpen, setProfileEditorOpen] = useState(false);
  const [listFormMode, setListFormMode] = useState<'create' | 'edit'>('create');
  const [draft, setDraft] = useState<DraftList>(emptyDraft);
  const [listFormError, setListFormError] = useState<string | null>(null);
  const [listFormSubmitting, setListFormSubmitting] = useState(false);
  const [profileDraft, setProfileDraft] = useState<ProfileDraft>(EMPTY_PROFILE_DRAFT);
  const [importPlacesOpen, setImportPlacesOpen] = useState(false);
  const [collapsedDraftCategories, setCollapsedDraftCategories] = useState<Set<PlaceCategory>>(new Set());
  const [mapSearchPlace, setMapSearchPlace] = useState<PlaceSearchResult | null>(null);
  const [saveToListOpen, setSaveToListOpen] = useState(false);
  const [saveToListError, setSaveToListError] = useState<string | null>(null);
  const [saveToListSubmitting, setSaveToListSubmitting] = useState(false);
  const [inspectedPlaceId, setInspectedPlaceId] = useState<string | null>(null);
  const [openTimelineListIds, setOpenTimelineListIds] = useState<Set<string>>(new Set());
  const [selectedDayByListId, setSelectedDayByListId] = useState<Record<string, string | null>>({});
  const [placeSelectMode, setPlaceSelectMode] = useState(false);
  const [selectedPlaceIds, setSelectedPlaceIds] = useState<Set<string>>(new Set());
  const [groupTargetDayId, setGroupTargetDayId] = useState('');
  const [groupError, setGroupError] = useState<string | null>(null);
  const [recentlyWatchedListIds, setRecentlyWatchedListIds] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(RECENTLY_WATCHED_KEY);
      return raw ? (JSON.parse(raw) as string[]) : [];
    } catch {
      return [];
    }
  });

  const [expenseGroupDetailId, setExpenseGroupDetailId] = useState<string | null>(null);
  const [newExpenseGroupOpen, setNewExpenseGroupOpen] = useState(false);
  const [newExpenseGroupListId, setNewExpenseGroupListId] = useState('');
  const [newExpenseGroupName, setNewExpenseGroupName] = useState('');
  const [newExpenseGroupInviteIds, setNewExpenseGroupInviteIds] = useState<string[]>([]);
  const [newExpenseGroupError, setNewExpenseGroupError] = useState<string | null>(null);
  const [newExpenseGroupSubmitting, setNewExpenseGroupSubmitting] = useState(false);
  const [inviteSearchQuery, setInviteSearchQuery] = useState('');
  const [listInviteSearchQuery, setListInviteSearchQuery] = useState('');
  const [listCollaboratorsModalOpen, setListCollaboratorsModalOpen] = useState(false);
  const [editingExpenseGroupName, setEditingExpenseGroupName] = useState(false);
  const [expenseGroupNameDraft, setExpenseGroupNameDraft] = useState('');
  const [collapsedExpenseCategories, setCollapsedExpenseCategories] = useState<Set<ExpenseCategory>>(new Set());
  const [changingBaseCurrency, setChangingBaseCurrency] = useState(false);
  const [baseCurrencyError, setBaseCurrencyError] = useState<string | null>(null);
  const [settlingKey, setSettlingKey] = useState<string | null>(null);
  const [settlementAmountDraft, setSettlementAmountDraft] = useState('');
  const [settlementError, setSettlementError] = useState<string | null>(null);
  const [settlementSubmitting, setSettlementSubmitting] = useState(false);
  const [addExpenseFormOpen, setAddExpenseFormOpen] = useState(false);
  const [editingExpenseId, setEditingExpenseId] = useState<string | null>(null);
  const [addExpenseError, setAddExpenseError] = useState<string | null>(null);
  const [addExpenseSubmitting, setAddExpenseSubmitting] = useState(false);
  const [expenseForm, setExpenseForm] = useState({
    description: '',
    category: 'food' as ExpenseCategory,
    amount: '',
    currency: 'USD',
    spentAt: new Date().toISOString().slice(0, 10),
    paidBy: '',
    participantIds: [] as string[],
    splitMode: 'equal' as 'equal' | 'custom',
    customAmounts: {} as Record<string, string>,
  });

  useEffect(() => {
    try {
      localStorage.setItem(RECENTLY_WATCHED_KEY, JSON.stringify(recentlyWatchedListIds));
    } catch {
      // Best-effort persistence -- private browsing/full storage shouldn't break the feature.
    }
  }, [recentlyWatchedListIds]);

  const currentUser = data ? data.users.find((user) => user.id === data.currentUserId) : undefined;
  const selectedList = data ? data.lists.find((list) => list.id === selectedListId) ?? data.lists[0] : undefined;

  useEffect(() => {
    if (data && !selectedList && data.lists[0]) {
      setSelectedListId(data.lists[0].id);
    }
  }, [data, selectedList]);

  // Selection is scoped to whichever list is active on the map -- switching lists mid-selection
  // (e.g. by clicking a different list's marker) would otherwise leave stale place ids selected
  // against the wrong list's days.
  useEffect(() => {
    setSelectedPlaceIds(new Set());
    setGroupTargetDayId('');
  }, [selectedListId]);

  useEffect(() => {
    if (currentUser) {
      setProfileDraft(buildProfileDraft(currentUser));
    }
  }, [currentUser?.id]);

  const addDraftPlace = useCallback((place: DraftPlace) => {
    setDraft((current) => {
      if (findDuplicatePlace(current.places, place)) {
        setListFormError(`${place.name} is already in this list.`);
        return current;
      }

      setListFormError(null);
      return { ...current, places: [...current.places, place] };
    });
  }, []);

  const importDraftPlaces = useCallback((imported: DraftPlace[]) => {
    setDraft((current) => {
      const accepted: DraftPlace[] = [];
      for (const place of imported) {
        if (!findDuplicatePlace([...current.places, ...accepted], place)) {
          accepted.push(place);
        }
      }
      return { ...current, places: [...current.places, ...accepted] };
    });
    setImportPlacesOpen(false);
  }, []);

  const removeDraftPlace = useCallback((placeId: string) => {
    setDraft((current) => ({
      ...current,
      places: current.places.filter((place) => place.id !== placeId),
      days: current.days.map((tripDay) => ({ ...tripDay, placeIds: tripDay.placeIds.filter((id) => id !== placeId) })),
    }));
  }, []);

  const updateDraftPlaceCategory = useCallback((placeId: string, category: PlaceCategory) => {
    setDraft((current) => ({
      ...current,
      places: current.places.map((place) => (place.id === placeId ? { ...place, category } : place)),
    }));
  }, []);

  const updateDraftPlaceStay = useCallback((placeId: string, patch: { checkIn?: string; checkOut?: string }) => {
    setDraft((current) => ({
      ...current,
      places: current.places.map((place) => (place.id === placeId ? { ...place, ...patch } : place)),
    }));
  }, []);

  function toggleDraftCategory(category: PlaceCategory) {
    setCollapsedDraftCategories((current) => {
      const next = new Set(current);
      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }
      return next;
    });
  }

  const addDraftDay = useCallback(() => {
    setDraft((current) => ({
      ...current,
      days: [...current.days, { id: crypto.randomUUID(), label: `Day ${current.days.length + 1}`, placeIds: [] }],
    }));
  }, []);

  const removeDraftDay = useCallback((dayId: string) => {
    setDraft((current) => ({ ...current, days: current.days.filter((tripDay) => tripDay.id !== dayId) }));
  }, []);

  const renameDraftDay = useCallback((dayId: string, label: string) => {
    setDraft((current) => ({
      ...current,
      days: current.days.map((tripDay) => (tripDay.id === dayId ? { ...tripDay, label } : tripDay)),
    }));
  }, []);

  const setDraftDayDestination = useCallback((dayId: string, destination: string) => {
    setDraft((current) => ({
      ...current,
      days: current.days.map((tripDay) => (tripDay.id === dayId ? { ...tripDay, destination: destination || undefined } : tripDay)),
    }));
  }, []);

  const movePlaceToDraftDay = useCallback((placeId: string, targetDayId: string, beforePlaceId?: string) => {
    setDraft((current) => {
      const days = current.days.map((tripDay) => ({
        ...tripDay,
        placeIds: tripDay.placeIds.filter((id) => id !== placeId),
      }));

      const targetIndex = days.findIndex((tripDay) => tripDay.id === targetDayId);
      if (targetIndex === -1) {
        return { ...current, days };
      }

      const placeIds = [...days[targetIndex].placeIds];
      const insertAt = beforePlaceId ? placeIds.indexOf(beforePlaceId) : -1;
      if (insertAt === -1) {
        placeIds.push(placeId);
      } else {
        placeIds.splice(insertAt, 0, placeId);
      }

      days[targetIndex] = { ...days[targetIndex], placeIds };
      return { ...current, days };
    });
  }, []);

  /** Searching a place directly into a day (rather than via the top "Add a place" box) does both
   * halves at once: saves it to the list's places if it's genuinely new -- reusing the existing
   * entry instead of creating a duplicate if the same place was already saved -- and schedules
   * that place into this specific day. */
  const addSearchedPlaceToDay = useCallback((dayId: string, place: DraftPlace) => {
    setDraft((current) => {
      const existing = findDuplicatePlace(current.places, place);
      const resolvedPlace = existing ?? place;
      const places = existing ? current.places : [...current.places, place];

      const days = current.days.map((tripDay) => {
        if (tripDay.id !== dayId || tripDay.placeIds.includes(resolvedPlace.id)) {
          return tripDay;
        }
        return { ...tripDay, placeIds: [...tripDay.placeIds, resolvedPlace.id] };
      });

      return { ...current, places, days };
    });
  }, []);

  const unscheduleDraftPlace = useCallback((placeId: string) => {
    setDraft((current) => ({
      ...current,
      days: current.days.map((tripDay) => ({ ...tripDay, placeIds: tripDay.placeIds.filter((id) => id !== placeId) })),
    }));
  }, []);

  const setDraftPlaceTime = useCallback((dayId: string, placeId: string, range: PlaceTimeRange) => {
    setDraft((current) => ({
      ...current,
      days: current.days.map((tripDay) =>
        tripDay.id === dayId ? { ...tripDay, placeTimes: { ...tripDay.placeTimes, [placeId]: range } } : tripDay,
      ),
    }));
  }, []);

  // Private lists never show in Explore, even to their own owner -- RLS already keeps other
  // users' private lists out of `data.lists` entirely, but the owner's own private rows still come
  // through (they need those elsewhere, e.g. "My lists"), so this filters them back out here.
  const exploreLists = useMemo(
    () => (data ? filterByQuery(data.lists.filter((list) => !list.isPrivate), search) : []),
    [data, search],
  );

  const accountLists = useMemo(() => (data ? data.lists.filter((list) => list.ownerId === data.currentUserId) : []), [data]);

  const savedLists = useMemo(
    () =>
      data
        ? data.lists.filter(
            (list) => list.ownerId !== data.currentUserId && isSaved(data.savedLists, data.currentUserId, list.id),
          )
        : [],
    [data],
  );

  // Lists someone else owns but invited the current user to co-edit, and that invite has been
  // accepted. Kept separate from savedLists since "can edit" and "bookmarked" are different
  // relationships to a list, even though both show up as pins on your own map.
  const collaboratingLists = useMemo(
    () =>
      data
        ? data.lists.filter(
            (list) =>
              list.ownerId !== data.currentUserId &&
              list.collaborators.some((collaborator) => collaborator.userId === data.currentUserId && collaborator.status === 'accepted'),
          )
        : [],
    [data],
  );

  // Lists viewed via "Show on map" that the viewer neither owns, saved, nor collaborates on.
  // Filtered at render (rather than pruned from storage) so a list that later gets saved/joined
  // simply stops matching here, with no risk of appearing in more than one section at once.
  const recentlyWatchedLists = useMemo(
    () =>
      data
        ? recentlyWatchedListIds
            .map((id) => data.lists.find((list) => list.id === id))
            .filter((list): list is TripList => Boolean(list))
            .filter(
              (list) =>
                list.ownerId !== data.currentUserId &&
                !isSaved(data.savedLists, data.currentUserId, list.id) &&
                !list.collaborators.some((collaborator) => collaborator.userId === data.currentUserId && collaborator.status === 'accepted'),
            )
        : [],
    [data, recentlyWatchedListIds],
  );

  const myMapLists = useMemo(
    () => [...accountLists, ...collaboratingLists, ...savedLists, ...recentlyWatchedLists],
    [accountLists, collaboratingLists, savedLists, recentlyWatchedLists],
  );

  // When a list's sidebar timeline is open and a specific day is picked, the map should only
  // show that day's places; closed (or open with no day picked, i.e. "all days") shows everything.
  const mapDisplayLists = useMemo(() => {
    return myMapLists.map((list) => {
      if (!openTimelineListIds.has(list.id)) {
        return list;
      }

      const selectedDayId = selectedDayByListId[list.id];
      const day = selectedDayId ? list.days.find((tripDay) => tripDay.id === selectedDayId) : undefined;
      // Timeline open with no specific day picked ("All days") -- show everything scheduled
      // into a day, not every saved place (some may never have been dragged into the plan).
      const visiblePlaceIds = day ? new Set(day.placeIds) : getScheduledPlaceIds(list);

      return { ...list, places: list.places.filter((place) => visiblePlaceIds.has(place.id)) };
    });
  }, [myMapLists, openTimelineListIds, selectedDayByListId]);

  // Grouping only makes sense for a list actually shown on the map, with days to group into, and
  // that the current user is allowed to edit (owner or accepted collaborator) -- same permission
  // shape as the "Edit list" button in the list detail modal.
  const canGroupSelectedList = Boolean(
    data &&
      selectedList &&
      myMapLists.some((list) => list.id === selectedList.id) &&
      selectedList.days.length > 0 &&
      (selectedList.ownerId === data.currentUserId ||
        selectedList.collaborators.some((collaborator) => collaborator.userId === data.currentUserId && collaborator.status === 'accepted')),
  );

  const peopleToFollow = useMemo(() => (data ? data.users.filter((user) => user.id !== data.currentUserId) : []), [data]);

  const listDetail = data ? data.lists.find((list) => list.id === listDetailId) ?? null : null;
  const listDetailOwner = data && listDetail ? data.users.find((user) => user.id === listDetail.ownerId) : undefined;
  const inspectedPlace = listDetail?.places.find((place) => place.id === inspectedPlaceId) ?? null;

  const listDetailIsOwner = Boolean(data && listDetail && listDetail.ownerId === data.currentUserId);
  const listDetailCollaboratorEntries =
    data && listDetail
      ? listDetail.collaborators
          .map((collaborator) => ({ collaborator, user: data.users.find((user) => user.id === collaborator.userId) }))
          .filter((entry): entry is { collaborator: (typeof listDetail.collaborators)[number]; user: AppData['users'][number] } =>
            Boolean(entry.user),
          )
      : [];
  const listDetailAcceptedCollaborators = listDetailCollaboratorEntries.filter(({ collaborator }) => collaborator.status === 'accepted');
  const listDetailPendingCollaborators = listDetailCollaboratorEntries.filter(({ collaborator }) => collaborator.status === 'invited');
  const listDetailCanEdit =
    listDetailIsOwner || (data ? listDetailAcceptedCollaborators.some(({ user }) => user.id === data.currentUserId) : false);
  const listInviteCandidates =
    data && listDetail
      ? data.users.filter((user) => user.id !== listDetail.ownerId && !listDetail.collaborators.some((c) => c.userId === user.id))
      : [];
  const normalizedListInviteSearch = listInviteSearchQuery.trim().toLowerCase();
  const listInviteSearchResults = normalizedListInviteSearch
    ? listInviteCandidates.filter(
        (user) => user.name.toLowerCase().includes(normalizedListInviteSearch) || user.handle.toLowerCase().includes(normalizedListInviteSearch),
      )
    : [];

  const mapSearchPlaceSaved = useMemo(
    () => (mapSearchPlace ? Boolean(findDuplicatePlace(accountLists.flatMap((list) => list.places), mapSearchPlace)) : false),
    [accountLists, mapSearchPlace],
  );

  const viewedProfile = data ? data.users.find((user) => user.id === viewedProfileId) ?? null : null;
  const viewedProfileStats = data && viewedProfile ? getUserStats(viewedProfile.id, data) : null;
  const viewedProfileLists = data && viewedProfile ? data.lists.filter((list) => list.ownerId === viewedProfile.id) : [];

  const peopleListUsers =
    data && peopleListOpen
      ? peopleListOpen.mode === 'followers'
        ? getFollowerUsers(peopleListOpen.userId, data)
        : getFollowingUsers(peopleListOpen.userId, data)
      : [];

  const myExpenseMembership = (group: ExpenseGroupWithMembers) =>
    group.members.find((member) => member.userId === data?.currentUserId);
  const activeExpenseGroups = data ? expenseGroups.filter((group) => myExpenseMembership(group)?.status === 'accepted') : [];
  const pendingExpenseInvites = data ? expenseGroups.filter((group) => myExpenseMembership(group)?.status === 'invited') : [];

  const expenseGroupDetail = expenseGroups.find((group) => group.id === expenseGroupDetailId) ?? null;
  const expenseGroupDetailMembers = data && expenseGroupDetail
    ? expenseGroupDetail.members
        .map((member) => ({ member, user: data.users.find((user) => user.id === member.userId) }))
        .filter((entry): entry is { member: (typeof expenseGroupDetail.members)[number]; user: AppData['users'][number] } =>
          Boolean(entry.user),
        )
    : [];
  const acceptedGroupMembers = expenseGroupDetailMembers.filter(({ member }) => member.status === 'accepted');
  const acceptedGroupMemberIds = acceptedGroupMembers.map(({ user }) => user.id);
  const inviteCandidates =
    data && expenseGroupDetail
      ? data.users.filter(
          (user) => user.id !== data.currentUserId && !expenseGroupDetail.members.some((member) => member.userId === user.id),
        )
      : [];
  const normalizedInviteSearch = inviteSearchQuery.trim().toLowerCase();
  const inviteSearchResults = normalizedInviteSearch
    ? inviteCandidates.filter(
        (user) => user.name.toLowerCase().includes(normalizedInviteSearch) || user.handle.toLowerCase().includes(normalizedInviteSearch),
      )
    : [];

  const {
    expenses: groupExpenses,
    settlements: groupSettlements,
    error: groupExpensesError,
    addExpense: addGroupExpense,
    updateExpense: updateGroupExpense,
    deleteExpense: deleteGroupExpense,
    addSettlement: addGroupSettlement,
    deleteSettlement: deleteGroupSettlement,
    changeBaseCurrency: changeGroupBaseCurrency,
  } = useGroupExpenses(expenseGroupDetailId, expenseGroupDetail?.baseCurrency);

  const groupBalances = computeBalances(acceptedGroupMemberIds, groupExpenses, groupSettlements);
  const debtSuggestions = simplifyDebts(groupBalances);

  // Category/member breakdowns always work in the group's base currency (each expense's
  // convertedAmount / share-amount * exchangeRate), so mixed-currency expenses still sum sensibly.
  const expenseCategoryTotals = groupExpensesByCategory(groupExpenses).map((group, index) => ({
    category: group.category,
    total: group.expenses.reduce((sum, expense) => sum + expense.convertedAmount, 0),
    color: defaultColorForIndex(index),
  }));
  const equalSplitExpenses = groupExpenses.filter((expense) => isEquallySplit(expense));
  const customSplitExpenses = groupExpenses.filter((expense) => !isEquallySplit(expense));
  // Who fronted the money for equally-split expenses -- distinct from what each person owes
  // (which is the same for everyone in an equal split, so a pie of *owed* amounts would just show
  // equal-sized slices and say nothing useful).
  const equalSplitPaidTotals = acceptedGroupMembers.map(({ user }, index) => ({
    userId: user.id,
    label: user.name,
    total: equalSplitExpenses
      .filter((expense) => expense.paidBy === user.id)
      .reduce((sum, expense) => sum + expense.convertedAmount, 0),
    color: defaultColorForIndex(index),
  }));
  const customSplitMemberTotals = acceptedGroupMembers.map(({ user }, index) => ({
    userId: user.id,
    label: user.name,
    total: customSplitExpenses.reduce((sum, expense) => {
      const share = expense.shares.find((entry) => entry.userId === user.id);
      return sum + (share ? share.amount * expense.exchangeRate : 0);
    }, 0),
    color: defaultColorForIndex(index),
  }));
  // Each person's actual cost after splitting -- their owed share across every expense, equal or
  // custom alike -- as opposed to `groupBalances`, which nets that against what they paid and any
  // settlements. This is "what did this trip cost me," not "who owes whom."
  const totalSpentPerMember = acceptedGroupMembers.map(({ user }, index) => ({
    userId: user.id,
    label: user.name,
    total: groupExpenses.reduce((sum, expense) => {
      const share = expense.shares.find((entry) => entry.userId === user.id);
      return sum + (share ? share.amount * expense.exchangeRate : 0);
    }, 0),
    color: defaultColorForIndex(index),
  }));

  useEffect(() => {
    if (!dmThreadUserId && peopleToFollow[0]) {
      setDmThreadUserId(peopleToFollow[0].id);
    }
  }, [dmThreadUserId, peopleToFollow]);

  const listDetailRatingSummary =
    data && listDetail ? getListSummary(listDetail.id, data.ratings) : { count: 0, average: 0 };
  const listDetailYourRating =
    data && listDetail
      ? data.ratings.find((rating) => rating.listId === listDetail.id && rating.userId === data.currentUserId)
      : undefined;

  const stats = useMemo(() => {
    if (!data || !currentUser) {
      return { followers: 0, following: 0, trips: 0, avgRating: 0 };
    }

    return getUserStats(currentUser.id, data);
  }, [currentUser, data]);

  if (authLoading) {
    return (
      <div className="auth-screen">
        <section className="auth-screen__panel panel">
          <div className="auth-screen__badge">EatMap</div>
          <p>Loading…</p>
        </section>
      </div>
    );
  }

  if (!isAuthenticated) {
    async function handleGoogleSignInClick() {
      setAuthError(null);
      try {
        await signInWithGoogle();
      } catch (error) {
        setAuthError(error instanceof Error ? error.message : 'Could not start Google sign-in.');
      }
    }

    async function sendMagicLink(event: FormEvent<HTMLFormElement>) {
      event.preventDefault();
      const email = magicLinkEmail.trim();
      if (!email) {
        return;
      }

      setAuthError(null);
      try {
        await signInWithMagicLink(email);
        setMagicLinkSent(true);
      } catch (error) {
        setAuthError(error instanceof Error ? error.message : 'Could not send the sign-in link.');
      }
    }

    return (
      <div className="auth-screen">
        <section className="auth-screen__panel panel">
          <div className="auth-screen__badge">EatMap</div>
          <div className="auth-screen__copy">
            <p className="eyebrow">Trip planning social map</p>
            <h1>Sign in to continue.</h1>
            <p>Use Google to get into your trip map, explore other travelers, and manage your own saved lists.</p>
          </div>

          {supabaseConfigError ? <p className="place-autocomplete__error">{supabaseConfigError}</p> : null}

          <button
            className="primary-button auth-screen__google-button"
            type="button"
            onClick={handleGoogleSignInClick}
            disabled={!isSupabaseConfigured}
          >
            Continue with Google
          </button>

          <div className="auth-divider">
            <span>or</span>
          </div>

          {magicLinkSent ? (
            <p className="auth-local-form__hint">
              Check <strong>{magicLinkEmail}</strong> for a sign-in link.
            </p>
          ) : (
            <form className="auth-local-form" onSubmit={sendMagicLink}>
              <label>
                <span>Email</span>
                <input
                  type="email"
                  value={magicLinkEmail}
                  onChange={(event) => setMagicLinkEmail(event.target.value)}
                  placeholder="you@example.com"
                  required
                />
              </label>
              <button className="secondary-button" type="submit" disabled={!isSupabaseConfigured}>
                Email me a sign-in link
              </button>
              <p className="auth-local-form__hint">No password needed — we'll email you a one-time link.</p>
            </form>
          )}

          {authError ? <p className="place-autocomplete__error">{authError}</p> : null}
        </section>
      </div>
    );
  }

  if (dataLoading || !data || !currentUser) {
    return (
      <div className="auth-screen">
        <section className="auth-screen__panel panel">
          <div className="auth-screen__badge">EatMap</div>
          <p>{dataError ? 'Something went wrong loading your trips.' : 'Loading your trips…'}</p>
        </section>
      </div>
    );
  }

  // Named separately from `data`/`currentUser` above: those are typed as possibly-null/undefined
  // because they're read before this guard runs, and TypeScript can't see across the closures
  // below that this guard has already ruled that out by the time they're ever called.
  const appData: AppData = data;
  const appUser: User = currentUser;

  function signOut() {
    void signOutOfSupabase();
  }

  async function sendDirectMessage() {
    const text = dmDraft.trim();
    if (!text || !dmThreadUserId) {
      return;
    }

    await sendDmMessage(dmThreadUserId, text);
    setDmDraft('');
  }

  async function toggleFollow(targetUserId: string) {
    if (targetUserId === appData.currentUserId) {
      return;
    }

    await actions.toggleFollow(targetUserId, isFollowing(appData.follows, appData.currentUserId, targetUserId));
  }

  async function toggleSaveList(listId: string) {
    await actions.toggleSaveList(listId, isSaved(appData.savedLists, appData.currentUserId, listId));
  }

  async function toggleLike(listId: string) {
    await actions.toggleLike(listId, isLiked(appData.likes, appData.currentUserId, listId));
  }

  async function updatePlaceAttachment(placeId: string, attachment: PlaceAttachment | null) {
    await actions.saveAttachment(placeId, attachment);
  }

  function openCreateList() {
    setListFormMode('create');
    setDraft({ ...emptyDraft, color: defaultColorForIndex(accountLists.length) });
    setListFormError(null);
    setComposerOpen(true);
  }

  function openProfileEditor() {
    setProfileDraft(buildProfileDraft(appUser));
    setProfileEditorOpen(true);
  }

  function openEditList(list: TripList) {
    setListFormMode('edit');
    setDraft(buildListDraft(list));
    setSelectedListId(list.id);
    setListDetailId(null);
    setListFormError(null);
    setComposerOpen(true);
  }

  async function submitListInvite(userId: string) {
    if (!listDetail) return;
    await actions.inviteListCollaborator(listDetail.id, userId);
    await sendDmMessage(userId, buildListInviteMessage(listDetail.id, listDetail.title));
    setListInviteSearchQuery('');
  }

  function handleMapPlaceFound(place: PlaceSearchResult) {
    setMapSearchPlace(place);
    setSaveToListOpen(false);
    setSaveToListError(null);
  }

  function discardMapSearchPlace() {
    setMapSearchPlace(null);
    setSaveToListOpen(false);
    setSaveToListError(null);
  }

  async function togglePlaceInList(list: TripList) {
    if (!mapSearchPlace) {
      return;
    }

    const existing = findDuplicatePlace(list.places, mapSearchPlace);

    setSaveToListSubmitting(true);
    setSaveToListError(null);
    try {
      await actions.togglePlaceInList(list.id, mapSearchPlace, existing?.id);
    } catch (error) {
      console.error('togglePlaceInList failed:', error);
      setSaveToListError(describeQueryError(error));
    } finally {
      setSaveToListSubmitting(false);
    }
  }

  function startNewListWithMapPlace() {
    if (!mapSearchPlace) {
      return;
    }

    setListFormMode('create');
    setDraft({ ...emptyDraft, places: [mapSearchPlace], color: defaultColorForIndex(accountLists.length) });
    setListFormError(null);
    setMapSearchPlace(null);
    setSaveToListOpen(false);
    setComposerOpen(true);
  }

  function openListDetail(listId: string) {
    setListDetailId(listId);
    setListCollaboratorsModalOpen(false);
    setListInviteSearchQuery('');
  }

  function toggleListTimeline(listId: string) {
    setOpenTimelineListIds((current) => {
      const next = new Set(current);
      if (next.has(listId)) {
        next.delete(listId);
      } else {
        next.add(listId);
      }
      return next;
    });
  }

  function showListOnMap(listId: string) {
    const list = data?.lists.find((item) => item.id === listId);
    const isOwned = list?.ownerId === data?.currentUserId;
    const alreadySaved = data ? isSaved(data.savedLists, data.currentUserId, listId) : false;
    if (list && !isOwned && !alreadySaved) {
      setRecentlyWatchedListIds((current) => [listId, ...current.filter((id) => id !== listId)].slice(0, RECENTLY_WATCHED_LIMIT));
    }

    setSelectedListId(listId);
    setPage('home');
    setListDetailId(null);
  }

  function togglePlaceSelection(placeId: string) {
    setSelectedPlaceIds((current) => {
      const next = new Set(current);
      if (next.has(placeId)) {
        next.delete(placeId);
      } else {
        next.add(placeId);
      }
      return next;
    });
  }

  function exitPlaceSelectMode() {
    setPlaceSelectMode(false);
    setSelectedPlaceIds(new Set());
    setGroupTargetDayId('');
    setGroupError(null);
  }

  async function assignSelectedPlacesToDay() {
    if (!groupTargetDayId || selectedPlaceIds.size === 0) return;
    setGroupError(null);
    try {
      await actions.assignPlacesToDay(groupTargetDayId, Array.from(selectedPlaceIds));
      exitPlaceSelectMode();
    } catch (error) {
      console.error('assignPlacesToDay failed:', error);
      setGroupError(describeQueryError(error));
    }
  }

  function openProfile(userId: string) {
    if (userId === appData.currentUserId) {
      setListDetailId(null);
      setPeopleListOpen(null);
      setViewedProfileId(null);
      setPage('account');
      return;
    }

    setListDetailId(null);
    setPeopleListOpen(null);
    setViewedProfileId(userId);
  }

  async function handleCoverFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) {
      return;
    }

    const url = await uploadPublicMedia(appData.currentUserId, file);
    setDraft((current) => ({ ...current, coverImage: url }));
  }

  async function handleAvatarFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) {
      return;
    }

    const url = await uploadPublicMedia(appData.currentUserId, file);
    setProfileDraft((current) => ({ ...current, avatarImage: url }));
  }

  async function rateList(listId: string, ownerId: string | undefined, score: number) {
    await actions.rateList(listId, ownerId, score);
  }

  async function submitListForm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setListFormError(null);

    if (!draft.title.trim()) {
      setListFormError('Title is required.');
      return;
    }

    const editingListId = listFormMode === 'edit' ? selectedList?.id : undefined;
    const preparedDraft: DraftList = { ...draft, coverImage: draft.coverImage.trim() || DEFAULT_COVER };

    setListFormSubmitting(true);
    let resultId: string;
    try {
      resultId = await actions.saveList(listFormMode, editingListId, preparedDraft);
    } catch (error) {
      console.error('saveList failed:', error);
      setListFormError(describeQueryError(error));
      return;
    } finally {
      setListFormSubmitting(false);
    }

    setSelectedListId(resultId);
    setComposerOpen(false);
    setDraft(emptyDraft);
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    await actions.saveProfile({
      name: profileDraft.name.trim() || undefined,
      handle: profileDraft.handle.trim() || undefined,
      city: profileDraft.city.trim() || undefined,
      bio: profileDraft.bio.trim() || undefined,
      avatar: profileDraft.avatar.trim() || undefined,
      avatarImageUrl: profileDraft.avatarImage.trim(),
    });
    setProfileEditorOpen(false);
  }

  function openNewExpenseGroup() {
    setNewExpenseGroupListId(accountLists[0]?.id ?? '');
    setNewExpenseGroupName('');
    setNewExpenseGroupInviteIds([]);
    setNewExpenseGroupError(null);
    setNewExpenseGroupOpen(true);
  }

  function toggleNewExpenseGroupInvite(userId: string) {
    setNewExpenseGroupInviteIds((current) =>
      current.includes(userId) ? current.filter((id) => id !== userId) : [...current, userId],
    );
  }

  async function submitNewExpenseGroup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNewExpenseGroupError(null);

    const listId = newExpenseGroupListId;
    const name = newExpenseGroupName.trim();
    if (!listId || !name) {
      setNewExpenseGroupError('Pick a trip and give the group a name.');
      return;
    }

    setNewExpenseGroupSubmitting(true);
    try {
      // No currency picker at creation time -- each expense sets its own currency, and the group's
      // base currency (used only for converted totals/balances) defaults to USD.
      const groupId = await createExpenseGroup(listId, name, 'USD', newExpenseGroupInviteIds);
      const tripTitle = accountLists.find((list) => list.id === listId)?.title ?? 'a trip';
      await Promise.all(
        newExpenseGroupInviteIds.map((userId) => sendDmMessage(userId, buildExpenseInviteMessage(groupId, tripTitle, name))),
      );
      setNewExpenseGroupOpen(false);
      setExpenseGroupDetailId(groupId);
    } catch (error) {
      console.error('createExpenseGroup failed:', error);
      setNewExpenseGroupError(describeQueryError(error));
    } finally {
      setNewExpenseGroupSubmitting(false);
    }
  }

  async function submitInviteMore(userId: string) {
    if (!expenseGroupDetail) return;
    await inviteExpenseGroupMember(expenseGroupDetail.id, userId);
    const tripTitle = data?.lists.find((list) => list.id === expenseGroupDetail.listId)?.title ?? 'a trip';
    await sendDmMessage(userId, buildExpenseInviteMessage(expenseGroupDetail.id, tripTitle, expenseGroupDetail.name));
    setInviteSearchQuery('');
  }

  function startEditingExpenseGroupName() {
    if (!expenseGroupDetail) return;
    setExpenseGroupNameDraft(expenseGroupDetail.name);
    setEditingExpenseGroupName(true);
  }

  async function submitExpenseGroupName() {
    if (!expenseGroupDetail) return;
    const name = expenseGroupNameDraft.trim();
    setEditingExpenseGroupName(false);
    if (!name || name === expenseGroupDetail.name) return;
    await renameExpenseGroup(expenseGroupDetail.id, name);
  }

  async function submitBaseCurrencyChange(baseCurrency: string) {
    if (!expenseGroupDetail || baseCurrency === expenseGroupDetail.baseCurrency) return;
    setBaseCurrencyError(null);
    setChangingBaseCurrency(true);
    try {
      await changeGroupBaseCurrency(baseCurrency);
    } catch (error) {
      console.error('changeBaseCurrency failed:', error);
      setBaseCurrencyError(describeQueryError(error));
    } finally {
      setChangingBaseCurrency(false);
    }
  }

  function startRecordingPayment(suggestion: { fromUser: string; toUser: string; amount: number }) {
    setSettlingKey(`${suggestion.fromUser}_${suggestion.toUser}`);
    setSettlementAmountDraft(suggestion.amount.toFixed(2));
    setSettlementError(null);
  }

  async function submitSettlement(suggestion: { fromUser: string; toUser: string; amount: number }) {
    const amount = Number(settlementAmountDraft);
    if (!amount || amount <= 0) {
      setSettlementError('Enter a positive amount.');
      return;
    }

    setSettlementSubmitting(true);
    setSettlementError(null);
    try {
      await addGroupSettlement(suggestion.fromUser, suggestion.toUser, amount);
      setSettlingKey(null);
    } catch (error) {
      console.error('addSettlement failed:', error);
      setSettlementError(describeQueryError(error));
    } finally {
      setSettlementSubmitting(false);
    }
  }

  async function deleteCurrentExpenseGroup() {
    if (!expenseGroupDetail) return;
    if (!window.confirm(`Delete "${expenseGroupDetail.name}"? This removes the group and all its expenses for everyone.`)) return;
    await deleteExpenseGroup(expenseGroupDetail.id);
    setExpenseGroupDetailId(null);
  }

  function toggleExpenseCategory(category: ExpenseCategory) {
    setCollapsedExpenseCategories((current) => {
      const next = new Set(current);
      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }
      return next;
    });
  }

  function openAddExpenseForm() {
    if (!expenseGroupDetail) return;
    setExpenseForm({
      description: '',
      category: 'food',
      amount: '',
      currency: expenseGroupDetail.baseCurrency,
      spentAt: new Date().toISOString().slice(0, 10),
      paidBy: appData.currentUserId,
      participantIds: acceptedGroupMemberIds,
      splitMode: 'equal',
      customAmounts: {},
    });
    setEditingExpenseId(null);
    setAddExpenseError(null);
    setAddExpenseFormOpen(true);
  }

  function openEditExpenseForm(expense: Expense) {
    const equalSplit = isEquallySplit(expense);
    setExpenseForm({
      description: expense.description,
      category: expense.category,
      amount: String(expense.amount),
      currency: expense.currency,
      spentAt: expense.spentAt,
      paidBy: expense.paidBy,
      participantIds: expense.shares.map((share) => share.userId),
      splitMode: equalSplit ? 'equal' : 'custom',
      customAmounts: Object.fromEntries(expense.shares.map((share) => [share.userId, String(share.amount)])),
    });
    setEditingExpenseId(expense.id);
    setAddExpenseError(null);
    setAddExpenseFormOpen(true);
  }

  function toggleExpenseParticipant(userId: string) {
    setExpenseForm((current) => ({
      ...current,
      participantIds: current.participantIds.includes(userId)
        ? current.participantIds.filter((id) => id !== userId)
        : [...current.participantIds, userId],
    }));
  }

  async function submitExpenseForm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAddExpenseError(null);

    const amount = Number(expenseForm.amount);
    if (!expenseForm.description.trim() || !amount || amount <= 0 || expenseForm.participantIds.length === 0) {
      setAddExpenseError('Add a description, a positive amount, and at least one participant.');
      return;
    }

    const shares =
      expenseForm.splitMode === 'equal'
        ? splitEqually(amount, expenseForm.participantIds)
        : expenseForm.participantIds.map((userId) => ({
            userId,
            amount: Number(expenseForm.customAmounts[userId] || 0),
          }));

    if (expenseForm.splitMode === 'custom' && !sharesSumTo(shares, amount)) {
      setAddExpenseError('The custom split has to add up to the total amount.');
      return;
    }

    const payload = {
      paidBy: expenseForm.paidBy,
      description: expenseForm.description.trim(),
      category: expenseForm.category,
      amount,
      currency: expenseForm.currency,
      spentAt: expenseForm.spentAt,
      shares,
    };

    setAddExpenseSubmitting(true);
    try {
      if (editingExpenseId) {
        await updateGroupExpense(editingExpenseId, payload);
      } else {
        await addGroupExpense(payload);
      }
      setAddExpenseFormOpen(false);
      setEditingExpenseId(null);
    } catch (error) {
      console.error('addExpense failed:', error);
      setAddExpenseError(describeQueryError(error));
    } finally {
      setAddExpenseSubmitting(false);
    }
  }

  const draftDestinationColors = buildDestinationColors(draft.days);
  const draftDestinations = Array.from(new Set(draft.days.map((tripDay) => tripDay.destination).filter(Boolean))) as string[];

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar__brand">
          <strong>EatMap</strong>
        </div>

        <nav className="topbar__nav" aria-label="Main navigation">
          <button
            className={`nav-tab${page === 'home' ? ' nav-tab--active' : ''}`}
            type="button"
            onClick={() => setPage('home')}
            aria-label="Map"
            title="Map"
          >
            <MapIcon aria-hidden="true" size={19} strokeWidth={1.75} />
          </button>
          <button
            className={`nav-tab${page === 'explore' ? ' nav-tab--active' : ''}`}
            type="button"
            onClick={() => setPage('explore')}
            aria-label="Explore"
            title="Explore"
          >
            <Compass aria-hidden="true" size={19} strokeWidth={1.75} />
          </button>
          <button
            className={`nav-tab${page === 'dm' ? ' nav-tab--active' : ''}`}
            type="button"
            onClick={() => setPage('dm')}
            aria-label="Messages"
            title="Messages"
          >
            <MessageCircle aria-hidden="true" size={19} strokeWidth={1.75} />
          </button>
          <button
            className={`nav-tab${page === 'expenses' ? ' nav-tab--active' : ''}`}
            type="button"
            onClick={() => setPage('expenses')}
            aria-label="Expenses"
            title="Expenses"
          >
            <DollarSign aria-hidden="true" size={19} strokeWidth={1.75} />
            {pendingExpenseInvites.length > 0 ? <span className="nav-tab__badge">{pendingExpenseInvites.length}</span> : null}
          </button>
          <button
            className={`nav-tab${page === 'account' ? ' nav-tab--active' : ''}`}
            type="button"
            onClick={() => setPage('account')}
            aria-label="Account"
            title="Account"
          >
            <UserIcon aria-hidden="true" size={19} strokeWidth={1.75} />
          </button>
        </nav>

      </header>

      {page === 'home' ? (
        <div className="map-page page-transition">
          <MapPanel
            lists={mapDisplayLists}
            selectedListId={selectedList?.id ?? myMapLists[0]?.id ?? ''}
            onSelectList={setSelectedListId}
            previewPlace={mapSearchPlace}
            previewPlaceSaved={mapSearchPlaceSaved}
            onSavePreviewPlace={() => setSaveToListOpen(true)}
            onDismissPreviewPlace={discardMapSearchPlace}
            onDiscoverPlace={handleMapPlaceFound}
            selectMode={placeSelectMode}
            selectedPlaceIds={selectedPlaceIds}
            onTogglePlaceSelect={togglePlaceSelection}
          />

          {sidebarOpen ? (
            <aside className="map-sidebar panel">
              <div className="map-sidebar__header">
                <h3>Lists</h3>
                <button className="icon-button" type="button" onClick={() => setSidebarOpen(false)} aria-label="Hide sidebar">
                  ‹
                </button>
              </div>

              <div className="sidebar__section map-quick-add">
                <div className="section-heading">
                  <h3>Add a place</h3>
                </div>
                <PlaceAutocomplete onAdd={handleMapPlaceFound} />
                <small className="draft-places__empty">
                  {mapSearchPlace ? 'See details and Save on the pin below.' : 'Search to drop a pin on the map.'}
                </small>
              </div>

              <div className="sidebar__section">
                <div className="section-heading">
                  <h3>My lists</h3>
                  <span>{accountLists.length}</span>
                </div>
                <div className="account-list-sidebar">
                  {accountLists.length ? (
                    accountLists.map((list) => (
                      <SidebarListItem
                        key={list.id}
                        list={list}
                        active={list.id === selectedListId}
                        onSelect={() => setSelectedListId(list.id)}
                        onView={() => openListDetail(list.id)}
                        timelineOpen={openTimelineListIds.has(list.id)}
                        onToggleTimeline={() => toggleListTimeline(list.id)}
                        selectedDayId={selectedDayByListId[list.id] ?? null}
                        onSelectDay={(dayId) => setSelectedDayByListId((current) => ({ ...current, [list.id]: dayId }))}
                      />
                    ))
                  ) : (
                    <p className="sidebar__empty">You haven't created a list yet.</p>
                  )}
                </div>
              </div>

              {collaboratingLists.length > 0 ? (
                <div className="sidebar__section">
                  <div className="section-heading">
                    <h3>Collaborating</h3>
                    <span>{collaboratingLists.length}</span>
                  </div>
                  <div className="account-list-sidebar">
                    {collaboratingLists.map((list) => (
                      <SidebarListItem
                        key={list.id}
                        list={list}
                        active={list.id === selectedListId}
                        onSelect={() => setSelectedListId(list.id)}
                        onView={() => openListDetail(list.id)}
                        timelineOpen={openTimelineListIds.has(list.id)}
                        onToggleTimeline={() => toggleListTimeline(list.id)}
                        selectedDayId={selectedDayByListId[list.id] ?? null}
                        onSelectDay={(dayId) => setSelectedDayByListId((current) => ({ ...current, [list.id]: dayId }))}
                      />
                    ))}
                  </div>
                </div>
              ) : null}

              <div className="sidebar__section">
                <div className="section-heading">
                  <h3>Saved lists</h3>
                  <span>{savedLists.length}</span>
                </div>
                <div className="account-list-sidebar">
                  {savedLists.length ? (
                    savedLists.map((list) => (
                      <SidebarListItem
                        key={list.id}
                        list={list}
                        active={list.id === selectedListId}
                        onSelect={() => setSelectedListId(list.id)}
                        onView={() => openListDetail(list.id)}
                        timelineOpen={openTimelineListIds.has(list.id)}
                        onToggleTimeline={() => toggleListTimeline(list.id)}
                        selectedDayId={selectedDayByListId[list.id] ?? null}
                        onSelectDay={(dayId) => setSelectedDayByListId((current) => ({ ...current, [list.id]: dayId }))}
                      />
                    ))
                  ) : (
                    <p className="sidebar__empty">Save a list from Explore to pin it here.</p>
                  )}
                </div>
              </div>

              {recentlyWatchedLists.length > 0 ? (
                <div className="sidebar__section">
                  <div className="section-heading">
                    <h3>Recently watched</h3>
                    <span>{recentlyWatchedLists.length}</span>
                  </div>
                  <div className="account-list-sidebar">
                    {recentlyWatchedLists.map((list) => (
                      <SidebarListItem
                        key={list.id}
                        list={list}
                        active={list.id === selectedListId}
                        onSelect={() => setSelectedListId(list.id)}
                        onView={() => openListDetail(list.id)}
                        timelineOpen={openTimelineListIds.has(list.id)}
                        onToggleTimeline={() => toggleListTimeline(list.id)}
                        selectedDayId={selectedDayByListId[list.id] ?? null}
                        onSelectDay={(dayId) => setSelectedDayByListId((current) => ({ ...current, [list.id]: dayId }))}
                      />
                    ))}
                  </div>
                </div>
              ) : null}
            </aside>
          ) : (
            <div className="map-search-float">
              <button
                className="map-search-float__button icon-button"
                type="button"
                onClick={() => setSidebarOpen(true)}
                aria-label="Show sidebar"
                title="Show sidebar"
              >
                ›
              </button>
              <button
                className="map-search-float__button icon-button"
                type="button"
                onClick={() => setMapSearchPopoverOpen((open) => !open)}
                aria-label="Search places"
                aria-expanded={mapSearchPopoverOpen}
              >
                <Search aria-hidden="true" size={19} strokeWidth={1.75} />
              </button>
              <button
                className="map-search-float__button icon-button"
                type="button"
                onClick={openCreateList}
                aria-label="Create a new list"
                title="Create a new list"
              >
                <Plus aria-hidden="true" size={19} strokeWidth={1.75} />
              </button>

              {mapSearchPopoverOpen ? (
                <div className="map-search-float__popover panel">
                  <div className="map-search-float__header">
                    <strong>Search places</strong>
                    <button
                      className="icon-button"
                      type="button"
                      onClick={() => setMapSearchPopoverOpen(false)}
                      aria-label="Close search"
                      title="Close search"
                    >
                      ×
                    </button>
                  </div>
                  <PlaceAutocomplete
                    onAdd={(place) => {
                      handleMapPlaceFound(place);
                      setMapSearchPopoverOpen(false);
                    }}
                  />
                </div>
              ) : null}
            </div>
          )}

          {canGroupSelectedList ? (
            <div className="map-group-toolbar panel">
              {!placeSelectMode ? (
                <button type="button" className="secondary-button" onClick={() => setPlaceSelectMode(true)}>
                  Select places to group
                </button>
              ) : (
                <>
                  <span className="map-group-toolbar__count">
                    {selectedPlaceIds.size > 0 ? `${selectedPlaceIds.size} selected` : 'Click places on the map'}
                  </span>
                  <select value={groupTargetDayId} onChange={(event) => setGroupTargetDayId(event.target.value)}>
                    <option value="">Add to day…</option>
                    {selectedList?.days.map((tripDay) => (
                      <option key={tripDay.id} value={tripDay.id}>
                        {tripDay.label}
                      </option>
                    ))}
                  </select>
                  <button
                    className="primary-button"
                    type="button"
                    disabled={!groupTargetDayId || selectedPlaceIds.size === 0}
                    onClick={assignSelectedPlacesToDay}
                  >
                    Add to day
                  </button>
                  <button className="icon-button" type="button" onClick={exitPlaceSelectMode} aria-label="Cancel selection">
                    ×
                  </button>
                </>
              )}
              {groupError ? <p className="place-autocomplete__error">{groupError}</p> : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {page === 'explore' ? (
        <div className="explore-page page-transition">
          <label className="explore-page__search">
            <span className="sr-only">Search lists</span>
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search lists" />
          </label>

          <div className="explore-rect-grid">
            {exploreLists.map((list) => (
              <RectCard
                key={list.id}
                list={list}
                liked={isLiked(data.likes, data.currentUserId, list.id)}
                likeCount={getLikeCount(data.likes, list.id)}
                onOpen={() => openListDetail(list.id)}
                onToggleLike={() => toggleLike(list.id)}
              />
            ))}
          </div>
        </div>
      ) : null}

      {page === 'dm' ? (
        <div className="dm-page panel page-transition">
          <div className="dm-page__list">
            <div className="section-heading">
              <h3>Direct messages</h3>
              <span>{peopleToFollow.length}</span>
            </div>
            <div className="dm-list">
              {peopleToFollow.map((user) => (
                <button
                  key={user.id}
                  type="button"
                  className={`dm-thread${dmThreadUserId === user.id ? ' dm-thread--active' : ''}`}
                  onClick={() => setDmThreadUserId(user.id)}
                >
                  <Avatar user={user} className="dm-thread__avatar" />
                  <span>
                    <strong>{user.name}</strong>
                    <small>{user.city}</small>
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="dm-page__chat">
            <div className="dm-chat__header">
              <strong>{data.users.find((user) => user.id === dmThreadUserId)?.name ?? 'Choose a thread'}</strong>
              <span>route planning talk</span>
            </div>

            <div className="dm-chat__messages">
              {dmMessages
                .filter(
                  (message) =>
                    (message.fromId === data.currentUserId && message.toId === dmThreadUserId) ||
                    (message.fromId === dmThreadUserId && message.toId === data.currentUserId),
                )
                .map((message) => {
                  const isMine = message.fromId === data.currentUserId;
                  const expenseInvite = parseExpenseInviteMessage(message.text);
                  const listInvite = !expenseInvite ? parseListInviteMessage(message.text) : null;
                  const inviteGroup = expenseInvite ? expenseGroups.find((group) => group.id === expenseInvite.groupId) : undefined;
                  const inviteList = listInvite ? data.lists.find((list) => list.id === listInvite.listId) : undefined;
                  // Invites always flow inviter -> invitee, so the invitee is `toId` regardless of
                  // which side of the conversation is currently looking at the bubble. Looking up
                  // the *viewer's own* membership here was the bug: it made the sender's own copy
                  // of the message read "accepted" immediately, because the sender is auto-accepted
                  // into their own expense group at creation time (and, for a list, could easily be
                  // an accepted collaborator on some other list already).
                  const inviteeStatus = inviteGroup
                    ? inviteGroup.members.find((member) => member.userId === message.toId)?.status
                    : inviteList?.collaborators.find((collaborator) => collaborator.userId === message.toId)?.status;
                  // A decline deletes the membership/collaborator row, so a found group/list with
                  // no matching invitee row means they declined.
                  const inviteeDeclined = Boolean((inviteGroup || inviteList) && !inviteeStatus);
                  const hasInvite = Boolean(inviteGroup || inviteList);
                  const bubbleText = expenseInvite?.text ?? listInvite?.text ?? message.text;
                  const respond = (status: 'accepted' | 'declined') => {
                    if (inviteGroup) respondToExpenseInvite(inviteGroup.id, status);
                    else if (inviteList) actions.respondToListInvite(inviteList.id, status);
                  };
                  return (
                    <div key={message.id} className={`dm-bubble${isMine ? ' dm-bubble--mine' : ''}`}>
                      {bubbleText}
                      {hasInvite ? (
                        isMine ? (
                          <div className="dm-bubble__actions dm-bubble__actions--blocked">
                            <span className={`dm-bubble__action-pill${inviteeDeclined ? ' dm-bubble__action-pill--chosen' : ''}`}>
                              Decline
                            </span>
                            <span
                              className={`dm-bubble__action-pill${inviteeStatus === 'accepted' ? ' dm-bubble__action-pill--chosen' : ''}`}
                            >
                              Accept
                            </span>
                          </div>
                        ) : inviteeStatus === 'invited' ? (
                          <div className="dm-bubble__actions">
                            <button className="secondary-button" type="button" onClick={() => respond('declined')}>
                              Decline
                            </button>
                            <button className="primary-button" type="button" onClick={() => respond('accepted')}>
                              Accept
                            </button>
                          </div>
                        ) : inviteeStatus === 'accepted' ? (
                          <p className="dm-bubble__invite-status dm-bubble__invite-status--accepted">✓ Accepted</p>
                        ) : inviteeDeclined ? (
                          <p className="dm-bubble__invite-status dm-bubble__invite-status--declined">Declined</p>
                        ) : null
                      ) : null}
                    </div>
                  );
                })}
            </div>

            <div className="dm-chat__composer">
              <input value={dmDraft} onChange={(event) => setDmDraft(event.target.value)} placeholder="Send a trip note..." />
              <button className="primary-button" type="button" onClick={sendDirectMessage}>
                Send
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {page === 'expenses' ? (
        <div className="expenses-page panel page-transition">
          {expenseGroupsError ? (
            <p className="place-autocomplete__error">
              Could not load expense groups: {describeQueryError(expenseGroupsError)}
            </p>
          ) : null}

          {pendingExpenseInvites.length > 0 ? (
            <div className="expenses-page__invites">
              <div className="section-heading">
                <h3>Pending invitations</h3>
                <span>{pendingExpenseInvites.length}</span>
              </div>
              <div className="expense-invite-list">
                {pendingExpenseInvites.map((group) => {
                  const list = data.lists.find((item) => item.id === group.listId);
                  const owner = data.users.find((user) => user.id === group.ownerId);
                  return (
                    <div key={group.id} className="expense-invite">
                      <div>
                        <strong>{group.name}</strong>
                        <small>
                          {list ? list.title : 'Trip'} · invited by {owner?.name ?? 'someone'}
                        </small>
                      </div>
                      <div className="expense-invite__actions">
                        <button
                          className="secondary-button"
                          type="button"
                          onClick={() => respondToExpenseInvite(group.id, 'declined')}
                        >
                          Decline
                        </button>
                        <button
                          className="primary-button"
                          type="button"
                          onClick={() => respondToExpenseInvite(group.id, 'accepted')}
                        >
                          Accept
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}

          <div className="section-heading">
            <div>
              <p className="eyebrow">Expenses</p>
              <h3>Your trip groups</h3>
            </div>
            <button className="secondary-button" type="button" onClick={openNewExpenseGroup}>
              New group
            </button>
          </div>

          <div className="expense-group-grid">
            {activeExpenseGroups.map((group) => (
              <ExpenseGroupCard
                key={group.id}
                group={group}
                list={data.lists.find((item) => item.id === group.listId)}
                currentUserId={data.currentUserId}
                users={data.users}
                onOpen={() => setExpenseGroupDetailId(group.id)}
              />
            ))}
            {activeExpenseGroups.length === 0 ? (
              <p className="sidebar__empty">No expense groups yet. Start one from a trip above.</p>
            ) : null}
          </div>
        </div>
      ) : null}

      {page === 'account' ? (
        <main className="account-page panel page-transition">
          <div className="account-page__header">
            <div className="account-page__profile">
              <Avatar user={currentUser} className="profile-card__avatar account-page__avatar" />
              <div>
                <p className="eyebrow">Account</p>
                <h2>{currentUser.name}</h2>
                <p>{currentUser.handle}</p>
                <p className="account-page__bio">{currentUser.bio}</p>
              </div>
            </div>

            <div className="stats-row account-page__stats">
              <Stat
                label="Followers"
                value={stats.followers}
                onClick={() => setPeopleListOpen({ userId: currentUser.id, mode: 'followers' })}
              />
              <Stat
                label="Following"
                value={stats.following}
                onClick={() => setPeopleListOpen({ userId: currentUser.id, mode: 'following' })}
              />
              <Stat label="Lists" value={stats.trips} />
              <Stat label="Avg rating" value={formatRating(stats.avgRating)} />
            </div>

            <div className="account-page__actions">
              <button className="secondary-button" type="button" onClick={() => setPage('home')}>
                Show map
              </button>
              <button className="secondary-button" type="button" onClick={openCreateList}>
                New list
              </button>
              <button className="secondary-button" type="button" onClick={openProfileEditor}>
                Edit profile
              </button>
              <button className="secondary-button" type="button" onClick={signOut}>
                Log out
              </button>
            </div>
          </div>

          <div className="section-heading account-page__section-heading">
            <div>
              <p className="eyebrow">Lists</p>
              <h3>Your saved places</h3>
            </div>
            <span>{accountLists.length} lists</span>
          </div>

          <div className="explore-rect-grid">
            {accountLists.map((list) => (
              <RectCard
                key={list.id}
                list={list}
                liked={isLiked(data.likes, data.currentUserId, list.id)}
                likeCount={getLikeCount(data.likes, list.id)}
                onOpen={() => openListDetail(list.id)}
                onToggleLike={() => toggleLike(list.id)}
              />
            ))}
            {accountLists.length === 0 ? (
              <p className="sidebar__empty">You haven't created a list yet. Start one from the button above.</p>
            ) : null}
          </div>
        </main>
      ) : null}

      {composerOpen ? (
        <div className="modal-backdrop" role="presentation" onClick={() => setComposerOpen(false)}>
          <div className="modal panel" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <div className="section-heading">
              <h3>{listFormMode === 'create' ? 'Create a new trip list' : 'Edit trip list'}</h3>
              <button className="icon-button" type="button" onClick={() => setComposerOpen(false)}>
                ×
              </button>
            </div>
            <form className="form-grid" onSubmit={submitListForm}>
              <label>
                <span>Title</span>
                <input value={draft.title} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} required />
              </label>
              <label>
                <span>Country</span>
                <input value={draft.country} onChange={(event) => setDraft((current) => ({ ...current, country: event.target.value }))} />
              </label>

              <div className="form-grid__full color-picker">
                <span>Map color</span>
                <div className="color-picker__swatches">
                  {LIST_MARKER_COLORS.map((color) => (
                    <button
                      key={color}
                      type="button"
                      className={`color-picker__swatch${draft.color === color ? ' color-picker__swatch--active' : ''}`}
                      style={{ background: color }}
                      onClick={() => setDraft((current) => ({ ...current, color }))}
                      aria-label={`Use ${color} for this list's map markers`}
                      aria-pressed={draft.color === color}
                    />
                  ))}
                </div>
              </div>

              <label className="form-grid__full cover-field">
                <span>Cover image</span>
                <div className="cover-field__row">
                  <input
                    value={draft.coverImage}
                    onChange={(event) => setDraft((current) => ({ ...current, coverImage: event.target.value }))}
                    placeholder="Paste an image URL"
                  />
                  <label className="secondary-button cover-field__upload">
                    Upload
                    <input type="file" accept="image/*" onChange={handleCoverFile} hidden />
                  </label>
                </div>
                {draft.coverImage ? <img className="cover-field__preview" src={draft.coverImage} alt="Cover preview" /> : null}
              </label>

              <label className="form-grid__full">
                <span>Description</span>
                <textarea
                  rows={3}
                  value={draft.description}
                  onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))}
                />
              </label>

              <div className="form-grid__full trip-plan-editor">
                <div className="section-heading">
                  <h3>Trip plan</h3>
                  <button type="button" className="secondary-button" onClick={addDraftDay}>
                    + Add day
                  </button>
                </div>

                <div className="trip-dates">
                  <label>
                    <span>Start date</span>
                    <input
                      type="date"
                      value={draft.startDate ?? ''}
                      onChange={(event) => setDraft((current) => ({ ...current, startDate: event.target.value }))}
                    />
                  </label>
                  <label>
                    <span>End date</span>
                    <input
                      type="date"
                      value={draft.endDate ?? ''}
                      min={draft.startDate}
                      onChange={(event) => setDraft((current) => ({ ...current, endDate: event.target.value }))}
                    />
                  </label>
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={!draft.startDate || !draft.endDate}
                    onClick={() =>
                      setDraft((current) => ({
                        ...current,
                        days: buildDaysFromDateRange(current.startDate ?? '', current.endDate ?? ''),
                      }))
                    }
                  >
                    Generate days from dates
                  </button>
                </div>
                {draft.days.length > 0 && draft.startDate && draft.endDate ? (
                  <small className="draft-places__empty">
                    Generating replaces the current day list below -- drag places back in after.
                  </small>
                ) : null}

                <datalist id="draft-destinations">
                  {draftDestinations.map((destination) => (
                    <option key={destination} value={destination} />
                  ))}
                </datalist>

                <div className="trip-plan-days">
                  {draft.days.map((tripDay) => (
                    <div
                      key={tripDay.id}
                      className="trip-day"
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={(event) => {
                        event.preventDefault();
                        const placeId = event.dataTransfer.getData('text/plain');
                        if (placeId) {
                          movePlaceToDraftDay(placeId, tripDay.id);
                        }
                      }}
                    >
                      <div className="trip-day__header">
                        <input
                          className="trip-day__label"
                          value={tripDay.label}
                          onChange={(event) => renameDraftDay(tripDay.id, event.target.value)}
                          aria-label="Day label"
                        />
                        <button
                          type="button"
                          className="icon-button"
                          onClick={() => removeDraftDay(tripDay.id)}
                          aria-label={`Remove ${tripDay.label}`}
                        >
                          ×
                        </button>
                      </div>
                      <div className="trip-day__destination">
                        {tripDay.destination ? (
                          <span
                            className="trip-day__destination-dot"
                            aria-hidden="true"
                            style={{ background: draftDestinationColors.get(tripDay.destination) }}
                          />
                        ) : null}
                        <input
                          value={tripDay.destination ?? ''}
                          onChange={(event) => setDraftDayDestination(tripDay.id, event.target.value)}
                          placeholder="Destination (e.g. Tokyo)"
                          list="draft-destinations"
                          aria-label={`Destination for ${tripDay.label}`}
                        />
                      </div>
                      <div className="trip-day__places">
                        {tripDay.placeIds.map((placeId) => {
                          const place = draft.places.find((item) => item.id === placeId);
                          if (!place) {
                            return null;
                          }

                          const placeTime = tripDay.placeTimes?.[placeId];

                          return (
                            <div
                              key={placeId}
                              className="trip-place-card"
                              draggable
                              onDragStart={(event) => {
                                // Don't hijack clicks/typing in the time inputs below -- only start
                                // a drag when the gesture began on the card itself, not a control in it.
                                if ((event.target as HTMLElement).tagName === 'INPUT') {
                                  event.preventDefault();
                                  return;
                                }
                                event.dataTransfer.setData('text/plain', placeId);
                              }}
                              onDragOver={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                              }}
                              onDrop={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                const draggedId = event.dataTransfer.getData('text/plain');
                                if (draggedId && draggedId !== placeId) {
                                  movePlaceToDraftDay(draggedId, tripDay.id, placeId);
                                }
                              }}
                            >
                              <div className="trip-place-card__row">
                                <span aria-hidden="true">{CATEGORY_META[place.category].icon}</span>
                                <span className="trip-place-card__name">{place.name}</span>
                                <button
                                  type="button"
                                  className="trip-place-card__remove"
                                  onClick={() => unscheduleDraftPlace(placeId)}
                                  aria-label={`Remove ${place.name} from ${tripDay.label}`}
                                >
                                  ×
                                </button>
                              </div>
                              <div className="trip-place-card__times">
                                <input
                                  type="time"
                                  value={placeTime?.startTime ?? ''}
                                  onChange={(event) =>
                                    setDraftPlaceTime(tripDay.id, placeId, { ...placeTime, startTime: event.target.value || undefined })
                                  }
                                  aria-label={`Start time for ${place.name}`}
                                />
                                <span aria-hidden="true">–</span>
                                <input
                                  type="time"
                                  value={placeTime?.endTime ?? ''}
                                  onChange={(event) =>
                                    setDraftPlaceTime(tripDay.id, placeId, { ...placeTime, endTime: event.target.value || undefined })
                                  }
                                  aria-label={`End time for ${place.name}`}
                                />
                              </div>
                            </div>
                          );
                        })}
                        {tripDay.placeIds.length === 0 ? <p className="trip-day__empty">Drag a place here</p> : null}
                      </div>
                      <div className="trip-day__search">
                        <PlaceAutocomplete onAdd={(place) => addSearchedPlaceToDay(tripDay.id, place)} />
                      </div>
                      <select
                        className="trip-day__add"
                        value=""
                        onChange={(event) => {
                          const placeId = event.target.value;
                          if (placeId) {
                            movePlaceToDraftDay(placeId, tripDay.id);
                          }
                        }}
                        aria-label={`Add a saved place to ${tripDay.label}`}
                      >
                        <option value="">+ Add from saved places</option>
                        {draft.places.map((place) => {
                          const currentDay = draft.days.find((day) => day.placeIds.includes(place.id));
                          const suffix = currentDay && currentDay.id !== tripDay.id ? ` (in ${currentDay.label})` : '';
                          return (
                            <option key={place.id} value={place.id}>
                              {CATEGORY_META[place.category].icon} {place.name}
                              {suffix}
                            </option>
                          );
                        })}
                      </select>
                    </div>
                  ))}
                  {draft.days.length === 0 ? (
                    <p className="draft-places__empty">Add a day to start building the itinerary.</p>
                  ) : null}
                </div>

                <div
                  className="trip-plan-unscheduled"
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => {
                    event.preventDefault();
                    const placeId = event.dataTransfer.getData('text/plain');
                    if (placeId) {
                      unscheduleDraftPlace(placeId);
                    }
                  }}
                >
                  <span className="trip-plan-unscheduled__label">Unscheduled places</span>
                  <div className="trip-plan-unscheduled__list">
                    {draft.places
                      .filter((place) => !draft.days.some((tripDay) => tripDay.placeIds.includes(place.id)))
                      // A hotel with check-in/check-out dates is already "scheduled" via its stay
                      // range (see findHotelForDay) -- it doesn't belong on any single day's
                      // placeIds, so without this it would sit in Unscheduled forever even though
                      // it's fully accounted for.
                      .filter((place) => !(place.category === 'hotel' && place.checkIn && place.checkOut))
                      .map((place) => (
                        <div
                          key={place.id}
                          className="trip-place-card"
                          draggable
                          onDragStart={(event) => event.dataTransfer.setData('text/plain', place.id)}
                        >
                          <div className="trip-place-card__row">
                            <span aria-hidden="true">{CATEGORY_META[place.category].icon}</span>
                            <span className="trip-place-card__name">{place.name}</span>
                          </div>
                        </div>
                      ))}
                    {draft.places.length === 0 ? <p className="trip-day__empty">Add places above first.</p> : null}
                  </div>
                </div>
              </div>

              <div className="form-grid__full draft-places">
                <div className="draft-places__heading">
                  <span>Saved places ({draft.places.length})</span>
                  <button type="button" className="secondary-button" onClick={() => setImportPlacesOpen(true)}>
                    Import from Google Maps
                  </button>
                </div>
                <PlaceAutocomplete onAdd={addDraftPlace} />
                <div className="draft-places__list">
                  {groupPlacesByCategory(draft.places).map((group) => {
                    const collapsed = collapsedDraftCategories.has(group.category);
                    return (
                      <div key={group.category} className="place-category-group">
                        <button
                          type="button"
                          className="collapsible-header place-category-group__heading"
                          onClick={() => toggleDraftCategory(group.category)}
                        >
                          <span aria-hidden="true">{CATEGORY_META[group.category].icon}</span>
                          <span className="place-category-group__label">
                            {CATEGORY_META[group.category].label} ({group.places.length})
                          </span>
                          <span className={`collapsible-chevron${collapsed ? ' collapsible-chevron--collapsed' : ''}`} aria-hidden="true">
                            ⌄
                          </span>
                        </button>
                        {!collapsed
                          ? group.places.map((place) => (
                              <div key={place.id} className="draft-place">
                                <div>
                                  <strong>{place.name}</strong>
                                  <small>{place.address}</small>
                                </div>
                                <select
                                  className="draft-place__category"
                                  value={place.category}
                                  onChange={(event) => updateDraftPlaceCategory(place.id, event.target.value as PlaceCategory)}
                                  aria-label={`Category for ${place.name}`}
                                >
                                  {PLACE_CATEGORIES.map((category) => (
                                    <option key={category} value={category}>
                                      {CATEGORY_META[category].icon} {CATEGORY_META[category].label}
                                    </option>
                                  ))}
                                </select>
                                <button
                                  type="button"
                                  className="icon-button"
                                  onClick={() => removeDraftPlace(place.id)}
                                  aria-label={`Remove ${place.name}`}
                                >
                                  ×
                                </button>
                                {place.category === 'hotel' ? (
                                  <div className="draft-place__stay">
                                    <label>
                                      <span>Check-in</span>
                                      <input
                                        type="date"
                                        value={place.checkIn ?? ''}
                                        onChange={(event) => updateDraftPlaceStay(place.id, { checkIn: event.target.value || undefined })}
                                        aria-label={`Check-in date for ${place.name}`}
                                      />
                                    </label>
                                    <label>
                                      <span>Check-out</span>
                                      <input
                                        type="date"
                                        value={place.checkOut ?? ''}
                                        min={place.checkIn}
                                        onChange={(event) => updateDraftPlaceStay(place.id, { checkOut: event.target.value || undefined })}
                                        aria-label={`Check-out date for ${place.name}`}
                                      />
                                    </label>
                                  </div>
                                ) : null}
                              </div>
                            ))
                          : null}
                      </div>
                    );
                  })}
                  {draft.places.length === 0 ? <p className="draft-places__empty">Search above to pin real places from Google Maps.</p> : null}
                </div>
              </div>

              <label>
                <span>Season</span>
                <select value={draft.season} onChange={(event) => setDraft((current) => ({ ...current, season: event.target.value }))}>
                  <option value="spring">spring</option>
                  <option value="summer">summer</option>
                  <option value="autumn">autumn</option>
                  <option value="winter">winter</option>
                </select>
              </label>
              <label>
                <span>Budget</span>
                <select value={draft.budget} onChange={(event) => setDraft((current) => ({ ...current, budget: event.target.value }))}>
                  <option value="low">low</option>
                  <option value="mid-range">mid-range</option>
                  <option value="high">high</option>
                  <option value="mixed">mixed</option>
                </select>
              </label>
              <label className="form-grid__full visibility-toggle">
                <input
                  type="checkbox"
                  className="visibility-toggle__input"
                  checked={Boolean(draft.isPrivate)}
                  onChange={(event) => setDraft((current) => ({ ...current, isPrivate: event.target.checked }))}
                />
                <span className="visibility-toggle__track">
                  <span className="visibility-toggle__option visibility-toggle__option--public">Public</span>
                  <span className="visibility-toggle__option visibility-toggle__option--private">Private</span>
                  <span className="visibility-toggle__knob" />
                </span>
              </label>

              {listFormError ? <p className="form-grid__full place-autocomplete__error">{listFormError}</p> : null}
              <div className="form-grid__full modal-actions">
                <button className="secondary-button" type="button" onClick={() => setComposerOpen(false)} disabled={listFormSubmitting}>
                  Cancel
                </button>
                <button className="primary-button" type="submit" disabled={listFormSubmitting}>
                  {listFormSubmitting ? 'Saving…' : listFormMode === 'create' ? 'Publish list' : 'Save changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {importPlacesOpen ? (
        <ImportPlacesModal onClose={() => setImportPlacesOpen(false)} onImport={importDraftPlaces} />
      ) : null}

      {saveToListOpen && mapSearchPlace ? (
        <div className="modal-backdrop" role="presentation" onClick={() => setSaveToListOpen(false)}>
          <div className="modal panel save-to-list-modal" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <div className="section-heading">
              <h3>Save to list</h3>
              <button className="icon-button" type="button" onClick={() => setSaveToListOpen(false)}>
                ×
              </button>
            </div>
            <div className="account-list-sidebar">
              {accountLists.map((list) => {
                const savedHere = Boolean(findDuplicatePlace(list.places, mapSearchPlace));
                return (
                  <button
                    key={list.id}
                    type="button"
                    className={`account-list-sidebar__hit save-to-list-item${savedHere ? ' save-to-list-item--active' : ''}`}
                    onClick={() => togglePlaceInList(list)}
                    disabled={saveToListSubmitting}
                    aria-pressed={savedHere}
                  >
                    <img src={list.coverImage} alt="" className="account-list-sidebar__thumb" />
                    <strong>{list.title}</strong>
                    <span className={`save-to-list-item__check${savedHere ? ' save-to-list-item__check--active' : ''}`} aria-hidden="true">
                      {savedHere ? '✓' : ''}
                    </span>
                  </button>
                );
              })}
              {accountLists.length === 0 ? <p className="sidebar__empty">You don't have any lists yet.</p> : null}
            </div>
            {saveToListError ? <p className="place-autocomplete__error">{saveToListError}</p> : null}
            <div className="modal-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={startNewListWithMapPlace}
                disabled={saveToListSubmitting}
              >
                + New list with this place
              </button>
              <button type="button" className="primary-button" onClick={() => setSaveToListOpen(false)}>
                Done
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {profileEditorOpen ? (
        <div className="modal-backdrop" role="presentation" onClick={() => setProfileEditorOpen(false)}>
          <div className="modal panel" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <div className="section-heading">
              <h3>Edit profile</h3>
              <button className="icon-button" type="button" onClick={() => setProfileEditorOpen(false)}>
                ×
              </button>
            </div>
            <form className="profile-form" onSubmit={saveProfile}>
              <div className="profile-form__grid">
                <label>
                  <span>Name</span>
                  <input
                    value={profileDraft.name}
                    onChange={(event) => setProfileDraft((current) => ({ ...current, name: event.target.value }))}
                  />
                </label>
                <label>
                  <span>Handle</span>
                  <input
                    value={profileDraft.handle}
                    onChange={(event) => setProfileDraft((current) => ({ ...current, handle: event.target.value }))}
                  />
                </label>
                <label>
                  <span>City</span>
                  <input
                    value={profileDraft.city}
                    onChange={(event) => setProfileDraft((current) => ({ ...current, city: event.target.value }))}
                  />
                </label>
                <label>
                  <span>Avatar initials</span>
                  <input
                    value={profileDraft.avatar}
                    onChange={(event) => setProfileDraft((current) => ({ ...current, avatar: event.target.value }))}
                  />
                </label>
                <label className="profile-form__full cover-field">
                  <span>Profile picture</span>
                  <div className="cover-field__row">
                    <input
                      value={profileDraft.avatarImage}
                      onChange={(event) => setProfileDraft((current) => ({ ...current, avatarImage: event.target.value }))}
                      placeholder="Paste an image URL"
                    />
                    <label className="secondary-button cover-field__upload">
                      Upload
                      <input type="file" accept="image/*" onChange={handleAvatarFile} hidden />
                    </label>
                  </div>
                  {profileDraft.avatarImage ? (
                    <img className="cover-field__preview cover-field__preview--round" src={profileDraft.avatarImage} alt="Profile preview" />
                  ) : (
                    <small className="draft-places__empty">No picture set — your initials will show instead.</small>
                  )}
                </label>
                <label className="profile-form__full">
                  <span>Bio</span>
                  <textarea
                    rows={4}
                    value={profileDraft.bio}
                    onChange={(event) => setProfileDraft((current) => ({ ...current, bio: event.target.value }))}
                  />
                </label>
              </div>
              <div className="profile-form__actions">
                <button className="secondary-button" type="button" onClick={() => setProfileEditorOpen(false)}>
                  Cancel
                </button>
                <button className="primary-button" type="submit">
                  Save profile
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {listDetail ? (
        <div className="modal-backdrop" role="presentation" onClick={() => setListDetailId(null)}>
          <div className="modal panel list-detail-modal" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <button className="icon-button list-detail-modal__close" type="button" onClick={() => setListDetailId(null)} aria-label="Close">
              ×
            </button>

            <div className="list-detail-modal__hero" style={{ backgroundImage: `url(${listDetail.coverImage})` }}>
              <span className="list-detail-modal__scrim" />
              <div>
                <h3>{listDetail.title}</h3>
              </div>
              <div className="account-list-modal__score">
                <strong>{formatRating(listDetailRatingSummary.average)}</strong>
                <span>{listDetail.places.length} saved places</span>
              </div>
            </div>

            <div className="like-row">
              <button
                className={`like-button${isLiked(data.likes, data.currentUserId, listDetail.id) ? ' like-button--active' : ''}`}
                type="button"
                onClick={() => toggleLike(listDetail.id)}
                aria-label={isLiked(data.likes, data.currentUserId, listDetail.id) ? 'Unlike this list' : 'Like this list'}
              >
                <span aria-hidden="true">♥</span> {getLikeCount(data.likes, listDetail.id)}
              </button>
            </div>

            <p className="detail-panel__description">{listDetail.description}</p>

            <div className="owner-card">
              {listDetailIsOwner || listDetailCanEdit ? (
                <button
                  type="button"
                  className={`collaborator-stack${listDetailAcceptedCollaborators.length > 0 ? ' collaborator-stack--filled' : ''}`}
                  onClick={() => setListCollaboratorsModalOpen(true)}
                  aria-label="Who can edit this list"
                  title="Who can edit"
                >
                  {listDetailAcceptedCollaborators.length > 0 ? (
                    <span className="collaborator-stack__avatars">
                      {listDetailAcceptedCollaborators.slice(0, 3).map(({ user }) => (
                        <Avatar key={user.id} user={user} className="collaborator-stack__avatar" />
                      ))}
                    </span>
                  ) : (
                    <UserPlus aria-hidden="true" size={16} strokeWidth={1.75} />
                  )}
                </button>
              ) : null}
              <button
                className="owner-card__hit"
                type="button"
                onClick={() => listDetailOwner && openProfile(listDetailOwner.id)}
              >
                <Avatar user={listDetailOwner} className="owner-card__avatar" />
                <div>
                  <strong>{listDetailOwner?.name ?? 'Unknown traveler'}</strong>
                  <p>{listDetailOwner?.handle ?? 'no handle'}</p>
                </div>
              </button>
              <div className="owner-card__side">
                {listDetailCanEdit ? (
                  <button className="secondary-button" type="button" onClick={() => openEditList(listDetail)}>
                    Edit list
                  </button>
                ) : (
                  <div className="owner-card__actions">
                    <button className="secondary-button" type="button" onClick={() => listDetailOwner && toggleFollow(listDetailOwner.id)}>
                      {listDetailOwner && isFollowing(data.follows, data.currentUserId, listDetailOwner.id) ? 'Following' : 'Follow'}
                    </button>
                    <button
                      className={`bookmark-button${isSaved(data.savedLists, data.currentUserId, listDetail.id) ? ' bookmark-button--active' : ''}`}
                      type="button"
                      onClick={() => toggleSaveList(listDetail.id)}
                    >
                      {isSaved(data.savedLists, data.currentUserId, listDetail.id) ? '★ Saved' : '☆ Save'}
                    </button>
                  </div>
                )}
              </div>
            </div>

            <TripPlanView
              key={`${listDetail.id}-days`}
              days={listDetail.days}
              places={listDetail.places}
              isOwner={listDetailOwner?.id === currentUser.id}
              attachments={listDetailOwner?.id === currentUser.id ? listDetail.placeAttachments ?? {} : null}
              currentUserId={data.currentUserId}
              onSaveAttachment={(placeId, attachment) => updatePlaceAttachment(placeId, attachment)}
            />

            <SavedPlacesView key={`${listDetail.id}-places`} places={listDetail.places} onSelectPlace={setInspectedPlaceId} />

            {listDetailOwner?.id !== currentUser.id ? (
              <div className="rating-panel">
                <div className="section-heading">
                  <h3>Rate this list</h3>
                  <span>{listDetailYourRating ? 'your rating' : 'not rated yet'}</span>
                </div>
                <div className="star-row" role="radiogroup" aria-label="Rate list">
                  {[1, 2, 3, 4, 5].map((score) => (
                    <button
                      key={score}
                      type="button"
                      className={`star-button${(listDetailYourRating?.score ?? 0) >= score ? ' star-button--active' : ''}`}
                      onClick={() => rateList(listDetail.id, listDetailOwner?.id, score)}
                      aria-label={`Rate ${score} stars`}
                    >
                      ★
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="modal-actions">
              <button className="primary-button" type="button" onClick={() => showListOnMap(listDetail.id)}>
                Show on map
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {listCollaboratorsModalOpen && listDetail ? (
        <div className="modal-backdrop" role="presentation" onClick={() => setListCollaboratorsModalOpen(false)}>
          <div className="modal panel" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <div className="section-heading">
              <h3>Who can edit</h3>
              <button className="icon-button" type="button" onClick={() => setListCollaboratorsModalOpen(false)} aria-label="Close">
                ×
              </button>
            </div>

            <div className="list-collaborators__roster">
              <button
                type="button"
                className="list-collaborators__person"
                onClick={() => listDetailOwner && openProfile(listDetailOwner.id)}
              >
                <Avatar user={listDetailOwner} className="dm-thread__avatar" />
                <span>
                  <strong>{listDetailOwner?.name ?? 'Unknown traveler'}</strong>
                  <small className="list-collaborators__role list-collaborators__role--owner">Owner</small>
                </span>
              </button>
              {listDetailAcceptedCollaborators.map(({ user }) => (
                <div key={user.id} className="list-collaborators__person-row">
                  <button type="button" className="list-collaborators__person" onClick={() => openProfile(user.id)}>
                    <Avatar user={user} className="dm-thread__avatar" />
                    <span>
                      <strong>{user.name}</strong>
                      <small className="list-collaborators__role">Collaborator</small>
                    </span>
                  </button>
                  {listDetailIsOwner ? (
                    <button
                      className="icon-button"
                      type="button"
                      onClick={() => actions.removeListCollaborator(listDetail.id, user.id)}
                      aria-label={`Remove ${user.name}`}
                    >
                      ×
                    </button>
                  ) : null}
                </div>
              ))}
            </div>

            {listDetailIsOwner ? (
              <>
                {listDetailPendingCollaborators.length > 0 ? (
                  <p className="list-collaborators__pending">
                    Pending: {listDetailPendingCollaborators.map(({ user }) => user.name).join(', ')}
                  </p>
                ) : null}
                <div className="expense-invite-more">
                  <input
                    type="text"
                    className="expense-invite-search"
                    value={listInviteSearchQuery}
                    onChange={(event) => setListInviteSearchQuery(event.target.value)}
                    placeholder="Search people to invite…"
                  />
                  {normalizedListInviteSearch ? (
                    <div className="expense-invite-results">
                      {listInviteSearchResults.length === 0 ? (
                        <p className="sidebar__empty">No matching travelers.</p>
                      ) : (
                        listInviteSearchResults.map((user) => (
                          <button
                            key={user.id}
                            type="button"
                            className="expense-invite-results__item"
                            onClick={() => submitListInvite(user.id)}
                          >
                            <Avatar user={user} className="dm-thread__avatar" />
                            <span>
                              <strong>{user.name}</strong>
                              <small>{user.handle}</small>
                            </span>
                          </button>
                        ))
                      )}
                    </div>
                  ) : null}
                </div>
              </>
            ) : null}
          </div>
        </div>
      ) : null}

      {inspectedPlace ? <PlacePreviewModal place={inspectedPlace} onClose={() => setInspectedPlaceId(null)} /> : null}

      {peopleListOpen ? (
        <div className="modal-backdrop" role="presentation" onClick={() => setPeopleListOpen(null)}>
          <div className="modal panel" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <div className="section-heading">
              <h3>{peopleListOpen.mode === 'followers' ? 'Followers' : 'Following'}</h3>
              <button className="icon-button" type="button" onClick={() => setPeopleListOpen(null)}>
                ×
              </button>
            </div>
            <div className="people-list">
              {peopleListUsers.map((user) => (
                <div key={user.id} className="people-list__item">
                  <button className="people-list__hit" type="button" onClick={() => openProfile(user.id)}>
                    <Avatar user={user} className="people-list__avatar" />
                    <div>
                      <strong>{user.name}</strong>
                      <p>{user.handle}</p>
                    </div>
                  </button>
                  {user.id !== data.currentUserId ? (
                    <button className="secondary-button" type="button" onClick={() => toggleFollow(user.id)}>
                      {isFollowing(data.follows, data.currentUserId, user.id) ? 'Following' : 'Follow'}
                    </button>
                  ) : null}
                </div>
              ))}
              {peopleListUsers.length === 0 ? (
                <p className="sidebar__empty">
                  {peopleListOpen.mode === 'followers' ? 'No followers yet.' : 'Not following anyone yet.'}
                </p>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {viewedProfile && viewedProfileStats ? (
        <div className="modal-backdrop" role="presentation" onClick={() => setViewedProfileId(null)}>
          <div className="modal panel profile-view-modal" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <button className="icon-button list-detail-modal__close" type="button" onClick={() => setViewedProfileId(null)} aria-label="Close">
              ×
            </button>

            <div className="profile-view__header">
              <Avatar user={viewedProfile} className="profile-card__avatar profile-view__avatar" />
              <div>
                <h2>{viewedProfile.name}</h2>
                <p>{viewedProfile.handle}</p>
                <p>{viewedProfile.city}</p>
              </div>
              <button className="secondary-button" type="button" onClick={() => toggleFollow(viewedProfile.id)}>
                {isFollowing(data.follows, data.currentUserId, viewedProfile.id) ? 'Following' : 'Follow'}
              </button>
            </div>

            <p className="detail-panel__description">{viewedProfile.bio}</p>

            <div className="stats-row">
              <Stat
                label="Followers"
                value={viewedProfileStats.followers}
                onClick={() => {
                  setViewedProfileId(null);
                  setPeopleListOpen({ userId: viewedProfile.id, mode: 'followers' });
                }}
              />
              <Stat
                label="Following"
                value={viewedProfileStats.following}
                onClick={() => {
                  setViewedProfileId(null);
                  setPeopleListOpen({ userId: viewedProfile.id, mode: 'following' });
                }}
              />
              <Stat label="Lists" value={viewedProfileStats.trips} />
              <Stat label="Avg rating" value={formatRating(viewedProfileStats.avgRating)} />
            </div>

            <div className="section-heading">
              <h3>Lists</h3>
              <span>{viewedProfileLists.length}</span>
            </div>
            <div className="explore-rect-grid">
              {viewedProfileLists.map((list) => (
                <RectCard
                  key={list.id}
                  list={list}
                  liked={isLiked(data.likes, data.currentUserId, list.id)}
                  likeCount={getLikeCount(data.likes, list.id)}
                  onOpen={() => {
                    setViewedProfileId(null);
                    openListDetail(list.id);
                  }}
                  onToggleLike={() => toggleLike(list.id)}
                />
              ))}
              {viewedProfileLists.length === 0 ? <p className="sidebar__empty">No lists yet.</p> : null}
            </div>
          </div>
        </div>
      ) : null}

      {newExpenseGroupOpen ? (
        <div className="modal-backdrop" role="presentation" onClick={() => setNewExpenseGroupOpen(false)}>
          <div className="modal panel" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <div className="section-heading">
              <h3>New expense group</h3>
            </div>
            <form className="form-grid" onSubmit={submitNewExpenseGroup}>
              <label className="form-grid__full">
                <span>Trip</span>
                <select value={newExpenseGroupListId} onChange={(event) => setNewExpenseGroupListId(event.target.value)} required>
                  <option value="" disabled>
                    Pick a trip…
                  </option>
                  {accountLists.map((list) => (
                    <option key={list.id} value={list.id}>
                      {list.title}
                    </option>
                  ))}
                </select>
              </label>

              <label className="form-grid__full">
                <span>Group name</span>
                <input
                  value={newExpenseGroupName}
                  onChange={(event) => setNewExpenseGroupName(event.target.value)}
                  placeholder="e.g. Lisbon trip"
                  required
                />
              </label>

              <div className="form-grid__full">
                <span>Invite</span>
                <div className="expense-invite-picker">
                  {peopleToFollow.map((user) => (
                    <label key={user.id} className="expense-invite-picker__item">
                      <input
                        type="checkbox"
                        checked={newExpenseGroupInviteIds.includes(user.id)}
                        onChange={() => toggleNewExpenseGroupInvite(user.id)}
                      />
                      {user.name}
                    </label>
                  ))}
                  {peopleToFollow.length === 0 ? <p className="sidebar__empty">No other travelers to invite yet.</p> : null}
                </div>
              </div>

              {newExpenseGroupError ? <p className="form-grid__full place-autocomplete__error">{newExpenseGroupError}</p> : null}

              <div className="form-grid__full modal-actions">
                <button className="secondary-button" type="button" onClick={() => setNewExpenseGroupOpen(false)}>
                  Cancel
                </button>
                <button className="primary-button" type="submit" disabled={newExpenseGroupSubmitting}>
                  {newExpenseGroupSubmitting ? 'Creating…' : 'Create group'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {expenseGroupDetail ? (
        <div className="modal-backdrop" role="presentation" onClick={() => setExpenseGroupDetailId(null)}>
          <div className="modal panel expense-detail-modal" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <button
              className="icon-button list-detail-modal__close"
              type="button"
              onClick={() => setExpenseGroupDetailId(null)}
              aria-label="Close"
            >
              ×
            </button>

            <div className="section-heading">
              <div>
                <p className="eyebrow">{data.lists.find((list) => list.id === expenseGroupDetail.listId)?.title ?? 'Trip'}</p>
                {editingExpenseGroupName ? (
                  <input
                    className="expense-group-name-input"
                    value={expenseGroupNameDraft}
                    onChange={(event) => setExpenseGroupNameDraft(event.target.value)}
                    onBlur={submitExpenseGroupName}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') event.currentTarget.blur();
                      if (event.key === 'Escape') setEditingExpenseGroupName(false);
                    }}
                    autoFocus
                  />
                ) : expenseGroupDetail.ownerId === data.currentUserId ? (
                  <button type="button" className="expense-group-name expense-group-name--editable" onClick={startEditingExpenseGroupName}>
                    <h2>{expenseGroupDetail.name}</h2>
                    <span aria-hidden="true">✎</span>
                  </button>
                ) : (
                  <h2>{expenseGroupDetail.name}</h2>
                )}
              </div>
              {expenseGroupDetail.ownerId === data.currentUserId ? (
                <label className="expense-base-currency">
                  <span className="expense-base-currency__label">Base currency</span>
                  <select
                    value={expenseGroupDetail.baseCurrency}
                    onChange={(event) => submitBaseCurrencyChange(event.target.value)}
                    disabled={changingBaseCurrency}
                  >
                    {CURRENCIES.map((code) => (
                      <option key={code} value={code}>
                        {code}
                      </option>
                    ))}
                  </select>
                  {changingBaseCurrency ? <small>Updating…</small> : null}
                </label>
              ) : (
                <span>{expenseGroupDetail.baseCurrency}</span>
              )}
            </div>
            {baseCurrencyError ? <p className="place-autocomplete__error">{baseCurrencyError}</p> : null}

            {groupExpensesError ? (
              <p className="place-autocomplete__error">
                Could not load this group's expenses: {describeQueryError(groupExpensesError)}
              </p>
            ) : null}

            <div className="expense-detail__members">
              {expenseGroupDetailMembers.map(({ member, user }) => (
                <div key={member.userId} className="expense-member">
                  <Avatar user={user} className="dm-thread__avatar" />
                  <span>
                    <strong>{user.name}</strong>
                    <small className={`expense-member__status expense-member__status--${member.status}`}>{member.status}</small>
                  </span>
                  {expenseGroupDetail.ownerId === data.currentUserId && member.userId !== data.currentUserId ? (
                    <button
                      className="icon-button"
                      type="button"
                      onClick={() => removeExpenseGroupMember(expenseGroupDetail.id, member.userId)}
                      aria-label={`Remove ${user.name}`}
                    >
                      ×
                    </button>
                  ) : null}
                </div>
              ))}
            </div>

            {expenseGroupDetail.ownerId === data.currentUserId ? (
              <div className="expense-invite-more">
                <input
                  type="text"
                  className="expense-invite-search"
                  value={inviteSearchQuery}
                  onChange={(event) => setInviteSearchQuery(event.target.value)}
                  placeholder="Search people to invite…"
                />
                {normalizedInviteSearch ? (
                  <div className="expense-invite-results">
                    {inviteSearchResults.length === 0 ? (
                      <p className="sidebar__empty">No matching travelers.</p>
                    ) : (
                      inviteSearchResults.map((user) => (
                        <button
                          key={user.id}
                          type="button"
                          className="expense-invite-results__item"
                          onClick={() => submitInviteMore(user.id)}
                        >
                          <Avatar user={user} className="dm-thread__avatar" />
                          <span>
                            <strong>{user.name}</strong>
                            <small>{user.handle}</small>
                          </span>
                        </button>
                      ))
                    )}
                  </div>
                ) : null}
              </div>
            ) : null}

            <div className="section-heading">
              <h3>Balances</h3>
            </div>
            <div className="balance-list">
              {debtSuggestions.length === 0 ? (
                <p className="sidebar__empty">Everyone's settled up.</p>
              ) : (
                debtSuggestions.map((suggestion) => {
                  const from = data.users.find((user) => user.id === suggestion.fromUser);
                  const to = data.users.find((user) => user.id === suggestion.toUser);
                  const key = `${suggestion.fromUser}_${suggestion.toUser}`;
                  const isSettling = settlingKey === key;
                  return (
                    <div key={key} className="balance-row">
                      <span>
                        <strong>{from?.name ?? 'Someone'}</strong> owes <strong>{to?.name ?? 'someone'}</strong>
                        {isSettling ? null : ` · ${expenseGroupDetail.baseCurrency} ${suggestion.amount.toFixed(2)}`}
                      </span>
                      {isSettling ? (
                        <span className="balance-row__amount balance-row__amount--editing">
                          <span className="balance-row__currency">{expenseGroupDetail.baseCurrency}</span>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={settlementAmountDraft}
                            onChange={(event) => setSettlementAmountDraft(event.target.value)}
                            autoFocus
                          />
                          <button
                            className="secondary-button"
                            type="button"
                            onClick={() => setSettlingKey(null)}
                            disabled={settlementSubmitting}
                          >
                            Cancel
                          </button>
                          <button
                            className="primary-button"
                            type="button"
                            onClick={() => submitSettlement(suggestion)}
                            disabled={settlementSubmitting}
                          >
                            {settlementSubmitting ? 'Recording…' : 'Confirm'}
                          </button>
                        </span>
                      ) : (
                        <span className="balance-row__amount">
                          <button className="secondary-button" type="button" onClick={() => startRecordingPayment(suggestion)}>
                            Record payment
                          </button>
                        </span>
                      )}
                    </div>
                  );
                })
              )}
            </div>
            {settlementError ? <p className="place-autocomplete__error">{settlementError}</p> : null}

            {groupSettlements.length > 0 ? (
              <>
                <div className="section-heading">
                  <h3>Payment history</h3>
                </div>
                <div className="settlement-list">
                  {groupSettlements.map((settlement) => {
                    const from = data.users.find((user) => user.id === settlement.fromUser);
                    const to = data.users.find((user) => user.id === settlement.toUser);
                    const canDelete =
                      settlement.fromUser === data.currentUserId ||
                      settlement.toUser === data.currentUserId ||
                      expenseGroupDetail.ownerId === data.currentUserId;
                    return (
                      <div key={settlement.id} className="settlement-row">
                        <span>
                          <strong>{from?.name ?? 'Someone'}</strong> paid <strong>{to?.name ?? 'someone'}</strong>
                          <small>{new Date(settlement.createdAt).toLocaleDateString()}</small>
                        </span>
                        <span className="settlement-row__amount">
                          {expenseGroupDetail.baseCurrency} {settlement.amount.toFixed(2)}
                          {canDelete ? (
                            <button
                              className="icon-button"
                              type="button"
                              onClick={() => deleteGroupSettlement(settlement.id)}
                              aria-label="Delete payment record"
                            >
                              ×
                            </button>
                          ) : null}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </>
            ) : null}

            {groupExpenses.length > 0 ? (
              <div className="expense-charts">
                <div className="expense-chart-card">
                  <h4>By category</h4>
                  <PieChart
                    slices={expenseCategoryTotals.map((entry) => ({
                      label: EXPENSE_CATEGORY_META[entry.category].label,
                      total: entry.total,
                      color: entry.color,
                    }))}
                    currency={expenseGroupDetail.baseCurrency}
                  />
                </div>

                <div className="expense-chart-card">
                  <h4>Equal splits, paid by</h4>
                  <PieChart
                    slices={equalSplitPaidTotals.map((entry) => ({ label: entry.label, total: entry.total, color: entry.color }))}
                    currency={expenseGroupDetail.baseCurrency}
                  />
                </div>

                <div className="expense-chart-card">
                  <h4>Total spent per person</h4>
                  <BarChart
                    bars={totalSpentPerMember.map((entry) => ({ label: entry.label, total: entry.total, color: entry.color }))}
                    currency={expenseGroupDetail.baseCurrency}
                    orientation="vertical"
                  />
                </div>

                {customSplitExpenses.length > 0 ? (
                  <div className="expense-chart-card">
                    <h4>Custom (unequal) splits, per person</h4>
                    <BarChart
                      bars={customSplitMemberTotals.map((entry) => ({ label: entry.label, total: entry.total, color: entry.color }))}
                      currency={expenseGroupDetail.baseCurrency}
                    />
                  </div>
                ) : null}
              </div>
            ) : null}

            <div className="section-heading">
              <h3>Expenses</h3>
              {!addExpenseFormOpen ? (
                <button className="secondary-button" type="button" onClick={openAddExpenseForm}>
                  Add expense
                </button>
              ) : null}
            </div>

            {addExpenseFormOpen ? (
              <form className="form-grid expense-form" onSubmit={submitExpenseForm}>
                <label className="form-grid__full">
                  <span>Description</span>
                  <input
                    value={expenseForm.description}
                    onChange={(event) => setExpenseForm((current) => ({ ...current, description: event.target.value }))}
                    placeholder="e.g. Dinner at Time Out Market"
                    required
                  />
                </label>

                <label>
                  <span>Amount</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={expenseForm.amount}
                    onChange={(event) => setExpenseForm((current) => ({ ...current, amount: event.target.value }))}
                    required
                  />
                </label>
                <label>
                  <span>Currency</span>
                  <select
                    value={expenseForm.currency}
                    onChange={(event) => setExpenseForm((current) => ({ ...current, currency: event.target.value }))}
                  >
                    {CURRENCIES.map((code) => (
                      <option key={code} value={code}>
                        {code}
                      </option>
                    ))}
                  </select>
                </label>

                <label>
                  <span>Date</span>
                  <input
                    type="date"
                    value={expenseForm.spentAt}
                    onChange={(event) => setExpenseForm((current) => ({ ...current, spentAt: event.target.value }))}
                  />
                </label>
                <label>
                  <span>Category</span>
                  <select
                    value={expenseForm.category}
                    onChange={(event) =>
                      setExpenseForm((current) => ({ ...current, category: event.target.value as ExpenseCategory }))
                    }
                  >
                    {EXPENSE_CATEGORIES.map((category) => (
                      <option key={category} value={category}>
                        {EXPENSE_CATEGORY_META[category].label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="form-grid__full">
                  <span>Paid by</span>
                  <select
                    value={expenseForm.paidBy}
                    onChange={(event) => setExpenseForm((current) => ({ ...current, paidBy: event.target.value }))}
                  >
                    {acceptedGroupMembers.map(({ user }) => (
                      <option key={user.id} value={user.id}>
                        {user.name}
                      </option>
                    ))}
                  </select>
                </label>

                <div className="form-grid__full expense-form__split">
                  <div className="section-heading">
                    <span>Split between</span>
                    <div className="view-toggle">
                      <button
                        type="button"
                        className={`pill${expenseForm.splitMode === 'equal' ? ' pill--active' : ''}`}
                        onClick={() => setExpenseForm((current) => ({ ...current, splitMode: 'equal' }))}
                      >
                        Equal
                      </button>
                      <button
                        type="button"
                        className={`pill${expenseForm.splitMode === 'custom' ? ' pill--active' : ''}`}
                        onClick={() => setExpenseForm((current) => ({ ...current, splitMode: 'custom' }))}
                      >
                        Custom
                      </button>
                    </div>
                  </div>

                  {acceptedGroupMembers.map(({ user }) => {
                    const checked = expenseForm.participantIds.includes(user.id);
                    return (
                      <div key={user.id} className="expense-form__participant">
                        <label className="expense-form__participant-check">
                          <input type="checkbox" checked={checked} onChange={() => toggleExpenseParticipant(user.id)} />
                          {user.name}
                        </label>
                        {checked && expenseForm.splitMode === 'custom' ? (
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={expenseForm.customAmounts[user.id] ?? ''}
                            onChange={(event) =>
                              setExpenseForm((current) => ({
                                ...current,
                                customAmounts: { ...current.customAmounts, [user.id]: event.target.value },
                              }))
                            }
                          />
                        ) : null}
                      </div>
                    );
                  })}
                </div>

                {addExpenseError ? <p className="form-grid__full place-autocomplete__error">{addExpenseError}</p> : null}

                <div className="form-grid__full modal-actions">
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => {
                      setAddExpenseFormOpen(false);
                      setEditingExpenseId(null);
                    }}
                  >
                    Cancel
                  </button>
                  <button className="primary-button" type="submit" disabled={addExpenseSubmitting}>
                    {addExpenseSubmitting ? 'Saving…' : editingExpenseId ? 'Save changes' : 'Add expense'}
                  </button>
                </div>
              </form>
            ) : null}

            <div className="expense-list">
              {groupExpensesByCategory(groupExpenses).map((group) => {
                const collapsed = collapsedExpenseCategories.has(group.category);
                return (
                  <div key={group.category} className="expense-category-group">
                    <button
                      type="button"
                      className="collapsible-header expense-category-group__heading"
                      onClick={() => toggleExpenseCategory(group.category)}
                    >
                      <span aria-hidden="true">{EXPENSE_CATEGORY_META[group.category].icon}</span>
                      <span className="expense-category-group__label">{EXPENSE_CATEGORY_META[group.category].label}</span>
                      <span className="expense-category-group__total">
                        {expenseGroupDetail.baseCurrency}{' '}
                        {group.expenses.reduce((sum, expense) => sum + expense.convertedAmount, 0).toFixed(2)}
                      </span>
                      <span className={`collapsible-chevron${collapsed ? ' collapsible-chevron--collapsed' : ''}`} aria-hidden="true">
                        ⌄
                      </span>
                    </button>
                    {!collapsed
                      ? group.expenses.map((expense) => {
                          const payer = data.users.find((user) => user.id === expense.paidBy);
                          return (
                            <div key={expense.id} className="expense-row">
                              <span aria-hidden="true">{EXPENSE_CATEGORY_META[expense.category].icon}</span>
                              <div className="expense-row__body">
                                <strong>{expense.description}</strong>
                                <small>
                                  {payer?.name ?? 'Someone'} paid {expense.currency} {expense.amount.toFixed(2)}
                                  {expense.currency !== expenseGroupDetail.baseCurrency
                                    ? ` (${expenseGroupDetail.baseCurrency} ${expense.convertedAmount.toFixed(2)})`
                                    : ''}{' '}
                                  · {expense.spentAt} · split {expense.shares.length} ways
                                </small>
                              </div>
                              {expense.paidBy === data.currentUserId || expenseGroupDetail.ownerId === data.currentUserId ? (
                                <div className="expense-row__actions">
                                  <button
                                    className="icon-button"
                                    type="button"
                                    onClick={() => openEditExpenseForm(expense)}
                                    aria-label="Edit expense"
                                  >
                                    ✎
                                  </button>
                                  <button
                                    className="icon-button"
                                    type="button"
                                    onClick={() => deleteGroupExpense(expense.id)}
                                    aria-label="Delete expense"
                                  >
                                    ×
                                  </button>
                                </div>
                              ) : null}
                            </div>
                          );
                        })
                      : null}
                  </div>
                );
              })}
              {groupExpenses.length === 0 ? <p className="sidebar__empty">No expenses logged yet.</p> : null}
            </div>

            {expenseGroupDetail.ownerId === data.currentUserId ? (
              <button className="expense-group-delete" type="button" onClick={deleteCurrentExpenseGroup}>
                <Trash2 size={16} aria-hidden="true" />
                Delete group
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function TripPlanView({
  days,
  places,
  isOwner,
  attachments,
  currentUserId,
  onSaveAttachment,
}: {
  days: TripDay[];
  places: Place[];
  isOwner: boolean;
  attachments: Record<string, PlaceAttachment> | null;
  currentUserId: string;
  onSaveAttachment: (placeId: string, attachment: PlaceAttachment | null) => Promise<void>;
}) {
  const [viewMode, setViewMode] = useState<'cards' | 'timeline'>('cards');

  if (days.length === 0) {
    return null;
  }

  const destinationColors = buildDestinationColors(days);

  return (
    <div className="trip-plan-view">
      <div className="section-heading">
        <h3>Trip plan</h3>
        <div className="view-toggle">
          <button
            type="button"
            className={`pill${viewMode === 'cards' ? ' pill--active' : ''}`}
            onClick={() => setViewMode('cards')}
          >
            Cards
          </button>
          <button
            type="button"
            className={`pill${viewMode === 'timeline' ? ' pill--active' : ''}`}
            onClick={() => setViewMode('timeline')}
          >
            Timeline
          </button>
        </div>
      </div>

      {viewMode === 'cards' ? (
        <div className="trip-plan-view__days">
          {days.map((tripDay) => {
            const hotel = findHotelForDay(places, tripDay.date);
            return (
            <div key={tripDay.id} className="trip-plan-view__day">
              {tripDay.destination ? (
                <div
                  className="trip-plan-view__destination"
                  style={{ background: destinationColors.get(tripDay.destination) }}
                >
                  {tripDay.destination}
                </div>
              ) : null}
              <strong>{tripDay.label}</strong>
              {hotel?.kind === 'switch' ? (
                <div className="trip-plan-view__hotel trip-plan-view__hotel--switch">
                  <span aria-hidden="true">🔄</span> {hotel.from.name} → {hotel.to.name}
                </div>
              ) : hotel?.kind === 'checkout' ? (
                <div className="trip-plan-view__hotel trip-plan-view__hotel--checkout">
                  <span aria-hidden="true">🧳</span> Checking out of {hotel.hotel.name}
                </div>
              ) : hotel?.kind === 'single' ? (
                <div className="trip-plan-view__hotel">
                  <span aria-hidden="true">🏨</span> Staying at {hotel.hotel.name}
                </div>
              ) : null}
              {tripDay.placeIds.length === 0 ? (
                <p className="trip-day__empty">No stops planned</p>
              ) : (
                <ol>
                  {sortPlaceIdsByTime(tripDay.placeIds, tripDay.placeTimes).map((placeId) => {
                    const place = places.find((item) => item.id === placeId);
                    if (!place) return null;

                    const timeLabel = formatTimeRange(tripDay.placeTimes?.[placeId]);
                    return (
                      <li key={placeId}>
                        <span aria-hidden="true">{CATEGORY_META[place.category].icon}</span> {place.name}
                        {timeLabel ? <span className="trip-plan-view__time"> · {timeLabel}</span> : null}
                      </li>
                    );
                  })}
                </ol>
              )}
            </div>
            );
          })}
        </div>
      ) : (
        <div className="trip-timeline">
          {days.map((tripDay) => {
            const sortedPlaceIds = sortPlaceIdsByTime(tripDay.placeIds, tripDay.placeTimes);
            const hotel = findHotelForDay(places, tripDay.date);
            const firstPlace = sortedPlaceIds.length > 0 ? places.find((item) => item.id === sortedPlaceIds[0]) ?? null : null;

            return (
            <div key={tripDay.id} className="trip-timeline__day">
              <div className="trip-timeline__day-label">{tripDay.label}</div>
              {hotel ? (
                (() => {
                  const referenceHotel = hotel.kind === 'switch' ? hotel.to : hotel.hotel;
                  const icon = hotel.kind === 'switch' ? '🔄' : hotel.kind === 'checkout' ? '🧳' : '🏨';
                  return (
                    <div className="trip-timeline__item">
                      <div className="trip-timeline__marker">
                        <span className="trip-timeline__dot trip-timeline__dot--hotel" aria-hidden="true">
                          {icon}
                        </span>
                        {firstPlace && firstPlace.id !== referenceHotel.id ? (
                          <div className="trip-timeline__line-wrap">
                            <span className="trip-timeline__line trip-timeline__line--hotel" />
                            <TimelineTravelTime origin={referenceHotel} destination={firstPlace} />
                          </div>
                        ) : null}
                      </div>
                      <div className="trip-timeline__content">
                        {hotel.kind === 'switch' ? (
                          <>
                            <strong>
                              Switching hotels: {hotel.from.name} → {hotel.to.name}
                            </strong>
                            <small>
                              Check out of {hotel.from.name}, check into {hotel.to.name}
                            </small>
                          </>
                        ) : hotel.kind === 'checkout' ? (
                          <>
                            <strong>Checking out of {hotel.hotel.name}</strong>
                            <small>Last day at this hotel</small>
                          </>
                        ) : (
                          <>
                            <strong>Staying at {hotel.hotel.name}</strong>
                            <small>{hotel.hotel.address}</small>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })()
              ) : null}
              {tripDay.placeIds.length === 0 ? (
                <p className="trip-day__empty">No stops planned</p>
              ) : (
                sortedPlaceIds.map((placeId, index, sortedIds) => {
                  const place = places.find((item) => item.id === placeId);
                  if (!place) {
                    return null;
                  }

                  const isLast = index === sortedIds.length - 1;
                  const timeRange = tripDay.placeTimes?.[placeId];
                  const timeLabel = formatTimeRange(timeRange);
                  const markerColor = LIST_MARKER_COLORS[index % LIST_MARKER_COLORS.length];
                  const nextPlace = isLast ? null : places.find((item) => item.id === sortedIds[index + 1]) ?? null;
                  return (
                    <div key={placeId} className="trip-timeline__item">
                      <div className="trip-timeline__marker">
                        {timeLabel ? (
                          <span className="trip-timeline__time-badge" style={{ background: markerColor }}>
                            {timeLabel}
                          </span>
                        ) : (
                          <span className="trip-timeline__dot" style={{ background: markerColor }}>
                            {index + 1}
                          </span>
                        )}
                        {!isLast ? (
                          <div className="trip-timeline__line-wrap">
                            <span className="trip-timeline__line" style={{ background: markerColor }} />
                            {nextPlace ? <TimelineTravelTime origin={place} destination={nextPlace} /> : null}
                          </div>
                        ) : null}
                      </div>
                      <div className="trip-timeline__content">
                        <strong>
                          <span aria-hidden="true">{CATEGORY_META[place.category].icon}</span> {place.name}
                        </strong>
                        <small>{place.address}</small>
                        {isOwner ? (
                          <TimelineAttachment
                            attachment={attachments?.[placeId]}
                            onSave={(value) => onSaveAttachment(placeId, value)}
                            currentUserId={currentUserId}
                          />
                        ) : null}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

const TRAVEL_MODE_META: { mode: TravelMode; icon: string; label: string }[] = [
  { mode: 'DRIVING', icon: '🚗', label: 'Driving' },
  { mode: 'WALKING', icon: '🚶', label: 'Walking' },
  { mode: 'TRANSIT', icon: '🚌', label: 'Public transit' },
];

/** Sits on the connecting line between two consecutive timeline stops, showing Google's walk /
 * drive / transit time between them -- the same figure Google Maps shows for directions between
 * two pins, via the Distance Matrix API. Only the selected mode is fetched (not all three up
 * front) to keep this to one billed request per connector per mode actually looked at. */
function TimelineTravelTime({ origin, destination }: { origin: Place; destination: Place }) {
  const [mode, setMode] = useState<TravelMode>('DRIVING');
  const { result, isLoading, error } = useTravelTime(
    { lat: origin.lat, lng: origin.lng },
    { lat: destination.lat, lng: destination.lng },
    mode,
  );

  const durationLabel = isLoading ? '…' : error ? 'unavailable' : result ? result.durationText : 'no route';

  return (
    <div className="travel-time-chip" title={`${TRAVEL_MODE_META.find((m) => m.mode === mode)?.label} time between these stops`}>
      <div className="travel-time-chip__modes">
        {TRAVEL_MODE_META.map(({ mode: candidateMode, icon, label }) => (
          <button
            key={candidateMode}
            type="button"
            className={`travel-time-chip__mode${mode === candidateMode ? ' travel-time-chip__mode--active' : ''}`}
            onClick={() => setMode(candidateMode)}
            aria-label={label}
            title={label}
          >
            {icon}
          </button>
        ))}
      </div>
      <span className="travel-time-chip__duration">{durationLabel}</span>
    </div>
  );
}

function TimelineAttachment({
  attachment,
  onSave,
  currentUserId,
}: {
  attachment: PlaceAttachment | undefined;
  onSave: (attachment: PlaceAttachment | null) => Promise<void>;
  currentUserId: string;
}) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState(attachment?.note ?? '');
  const [files, setFiles] = useState<AttachmentFile[]>(attachment?.files ?? []);
  /** `files[].fileDataUrl` holds a storage PATH once a file is freshly uploaded (see
   * `uploadAttachmentFile`) -- a path isn't directly renderable, so freshly-added files get a
   * short-lived signed URL here for local preview. Files that came in via props (already saved)
   * already have a signed URL in `fileDataUrl` from `fetchAllLists`, so they need no entry here. */
  const [previewUrls, setPreviewUrls] = useState<Record<string, string>>({});
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Only resync from the saved `attachment` while the panel is collapsed. While it's open, the
  // user may have unsaved local edits (a freshly picked file, a typed note) that only exist here
  // until Save is clicked -- a background refetch of `lists` (e.g. react-query's
  // refetchOnWindowFocus firing when the native file-picker dialog closes and the window regains
  // focus) hands this a new `attachment` object on every such refetch, and blindly resyncing from
  // it would silently wipe out those unsaved edits before the user ever sees them.
  useEffect(() => {
    if (open) return;
    setNote(attachment?.note ?? '');
    setFiles(attachment?.files ?? []);
    setPreviewUrls({});
  }, [attachment, open]);

  const hasContent = Boolean(attachment?.note?.trim() || attachment?.files?.length);

  async function handleFiles(event: ChangeEvent<HTMLInputElement>) {
    // `event.target.files` is a *live* FileList tied to the input's current state, not a stable
    // snapshot -- resetting `.value` right after reading it can clear the same list out from
    // under an already-taken reference. Copying to a plain array first avoids that entirely.
    const selectedFiles = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (selectedFiles.length === 0) {
      return;
    }

    const picked = selectedFiles.map((file) => ({ file, id: crypto.randomUUID() }));

    // Show the mini square the instant a file is picked, using a local blob URL -- this needs no
    // network round trip, so it can never be blocked by (or hide behind) whatever the actual
    // upload is doing. `fileDataUrl` starts empty and is filled in per-file once its upload
    // resolves; a file whose upload fails is removed again rather than left in a broken state.
    setFiles((current) => [
      ...current,
      ...picked.map(({ file, id }) => ({ id, fileName: file.name, fileType: file.type, fileDataUrl: '' })),
    ]);
    setPreviewUrls((current) => {
      const next = { ...current };
      picked.forEach(({ file, id }) => {
        next[id] = URL.createObjectURL(file);
      });
      return next;
    });

    setUploading(true);
    setError(null);
    const failures: string[] = [];

    for (const { file, id } of picked) {
      try {
        const { path } = await uploadAttachmentFile(currentUserId, file);
        setFiles((current) => current.map((item) => (item.id === id ? { ...item, fileDataUrl: path } : item)));
      } catch (uploadError) {
        console.error('uploadAttachmentFile failed:', uploadError);
        failures.push(`${file.name}: ${describeQueryError(uploadError)}`);
        setFiles((current) => current.filter((item) => item.id !== id));
        setPreviewUrls((current) => {
          const next = { ...current };
          delete next[id];
          return next;
        });
      }
    }

    setUploading(false);
    if (failures.length > 0) {
      setError(failures.join('; '));
    }
  }

  function previewFor(file: AttachmentFile) {
    return previewUrls[file.id] ?? file.fileDataUrl;
  }

  function removeFile(id: string) {
    setFiles((current) => current.filter((file) => file.id !== id));
  }

  async function save() {
    const trimmedNote = note.trim();
    setSaving(true);
    setError(null);
    try {
      await onSave(!trimmedNote && files.length === 0 ? null : { note: trimmedNote, files });
      setOpen(false);
    } catch (saveError) {
      console.error('saveAttachment failed:', saveError);
      setError(describeQueryError(saveError));
    } finally {
      setSaving(false);
    }
  }

  function cancel() {
    setNote(attachment?.note ?? '');
    setFiles(attachment?.files ?? []);
    setError(null);
    setOpen(false);
  }

  return (
    <div className="timeline-attachment">
      <div className="timeline-attachment__row">
        <button
          type="button"
          className={`timeline-attachment__toggle${hasContent ? ' timeline-attachment__toggle--active' : ''}`}
          onClick={() => setOpen((current) => !current)}
          aria-label={hasContent ? 'Edit private attachment' : 'Add private attachment'}
          title={hasContent ? 'Edit private attachment' : 'Add private attachment'}
        >
          📎
        </button>

        {!open && files.length > 0
          ? files.map((file) => (
              <a
                key={file.id}
                href={previewFor(file)}
                target="_blank"
                rel="noopener noreferrer"
                className="timeline-attachment__minichip"
                title={`Open ${file.fileName}`}
              >
                {file.fileType.startsWith('image/') ? (
                  <img src={previewFor(file)} alt={file.fileName} className="timeline-attachment__minithumb" />
                ) : (
                  <span className="timeline-attachment__minidoc" aria-hidden="true">
                    📄
                  </span>
                )}
              </a>
            ))
          : null}
      </div>

      {!open && attachment?.note?.trim() ? <p className="timeline-attachment__note">{attachment.note}</p> : null}

      {open ? (
        <div className="timeline-attachment__panel">
          <span className="timeline-attachment__badge">🔒 Only you can see this</span>
          <textarea
            className="timeline-attachment__textarea"
            rows={2}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Confirmation #, booking ref, notes..."
            autoFocus
          />
          {files.length > 0 ? (
            <div className="timeline-attachment__files">
              {files.map((file) => (
                <div key={file.id} className="timeline-attachment__file">
                  <a
                    href={previewFor(file)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="timeline-attachment__file-link"
                    title={`Open ${file.fileName}`}
                  >
                    {file.fileType.startsWith('image/') ? (
                      <img src={previewFor(file)} alt={file.fileName} className="timeline-attachment__thumb" />
                    ) : (
                      <span className="timeline-attachment__filechip">📄 {file.fileName}</span>
                    )}
                  </a>
                  <button
                    type="button"
                    className="icon-button"
                    onClick={() => removeFile(file.id)}
                    aria-label={`Remove ${file.fileName}`}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          ) : null}
          <label className="secondary-button timeline-attachment__upload">
            {uploading ? 'Uploading…' : 'Attach image or PDF'}
            <input type="file" accept="image/*,application/pdf" multiple onChange={handleFiles} disabled={uploading} hidden />
          </label>
          {error ? <small className="place-autocomplete__error">{error}</small> : null}
          <div className="timeline-attachment__actions">
            <button type="button" className="secondary-button" onClick={cancel} disabled={saving}>
              Cancel
            </button>
            <button type="button" className="primary-button" onClick={save} disabled={uploading || saving}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function starGlyphs(rating: number): string {
  const rounded = Math.round(rating);
  return '★'.repeat(rounded) + '☆'.repeat(Math.max(0, 5 - rounded));
}

/** The same rich card the map shows for a place -- photos, rating, hours, links -- but as a
 * plain modal, since this opens from the list-detail view, not from a live map instance. */
function PlacePreviewModal({ place, onClose }: { place: Place; onClose: () => void }) {
  const [details, setDetails] = useState<PlaceDetails | null>(null);
  const [loading, setLoading] = useState(Boolean(place.googlePlaceId));

  useEffect(() => {
    let cancelled = false;
    setDetails(null);

    if (!place.googlePlaceId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    fetchPlaceDetails(place.googlePlaceId).then((result) => {
      if (!cancelled) {
        setDetails(result);
        setLoading(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [place.googlePlaceId]);

  const hasLinks = Boolean(details?.mapsUrl || details?.website || details?.phone);

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div className="modal panel place-preview-modal" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <button className="icon-button list-detail-modal__close" type="button" onClick={onClose} aria-label="Close">
          ×
        </button>

        {details?.photoUrls && details.photoUrls.length > 0 ? (
          <div className="map-popup__photos place-preview-modal__photos">
            {details.photoUrls.map((url) => (
              <img key={url} src={url} alt="" className="map-popup__photo" />
            ))}
          </div>
        ) : null}

        <h3>
          <span aria-hidden="true">{CATEGORY_META[place.category].icon}</span> {place.name}
        </h3>

        {details?.rating ? (
          <div className="map-popup__meta">
            <span className="map-popup__stars">{starGlyphs(details.rating)}</span>
            <span>
              {details.rating.toFixed(1)}
              {details.userRatingsTotal ? ` (${details.userRatingsTotal})` : ''}
            </span>
            {details.priceLevel ? <span>· {'$'.repeat(details.priceLevel)}</span> : null}
          </div>
        ) : null}

        <p className="detail-panel__description">{place.address}</p>

        {details?.openNow !== undefined ? (
          <span className={`map-popup__open-badge ${details.openNow ? 'map-popup__open-badge--open' : 'map-popup__open-badge--closed'}`}>
            {details.openNow ? 'Open now' : 'Closed now'}
          </span>
        ) : null}

        {loading ? <p className="draft-places__empty">Loading details…</p> : null}

        {hasLinks ? (
          <div className="map-popup__links">
            {details?.mapsUrl ? (
              <a href={details.mapsUrl} target="_blank" rel="noopener noreferrer">
                View on Google Maps
              </a>
            ) : null}
            {details?.website ? (
              <a href={details.website} target="_blank" rel="noopener noreferrer">
                Website
              </a>
            ) : null}
            {details?.phone ? <a href={`tel:${details.phone}`}>{details.phone}</a> : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function SavedPlacesView({ places, onSelectPlace }: { places: Place[]; onSelectPlace: (placeId: string) => void }) {
  const [collapsedCategories, setCollapsedCategories] = useState<Set<PlaceCategory>>(new Set());

  function toggleCategory(category: PlaceCategory) {
    setCollapsedCategories((current) => {
      const next = new Set(current);
      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }
      return next;
    });
  }

  return (
    <div className="place-list">
      <h3>Saved places</h3>
      {groupPlacesByCategory(places).map((group) => {
        const collapsed = collapsedCategories.has(group.category);
        return (
          <div key={group.category} className="place-category-group">
            <button
              type="button"
              className="collapsible-header place-category-group__heading"
              onClick={() => toggleCategory(group.category)}
            >
              <span aria-hidden="true">{CATEGORY_META[group.category].icon}</span>
              <span className="place-category-group__label">{CATEGORY_META[group.category].label}</span>
              <span className={`collapsible-chevron${collapsed ? ' collapsible-chevron--collapsed' : ''}`} aria-hidden="true">
                ⌄
              </span>
            </button>
            {!collapsed
              ? group.places.map((place) => (
                  <button
                    key={place.id}
                    type="button"
                    className="place-list__item place-list__item--clickable"
                    onClick={() => onSelectPlace(place.id)}
                  >
                    <span className="place-dot" />
                    <div>
                      <strong>{place.name}</strong>
                      <small>{place.address}</small>
                    </div>
                  </button>
                ))
              : null}
          </div>
        );
      })}
    </div>
  );
}

function ExpenseGroupCard({
  group,
  list,
  currentUserId,
  users,
  onOpen,
}: {
  group: ExpenseGroupWithMembers;
  list: TripList | undefined;
  currentUserId: string;
  users: AppData['users'];
  onOpen: () => void;
}) {
  const { expenses, settlements } = useGroupExpenses(group.id, group.baseCurrency);
  const acceptedMemberIds = group.members.filter((member) => member.status === 'accepted').map((member) => member.userId);
  const myBalance = computeBalances(acceptedMemberIds, expenses, settlements).find((balance) => balance.userId === currentUserId);
  const balanceLabel = !myBalance || Math.abs(myBalance.net) < 0.01
    ? "You're settled up"
    : myBalance.net > 0
      ? `You are owed ${group.baseCurrency} ${myBalance.net.toFixed(2)}`
      : `You owe ${group.baseCurrency} ${Math.abs(myBalance.net).toFixed(2)}`;

  return (
    <button className="expense-group-card" type="button" onClick={onOpen}>
      <p className="eyebrow">{list?.title ?? 'Trip'}</p>
      <strong>{group.name}</strong>
      <div className="expense-group-card__avatars">
        {group.members.map((member) => (
          <Avatar
            key={member.userId}
            user={users.find((user) => user.id === member.userId)}
            className="dm-thread__avatar expense-group-card__avatar"
          />
        ))}
      </div>
      <span className={`expense-group-card__balance${myBalance && myBalance.net < -0.01 ? ' expense-group-card__balance--owe' : myBalance && myBalance.net > 0.01 ? ' expense-group-card__balance--owed' : ''}`}>
        {balanceLabel}
      </span>
    </button>
  );
}

function RectCard({
  list,
  liked,
  likeCount,
  onOpen,
  onToggleLike,
}: {
  list: TripList;
  liked: boolean;
  likeCount: number;
  onOpen: () => void;
  onToggleLike: () => void;
}) {
  return (
    <div className="rect-card">
      <button className="rect-card__hit" type="button" onClick={onOpen}>
        <img src={list.coverImage} alt="" className="rect-card__img" />
        <span className="rect-card__scrim" />
        <strong className="rect-card__name">{list.title}</strong>
      </button>
      <button
        className={`rect-card__like${liked ? ' rect-card__like--active' : ''}`}
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onToggleLike();
        }}
        aria-label={liked ? 'Unlike this list' : 'Like this list'}
      >
        <span aria-hidden="true">♥</span> {likeCount}
      </button>
    </div>
  );
}

function SidebarListItem({
  list,
  active,
  onSelect,
  onView,
  timelineOpen,
  onToggleTimeline,
  selectedDayId,
  onSelectDay,
}: {
  list: TripList;
  active: boolean;
  onSelect: () => void;
  onView: () => void;
  timelineOpen: boolean;
  onToggleTimeline: () => void;
  /** null = "All days" -- every place in the list, not just one day's. */
  selectedDayId: string | null;
  onSelectDay: (dayId: string | null) => void;
}) {
  const selectedDay = selectedDayId ? list.days.find((day) => day.id === selectedDayId) ?? null : null;
  const scheduledPlaceIds = selectedDay ? selectedDay.placeIds : Array.from(getScheduledPlaceIds(list));
  const activityPlaces = scheduledPlaceIds
    .map((placeId) => list.places.find((place) => place.id === placeId))
    .filter((place): place is Place => Boolean(place));

  return (
    <div className={`account-list-sidebar__item${active ? ' account-list-sidebar__item--active' : ''}`}>
      <div className="account-list-sidebar__row">
        <button className="account-list-sidebar__hit" type="button" onClick={onSelect}>
          <img src={list.coverImage} alt="" className="account-list-sidebar__thumb" />
          <strong>{list.title}</strong>
        </button>
        <button
          className={`icon-button${timelineOpen ? ' icon-button--active' : ''}`}
          type="button"
          onClick={onToggleTimeline}
          aria-label={timelineOpen ? `Hide ${list.title} timeline` : `Show ${list.title} timeline`}
          aria-expanded={timelineOpen}
        >
          🗓
        </button>
        <button className="icon-button" type="button" onClick={onView} aria-label={`View ${list.title} details`}>
          ⓘ
        </button>
      </div>

      {timelineOpen ? (
        <div className="sidebar-timeline">
          {list.days.length === 0 ? (
            <p className="sidebar__empty">No trip days yet -- add days from Edit list.</p>
          ) : (
            <>
              <div className="sidebar-timeline__days">
                <button
                  type="button"
                  className={`pill${!selectedDay ? ' pill--active' : ''}`}
                  onClick={() => onSelectDay(null)}
                >
                  All days
                </button>
                {list.days.map((day) => (
                  <button
                    key={day.id}
                    type="button"
                    className={`pill${selectedDay?.id === day.id ? ' pill--active' : ''}`}
                    onClick={() => onSelectDay(day.id)}
                  >
                    {day.label}
                  </button>
                ))}
              </div>
              <div className="sidebar-timeline__activities">
                {activityPlaces.length > 0 ? (
                  activityPlaces.map((place) => (
                    <div key={place.id} className="sidebar-timeline__activity">
                      <span aria-hidden="true">{CATEGORY_META[place.category].icon}</span>
                      <div>
                        <strong>{place.name}</strong>
                        <small>{place.address}</small>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="sidebar__empty">No stops planned for this day.</p>
                )}
              </div>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

function Stat({ label, value, onClick }: { label: string; value: number | string; onClick?: () => void }) {
  if (onClick) {
    return (
      <button className="stat-pill" type="button" onClick={onClick}>
        <strong>{value}</strong>
        <span>{label}</span>
      </button>
    );
  }

  return (
    <div className="stat-pill">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

type ChartSlice = { label: string; total: number; color: string };

/** Dependency-free donut chart built from plain SVG arc paths -- there's no charting library in
 * this project, and a handful of slices doesn't warrant pulling one in. */
function PieChart({ slices, currency }: { slices: ChartSlice[]; currency: string }) {
  const nonZero = slices.filter((slice) => slice.total > 0.004);
  const total = nonZero.reduce((sum, slice) => sum + slice.total, 0);
  if (total <= 0) {
    return <p className="sidebar__empty">Nothing to chart yet.</p>;
  }

  const size = 140;
  const radius = size / 2;
  let cumulative = 0;
  const arcs: (ChartSlice & { isFullCircle: boolean; d?: string })[] =
    nonZero.length === 1
      ? [{ ...nonZero[0], isFullCircle: true }]
      : nonZero.map((slice) => {
          const startAngle = (cumulative / total) * 2 * Math.PI;
          cumulative += slice.total;
          const endAngle = (cumulative / total) * 2 * Math.PI;
          const x1 = radius + radius * Math.sin(startAngle);
          const y1 = radius - radius * Math.cos(startAngle);
          const x2 = radius + radius * Math.sin(endAngle);
          const y2 = radius - radius * Math.cos(endAngle);
          const largeArc = endAngle - startAngle > Math.PI ? 1 : 0;
          return {
            ...slice,
            isFullCircle: false,
            d: `M ${radius} ${radius} L ${x1} ${y1} A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2} Z`,
          };
        });

  return (
    <div className="pie-chart">
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} role="img" aria-label="Breakdown pie chart">
        {arcs.map((arc) =>
          arc.isFullCircle ? (
            <circle key={arc.label} cx={radius} cy={radius} r={radius} fill={arc.color} />
          ) : (
            <path key={arc.label} d={arc.d ?? ''} fill={arc.color} />
          ),
        )}
      </svg>
      <ul className="pie-chart__legend">
        {nonZero.map((slice) => (
          <li key={slice.label}>
            <span className="pie-chart__swatch" style={{ background: slice.color }} aria-hidden="true" />
            <span className="pie-chart__legend-label">{slice.label}</span>
            <span className="pie-chart__legend-value">
              {currency} {slice.total.toFixed(2)} · {Math.round((slice.total / total) * 100)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function BarChart({
  bars,
  currency,
  orientation = 'horizontal',
}: {
  bars: ChartSlice[];
  currency: string;
  orientation?: 'horizontal' | 'vertical';
}) {
  const max = Math.max(...bars.map((bar) => bar.total), 0.01);

  if (orientation === 'vertical') {
    return (
      <div className="bar-chart bar-chart--vertical">
        {bars.map((bar) => (
          <div key={bar.label} className="bar-chart__column">
            <span className="bar-chart__value">
              {currency} {bar.total.toFixed(2)}
            </span>
            <div className="bar-chart__column-track">
              <div
                className="bar-chart__column-fill"
                style={{ height: `${(bar.total / max) * 100}%`, background: bar.color }}
              />
            </div>
            <span className="bar-chart__label">{bar.label}</span>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="bar-chart">
      {bars.map((bar) => (
        <div key={bar.label} className="bar-chart__row">
          <span className="bar-chart__label">{bar.label}</span>
          <div className="bar-chart__track">
            <div className="bar-chart__fill" style={{ width: `${(bar.total / max) * 100}%`, background: bar.color }} />
          </div>
          <span className="bar-chart__value">
            {currency} {bar.total.toFixed(2)}
          </span>
        </div>
      ))}
    </div>
  );
}

function Avatar({
  user,
  className,
}: {
  user: Pick<AppData['users'][number], 'avatar' | 'accent' | 'avatarImage'> | undefined;
  className: string;
}) {
  if (user?.avatarImage) {
    return <img src={user.avatarImage} alt="" className={`${className} avatar-img`} />;
  }

  return (
    <div className={className} style={{ background: user?.accent ?? 'linear-gradient(135deg, #8c7c7c, #4a4a4a)' }}>
      {user?.avatar ?? '??'}
    </div>
  );
}

export default AppShell;
