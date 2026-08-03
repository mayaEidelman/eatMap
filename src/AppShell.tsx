import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { ImportPlacesModal } from './components/ImportPlacesModal';
import { MapPanel } from './components/MapPanel';
import { PlaceAutocomplete } from './components/PlaceAutocomplete';
import { CATEGORY_META, groupPlacesByCategory } from './lib/categories';
import { demoData, emptyDraft } from './mock';
import { PLACE_CATEGORIES } from './types';
import type {
  AppData,
  AttachmentFile,
  DraftList,
  DraftPlace,
  PageMode,
  Place,
  PlaceAttachment,
  PlaceCategory,
  ProfileDraft,
  Rating,
  TripDay,
  TripList,
} from './types';

const STORAGE_KEY = 'eatmap-v4';
const AUTH_STORAGE_KEY = 'eatmap-authenticated-v1';
const DEFAULT_COVER = 'https://images.unsplash.com/photo-1502920917128-1aa500764cbd?q=80&w=1200&auto=format&fit=crop';

function cloneData(): AppData {
  return structuredClone(demoData);
}

function loadData(): AppData {
  if (typeof window === 'undefined') {
    return cloneData();
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return cloneData();
    }

    const parsed = JSON.parse(raw) as AppData;
    const hasValidShape =
      parsed.users?.length &&
      parsed.lists?.length &&
      parsed.savedLists &&
      parsed.likes &&
      parsed.lists.every((list) => Array.isArray(list.days) && list.places.every((place) => Boolean(place.category)));

    if (!hasValidShape) {
      return cloneData();
    }

    return parsed;
  } catch {
    return cloneData();
  }
}

function persistData(data: AppData) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function loadAuthState() {
  if (typeof window === 'undefined') {
    return false;
  }

  return window.localStorage.getItem(AUTH_STORAGE_KEY) === 'true';
}

function persistAuthState(isAuthenticated: boolean) {
  window.localStorage.setItem(AUTH_STORAGE_KEY, String(isAuthenticated));
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
  };
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

type DirectMessage = {
  id: string;
  fromId: string;
  toId: string;
  text: string;
  createdAt: string;
};

function seedMessages(): DirectMessage[] {
  return [
    {
      id: 'dm-1',
      fromId: 'u-sofia',
      toId: 'u-noah',
      text: 'Send me the Kyoto route. I want to save that list.',
      createdAt: '2026-07-25T12:20:00.000Z',
    },
    {
      id: 'dm-2',
      fromId: 'u-noah',
      toId: 'u-sofia',
      text: 'Already pinned. Check the map and the tea house notes.',
      createdAt: '2026-07-25T12:24:00.000Z',
    },
    {
      id: 'dm-3',
      fromId: 'u-maya',
      toId: 'u-aya',
      text: 'I want to save your Lisbon rooftop list next.',
      createdAt: '2026-07-26T09:10:00.000Z',
    },
  ];
}

function AppShell() {
  const [data, setData] = useState<AppData>(loadData);
  const [isAuthenticated, setIsAuthenticated] = useState(loadAuthState);
  const [authMode, setAuthMode] = useState<'login' | 'signup'>('login');
  const [page, setPage] = useState<PageMode>('home');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedListId, setSelectedListId] = useState(data.lists[0]?.id ?? '');
  const [listDetailId, setListDetailId] = useState<string | null>(null);
  const [peopleListOpen, setPeopleListOpen] = useState<{ userId: string; mode: 'followers' | 'following' } | null>(null);
  const [viewedProfileId, setViewedProfileId] = useState<string | null>(null);
  const [dmThreadUserId, setDmThreadUserId] = useState<string>(data.users.find((user) => user.id !== data.currentUserId)?.id ?? '');
  const [dmDraft, setDmDraft] = useState('');
  const [dmMessages, setDmMessages] = useState<DirectMessage[]>(seedMessages);
  const [composerOpen, setComposerOpen] = useState(false);
  const [profileEditorOpen, setProfileEditorOpen] = useState(false);
  const [listFormMode, setListFormMode] = useState<'create' | 'edit'>('create');
  const [draft, setDraft] = useState<DraftList>(emptyDraft);
  const [profileDraft, setProfileDraft] = useState<ProfileDraft>(buildProfileDraft(data.users[0]));
  const [importPlacesOpen, setImportPlacesOpen] = useState(false);

  useEffect(() => {
    persistData(data);
  }, [data]);

  useEffect(() => {
    persistAuthState(isAuthenticated);
  }, [isAuthenticated]);

  const currentUser = data.users.find((user) => user.id === data.currentUserId) ?? data.users[0];
  const selectedList = data.lists.find((list) => list.id === selectedListId) ?? data.lists[0];

  useEffect(() => {
    if (!selectedList && data.lists[0]) {
      setSelectedListId(data.lists[0].id);
    }
  }, [data.lists, selectedList]);

  useEffect(() => {
    if (currentUser) {
      setProfileDraft(buildProfileDraft(currentUser));
    }
  }, [currentUser?.id]);

  const addDraftPlace = useCallback((place: DraftPlace) => {
    setDraft((current) => ({ ...current, places: [...current.places, place] }));
  }, []);

  const importDraftPlaces = useCallback((imported: DraftPlace[]) => {
    setDraft((current) => {
      const existingNames = new Set(current.places.map((place) => place.name.trim().toLowerCase()));
      const newPlaces = imported.filter((place) => !existingNames.has(place.name.trim().toLowerCase()));
      return { ...current, places: [...current.places, ...newPlaces] };
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

  const unscheduleDraftPlace = useCallback((placeId: string) => {
    setDraft((current) => ({
      ...current,
      days: current.days.map((tripDay) => ({ ...tripDay, placeIds: tripDay.placeIds.filter((id) => id !== placeId) })),
    }));
  }, []);

  const exploreLists = useMemo(() => filterByQuery(data.lists, search), [data.lists, search]);

  const accountLists = useMemo(
    () => data.lists.filter((list) => list.ownerId === data.currentUserId),
    [data.currentUserId, data.lists],
  );

  const savedLists = useMemo(
    () =>
      data.lists.filter(
        (list) => list.ownerId !== data.currentUserId && isSaved(data.savedLists, data.currentUserId, list.id),
      ),
    [data.currentUserId, data.lists, data.savedLists],
  );

  const myMapLists = useMemo(() => {
    const combined = [...accountLists, ...savedLists];
    const query = search.trim().toLowerCase();
    if (!query) {
      return combined;
    }

    return combined.filter((list) =>
      [list.title, list.location, list.country, list.vibe].some((value) => value.toLowerCase().includes(query)),
    );
  }, [accountLists, savedLists, search]);

  const peopleToFollow = useMemo(
    () => data.users.filter((user) => user.id !== data.currentUserId),
    [data.currentUserId, data.users],
  );

  const listDetail = data.lists.find((list) => list.id === listDetailId) ?? null;
  const listDetailOwner = listDetail ? data.users.find((user) => user.id === listDetail.ownerId) : undefined;

  const viewedProfile = data.users.find((user) => user.id === viewedProfileId) ?? null;
  const viewedProfileStats = viewedProfile ? getUserStats(viewedProfile.id, data) : null;
  const viewedProfileLists = viewedProfile ? data.lists.filter((list) => list.ownerId === viewedProfile.id) : [];

  const peopleListUsers = peopleListOpen
    ? peopleListOpen.mode === 'followers'
      ? getFollowerUsers(peopleListOpen.userId, data)
      : getFollowingUsers(peopleListOpen.userId, data)
    : [];

  useEffect(() => {
    if (!dmThreadUserId && peopleToFollow[0]) {
      setDmThreadUserId(peopleToFollow[0].id);
    }
  }, [dmThreadUserId, peopleToFollow]);

  const listDetailRatingSummary = listDetail ? getListSummary(listDetail.id, data.ratings) : { count: 0, average: 0 };
  const listDetailYourRating = listDetail
    ? data.ratings.find((rating) => rating.listId === listDetail.id && rating.userId === data.currentUserId)
    : undefined;

  function login(userId: string) {
    setData((current) => ({ ...current, currentUserId: userId }));
    setPage('home');
    setIsAuthenticated(true);
  }

  function continueWithGoogle() {
    setIsAuthenticated(true);
  }

  function signOut() {
    setIsAuthenticated(false);
  }

  function sendDirectMessage() {
    const text = dmDraft.trim();
    if (!text || !dmThreadUserId) {
      return;
    }

    setDmMessages((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        fromId: data.currentUserId,
        toId: dmThreadUserId,
        text,
        createdAt: new Date().toISOString(),
      },
    ]);
    setDmDraft('');
  }

  function toggleFollow(targetUserId: string) {
    if (targetUserId === data.currentUserId) {
      return;
    }

    setData((current) => {
      const exists = isFollowing(current.follows, current.currentUserId, targetUserId);
      const follows = exists
        ? current.follows.filter(
            (follow) => !(follow.followerId === current.currentUserId && follow.followingId === targetUserId),
          )
        : [...current.follows, { followerId: current.currentUserId, followingId: targetUserId }];

      return { ...current, follows };
    });
  }

  function toggleSaveList(listId: string) {
    setData((current) => {
      const exists = isSaved(current.savedLists, current.currentUserId, listId);
      const nextSavedLists = exists
        ? current.savedLists.filter((saved) => !(saved.userId === current.currentUserId && saved.listId === listId))
        : [...current.savedLists, { userId: current.currentUserId, listId }];

      return { ...current, savedLists: nextSavedLists };
    });
  }

  function toggleLike(listId: string) {
    setData((current) => {
      const exists = isLiked(current.likes, current.currentUserId, listId);
      const nextLikes = exists
        ? current.likes.filter((like) => !(like.userId === current.currentUserId && like.listId === listId))
        : [...current.likes, { userId: current.currentUserId, listId }];

      return { ...current, likes: nextLikes };
    });
  }

  function updatePlaceAttachment(listId: string, placeId: string, attachment: PlaceAttachment | null) {
    setData((current) => ({
      ...current,
      lists: current.lists.map((list) => {
        if (list.id !== listId) {
          return list;
        }

        const nextAttachments = { ...list.placeAttachments };
        if (attachment) {
          nextAttachments[placeId] = attachment;
        } else {
          delete nextAttachments[placeId];
        }

        return { ...list, placeAttachments: nextAttachments };
      }),
    }));
  }

  function openCreateList() {
    setListFormMode('create');
    setDraft(emptyDraft);
    setComposerOpen(true);
  }

  function openProfileEditor() {
    setProfileDraft(buildProfileDraft(currentUser));
    setProfileEditorOpen(true);
  }

  function openEditList(list: TripList) {
    setListFormMode('edit');
    setDraft(buildListDraft(list));
    setSelectedListId(list.id);
    setListDetailId(null);
    setComposerOpen(true);
  }

  function openListDetail(listId: string) {
    setListDetailId(listId);
  }

  function showListOnMap(listId: string) {
    setSelectedListId(listId);
    setPage('home');
    setListDetailId(null);
  }

  function openProfile(userId: string) {
    if (userId === data.currentUserId) {
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

  function handleCoverFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setDraft((current) => ({ ...current, coverImage: reader.result as string }));
      }
    };
    reader.readAsDataURL(file);
    event.target.value = '';
  }

  function handleAvatarFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setProfileDraft((current) => ({ ...current, avatarImage: reader.result as string }));
      }
    };
    reader.readAsDataURL(file);
    event.target.value = '';
  }

  function rateList(listId: string, ownerId: string | undefined, score: number) {
    if (ownerId === data.currentUserId) {
      return;
    }

    setData((current) => {
      const ratings = current.ratings.filter(
        (rating) => !(rating.listId === listId && rating.userId === current.currentUserId),
      );

      const nextRating: Rating = {
        id: crypto.randomUUID(),
        listId,
        userId: current.currentUserId,
        score,
        createdAt: new Date().toISOString(),
      };

      return {
        ...current,
        ratings: [...ratings, nextRating],
      };
    });
  }

  function submitListForm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!draft.title.trim() || !draft.location.trim() || draft.places.length === 0) {
      return;
    }

    const nextCreatedListId = crypto.randomUUID();
    const editingListId = listFormMode === 'edit' ? selectedList?.id : undefined;

    setData((current) => {
      if (listFormMode === 'edit' && editingListId) {
        return {
          ...current,
          lists: current.lists.map((list) =>
            list.id === editingListId
              ? {
                  ...list,
                  title: draft.title.trim(),
                  coverImage: draft.coverImage.trim() || DEFAULT_COVER,
                  location: draft.location.trim(),
                  country: draft.country.trim() || 'Unknown',
                  vibe: draft.vibe.trim() || 'custom route',
                  description: draft.description.trim() || 'A new list from the community.',
                  places: draft.places,
                  days: draft.days,
                  season: draft.season,
                  budget: draft.budget,
                }
              : list,
          ),
        };
      }

      const nextList: TripList = {
        id: nextCreatedListId,
        ownerId: current.currentUserId,
        title: draft.title.trim(),
        coverImage: draft.coverImage.trim() || DEFAULT_COVER,
        location: draft.location.trim(),
        country: draft.country.trim() || 'Unknown',
        vibe: draft.vibe.trim() || 'custom route',
        description: draft.description.trim() || 'A new list from the community.',
        places: draft.places,
        days: draft.days,
        season: draft.season,
        budget: draft.budget,
        createdAt: new Date().toISOString(),
      };

      return {
        ...current,
        lists: [nextList, ...current.lists],
      };
    });

    if (listFormMode === 'create') {
      setSelectedListId(nextCreatedListId);
    } else if (editingListId) {
      setSelectedListId(editingListId);
    }

    setComposerOpen(false);
    setDraft(emptyDraft);
  }

  function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setData((current) => ({
      ...current,
      users: current.users.map((user) =>
        user.id === current.currentUserId
          ? {
              ...user,
              name: profileDraft.name.trim() || user.name,
              handle: profileDraft.handle.trim() || user.handle,
              city: profileDraft.city.trim() || user.city,
              bio: profileDraft.bio.trim() || user.bio,
              avatar: profileDraft.avatar.trim() || user.avatar,
              avatarImage: profileDraft.avatarImage.trim(),
            }
          : user,
      ),
    }));
    setProfileEditorOpen(false);
  }

  const stats = useMemo(() => {
    if (!currentUser) {
      return { followers: 0, following: 0, trips: 0, avgRating: 0 };
    }

    return getUserStats(currentUser.id, data);
  }, [currentUser, data]);

  if (!currentUser) {
    return null;
  }

  if (!isAuthenticated) {
    return (
      <div className="auth-screen">
        <section className="auth-screen__panel panel">
          <div className="auth-screen__badge">EatMap</div>
          <div className="auth-screen__copy">
            <p className="eyebrow">Trip planning social map</p>
            <h1>Sign in or create your account to continue.</h1>
            <p>Use Google to get into your trip map, explore other travelers, and manage your own saved lists.</p>
          </div>

          <div className="auth-switcher">
            <button className={`pill${authMode === 'login' ? ' pill--active' : ''}`} type="button" onClick={() => setAuthMode('login')}>
              Log in
            </button>
            <button className={`pill${authMode === 'signup' ? ' pill--active' : ''}`} type="button" onClick={() => setAuthMode('signup')}>
              Sign up
            </button>
          </div>

          <button className="google-button" type="button" onClick={continueWithGoogle}>
            <span className="google-button__mark">G</span>
            <span>
              <strong>{authMode === 'login' ? 'Continue with Google' : 'Create with Google'}</strong>
              <small>{authMode === 'login' ? 'Enter the app with your Google account.' : 'Start your profile with Google.'}</small>
            </span>
          </button>

          <div className="auth-screen__demo">
            <div className="section-heading">
              <h3>Demo travelers</h3>
              <span>pick one to preview the app</span>
            </div>
            <div className="auth-demo-grid">
              {data.users.map((user) => (
                <button
                  key={user.id}
                  className={`demo-account${user.id === data.currentUserId ? ' demo-account--active' : ''}`}
                  type="button"
                  onClick={() => login(user.id)}
                >
                  <Avatar user={user} className="demo-account__avatar" />
                  <span>
                    <strong>{user.name}</strong>
                    <small>{user.handle}</small>
                  </span>
                </button>
              ))}
            </div>
          </div>
        </section>

        <aside className="auth-screen__art panel">
          <div className="auth-screen__orb auth-screen__orb--one" />
          <div className="auth-screen__orb auth-screen__orb--two" />
          <div className="auth-screen__preview">
            <p className="eyebrow">What you get after login</p>
            <h2>Map home, explore feed, account, and DMs.</h2>
            <ul>
              <li>Your map with your lists and saved lists</li>
              <li>Explore lists and travelers like a social app</li>
              <li>Account page shows every list you have created</li>
              <li>DM travelers about routes</li>
            </ul>
          </div>
          <button className="secondary-button auth-screen__signout" type="button" onClick={signOut}>
            Reset session
          </button>
        </aside>
      </div>
    );
  }

  const pageLabel = page === 'home' ? 'Map' : page === 'explore' ? 'Explore' : page === 'dm' ? 'Messages' : 'Account';

  return (
    <div className="app-shell">
      <header className="topbar panel">
        <div className="topbar__brand">
          <div className="topbar__logo">E</div>
          <div>
            <strong>EatMap</strong>
            <p>{pageLabel}</p>
          </div>
        </div>

        <nav className="topbar__nav" aria-label="Main navigation">
          <button className={`nav-tab${page === 'home' ? ' nav-tab--active' : ''}`} type="button" onClick={() => setPage('home')}>
            Map
          </button>
          <button className={`nav-tab${page === 'explore' ? ' nav-tab--active' : ''}`} type="button" onClick={() => setPage('explore')}>
            Explore
          </button>
          <button className={`nav-tab${page === 'dm' ? ' nav-tab--active' : ''}`} type="button" onClick={() => setPage('dm')}>
            DM
          </button>
          <button className={`nav-tab${page === 'account' ? ' nav-tab--active' : ''}`} type="button" onClick={() => setPage('account')}>
            Account
          </button>
        </nav>

        <label className="topbar__search">
          <span className="sr-only">Search</span>
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search lists" />
        </label>
      </header>

      {page === 'home' ? (
        <div className={`map-page page-transition${sidebarOpen ? '' : ' map-page--collapsed'}`}>
          {sidebarOpen ? (
            <aside className="map-sidebar panel">
              <div className="map-sidebar__header">
                <h3>Lists</h3>
                <button className="icon-button" type="button" onClick={() => setSidebarOpen(false)} aria-label="Hide sidebar">
                  ‹
                </button>
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
                      />
                    ))
                  ) : (
                    <p className="sidebar__empty">You haven't created a list yet.</p>
                  )}
                </div>
              </div>

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
                      />
                    ))
                  ) : (
                    <p className="sidebar__empty">Save a list from Explore to pin it here.</p>
                  )}
                </div>
              </div>
            </aside>
          ) : (
            <button className="sidebar-toggle icon-button" type="button" onClick={() => setSidebarOpen(true)} aria-label="Show sidebar">
              ›
            </button>
          )}

          <MapPanel
            lists={myMapLists}
            selectedListId={selectedList?.id ?? myMapLists[0]?.id ?? ''}
            onSelectList={setSelectedListId}
          />
        </div>
      ) : null}

      {page === 'explore' ? (
        <div className="explore-page page-transition">
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
                  return (
                    <div key={message.id} className={`dm-bubble${isMine ? ' dm-bubble--mine' : ''}`}>
                      {message.text}
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
                <span>City</span>
                <input value={draft.location} onChange={(event) => setDraft((current) => ({ ...current, location: event.target.value }))} required />
              </label>
              <label>
                <span>Country</span>
                <input value={draft.country} onChange={(event) => setDraft((current) => ({ ...current, country: event.target.value }))} />
              </label>
              <label>
                <span>Vibe</span>
                <input value={draft.vibe} onChange={(event) => setDraft((current) => ({ ...current, vibe: event.target.value }))} />
              </label>

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

              <div className="form-grid__full draft-places">
                <div className="draft-places__heading">
                  <span>Saved places ({draft.places.length})</span>
                  <button type="button" className="secondary-button" onClick={() => setImportPlacesOpen(true)}>
                    Import from Google Maps
                  </button>
                </div>
                <PlaceAutocomplete onAdd={addDraftPlace} />
                <div className="draft-places__list">
                  {draft.places.map((place) => (
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
                      <button type="button" className="icon-button" onClick={() => removeDraftPlace(place.id)} aria-label={`Remove ${place.name}`}>
                        ×
                      </button>
                    </div>
                  ))}
                  {draft.places.length === 0 ? <p className="draft-places__empty">Search above to pin real places from Google Maps.</p> : null}
                </div>
              </div>

              <div className="form-grid__full trip-plan-editor">
                <div className="section-heading">
                  <h3>Trip plan</h3>
                  <button type="button" className="secondary-button" onClick={addDraftDay}>
                    + Add day
                  </button>
                </div>

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
                      <div className="trip-day__places">
                        {tripDay.placeIds.map((placeId) => {
                          const place = draft.places.find((item) => item.id === placeId);
                          if (!place) {
                            return null;
                          }

                          return (
                            <div
                              key={placeId}
                              className="trip-place-card"
                              draggable
                              onDragStart={(event) => event.dataTransfer.setData('text/plain', placeId)}
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
                          );
                        })}
                        {tripDay.placeIds.length === 0 ? <p className="trip-day__empty">Drag a place here</p> : null}
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
                      .map((place) => (
                        <div
                          key={place.id}
                          className="trip-place-card"
                          draggable
                          onDragStart={(event) => event.dataTransfer.setData('text/plain', place.id)}
                        >
                          <span aria-hidden="true">{CATEGORY_META[place.category].icon}</span>
                          <span className="trip-place-card__name">{place.name}</span>
                        </div>
                      ))}
                    {draft.places.length === 0 ? <p className="trip-day__empty">Add places above first.</p> : null}
                  </div>
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
              <div className="form-grid__full modal-actions">
                <button className="secondary-button" type="button" onClick={() => setComposerOpen(false)}>
                  Cancel
                </button>
                <button className="primary-button" type="submit">
                  {listFormMode === 'create' ? 'Publish list' : 'Save changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {importPlacesOpen ? (
        <ImportPlacesModal onClose={() => setImportPlacesOpen(false)} onImport={importDraftPlaces} />
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
                <p className="eyebrow">{listDetail.location}, {listDetail.country}</p>
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

            <div className="detail-meta">
              <span className="chip">{listDetail.vibe}</span>
              <span className="chip chip--soft">{listDetail.season}</span>
              <span className="chip chip--soft">{listDetail.budget}</span>
            </div>

            <div className="owner-card">
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
              {listDetailOwner?.id === currentUser.id ? (
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

            <TripPlanView
              key={`${listDetail.id}-days`}
              days={listDetail.days}
              places={listDetail.places}
              isOwner={listDetailOwner?.id === currentUser.id}
              attachments={listDetailOwner?.id === currentUser.id ? listDetail.placeAttachments ?? {} : null}
              onSaveAttachment={(placeId, attachment) => updatePlaceAttachment(listDetail.id, placeId, attachment)}
            />

            <SavedPlacesView key={`${listDetail.id}-places`} places={listDetail.places} />

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
    </div>
  );
}

function TripPlanView({
  days,
  places,
  isOwner,
  attachments,
  onSaveAttachment,
}: {
  days: TripDay[];
  places: Place[];
  isOwner: boolean;
  attachments: Record<string, PlaceAttachment> | null;
  onSaveAttachment: (placeId: string, attachment: PlaceAttachment | null) => void;
}) {
  const [viewMode, setViewMode] = useState<'cards' | 'timeline'>('cards');

  if (days.length === 0) {
    return null;
  }

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
          {days.map((tripDay) => (
            <div key={tripDay.id} className="trip-plan-view__day">
              <strong>{tripDay.label}</strong>
              {tripDay.placeIds.length === 0 ? (
                <p className="trip-day__empty">No stops planned</p>
              ) : (
                <ol>
                  {tripDay.placeIds.map((placeId) => {
                    const place = places.find((item) => item.id === placeId);
                    return place ? (
                      <li key={placeId}>
                        <span aria-hidden="true">{CATEGORY_META[place.category].icon}</span> {place.name}
                      </li>
                    ) : null;
                  })}
                </ol>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="trip-timeline">
          {days.map((tripDay) => (
            <div key={tripDay.id} className="trip-timeline__day">
              <div className="trip-timeline__day-label">{tripDay.label}</div>
              {tripDay.placeIds.length === 0 ? (
                <p className="trip-day__empty">No stops planned</p>
              ) : (
                tripDay.placeIds.map((placeId, index) => {
                  const place = places.find((item) => item.id === placeId);
                  if (!place) {
                    return null;
                  }

                  const isLast = index === tripDay.placeIds.length - 1;
                  return (
                    <div key={placeId} className="trip-timeline__item">
                      <div className="trip-timeline__marker">
                        <span className="trip-timeline__dot">{index + 1}</span>
                        {!isLast ? <span className="trip-timeline__line" /> : null}
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
                          />
                        ) : null}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('Could not read file.'));
      }
    };
    reader.onerror = () => reject(new Error('Could not read file.'));
    reader.readAsDataURL(file);
  });
}

function TimelineAttachment({
  attachment,
  onSave,
}: {
  attachment: PlaceAttachment | undefined;
  onSave: (attachment: PlaceAttachment | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState(attachment?.note ?? '');
  const [files, setFiles] = useState<AttachmentFile[]>(attachment?.files ?? []);

  useEffect(() => {
    setNote(attachment?.note ?? '');
    setFiles(attachment?.files ?? []);
  }, [attachment]);

  const hasContent = Boolean(attachment?.note?.trim() || attachment?.files?.length);

  async function handleFiles(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files;
    if (!selected || selected.length === 0) {
      return;
    }

    const added = await Promise.all(
      Array.from(selected).map(async (file) => ({
        id: crypto.randomUUID(),
        fileName: file.name,
        fileType: file.type,
        fileDataUrl: await readFileAsDataUrl(file),
      })),
    );

    setFiles((current) => [...current, ...added]);
    event.target.value = '';
  }

  function removeFile(id: string) {
    setFiles((current) => current.filter((file) => file.id !== id));
  }

  function save() {
    const trimmedNote = note.trim();
    if (!trimmedNote && files.length === 0) {
      onSave(null);
    } else {
      onSave({ note: trimmedNote, files });
    }
    setOpen(false);
  }

  function cancel() {
    setNote(attachment?.note ?? '');
    setFiles(attachment?.files ?? []);
    setOpen(false);
  }

  return (
    <div className="timeline-attachment">
      <button
        type="button"
        className={`timeline-attachment__toggle${hasContent ? ' timeline-attachment__toggle--active' : ''}`}
        onClick={() => setOpen((current) => !current)}
        aria-label={hasContent ? 'View private attachment' : 'Add private attachment'}
        title={hasContent ? 'Private attachment' : 'Add private attachment'}
      >
        📎
      </button>

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
                    href={file.fileDataUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="timeline-attachment__file-link"
                    title={`Open ${file.fileName}`}
                  >
                    {file.fileType.startsWith('image/') ? (
                      <img src={file.fileDataUrl} alt={file.fileName} className="timeline-attachment__thumb" />
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
            Attach image or PDF
            <input type="file" accept="image/*,application/pdf" multiple onChange={handleFiles} hidden />
          </label>
          <div className="timeline-attachment__actions">
            <button type="button" className="secondary-button" onClick={cancel}>
              Cancel
            </button>
            <button type="button" className="primary-button" onClick={save}>
              Save
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function SavedPlacesView({ places }: { places: Place[] }) {
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
                  <div key={place.id} className="place-list__item">
                    <span className="place-dot" />
                    <div>
                      <strong>{place.name}</strong>
                      <small>{place.address}</small>
                    </div>
                  </div>
                ))
              : null}
          </div>
        );
      })}
    </div>
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
}: {
  list: TripList;
  active: boolean;
  onSelect: () => void;
  onView: () => void;
}) {
  return (
    <div className={`account-list-sidebar__item${active ? ' account-list-sidebar__item--active' : ''}`}>
      <button className="account-list-sidebar__hit" type="button" onClick={onSelect}>
        <img src={list.coverImage} alt="" className="account-list-sidebar__thumb" />
        <div>
          <strong>{list.title}</strong>
          <span>{list.location}, {list.country}</span>
        </div>
      </button>
      <button className="icon-button" type="button" onClick={onView} aria-label={`View ${list.title} details`}>
        ⓘ
      </button>
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
    <div className={className} style={{ background: user?.accent ?? 'linear-gradient(135deg, #334155, #0f172a)' }}>
      {user?.avatar ?? '??'}
    </div>
  );
}

export default AppShell;
