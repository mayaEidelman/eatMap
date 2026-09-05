import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { ImportPlacesModal } from './components/ImportPlacesModal';
import { MapPanel } from './components/MapPanel';
import { PlaceAutocomplete } from './components/PlaceAutocomplete';
import { CATEGORY_META, groupPlacesByCategory } from './lib/categories';
import { useAppActions } from './hooks/useAppActions';
import { useAppData } from './hooks/useAppData';
import { useAuthSession } from './hooks/useAuthSession';
import { useMessages } from './hooks/useMessages';
import { signInWithGoogle, signInWithMagicLink, signOut as signOutOfSupabase } from './lib/supabaseAuth';
import { isSupabaseConfigured, supabaseConfigError } from './lib/supabaseClient';
import { uploadAttachmentFile, uploadPublicMedia } from './lib/storage';
import { emptyDraft } from './mock';
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
  User,
} from './types';

const DEFAULT_COVER = 'https://images.unsplash.com/photo-1502920917128-1aa500764cbd?q=80&w=1200&auto=format&fit=crop';

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

const EMPTY_PROFILE_DRAFT: ProfileDraft = { name: '', handle: '', city: '', bio: '', avatar: '', avatarImage: '' };

function AppShell() {
  const { currentUserId, isAuthenticated, isLoading: authLoading } = useAuthSession();
  const { data, isLoading: dataLoading, error: dataError } = useAppData(currentUserId);
  const actions = useAppActions(currentUserId);
  const { messages: dmMessages, sendMessage: sendDmMessage } = useMessages(currentUserId);

  const [magicLinkEmail, setMagicLinkEmail] = useState('');
  const [magicLinkSent, setMagicLinkSent] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const [page, setPage] = useState<PageMode>('home');
  const [sidebarOpen, setSidebarOpen] = useState(true);
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
  const [profileDraft, setProfileDraft] = useState<ProfileDraft>(EMPTY_PROFILE_DRAFT);
  const [importPlacesOpen, setImportPlacesOpen] = useState(false);

  const currentUser = data ? data.users.find((user) => user.id === data.currentUserId) : undefined;
  const selectedList = data ? data.lists.find((list) => list.id === selectedListId) ?? data.lists[0] : undefined;

  useEffect(() => {
    if (data && !selectedList && data.lists[0]) {
      setSelectedListId(data.lists[0].id);
    }
  }, [data, selectedList]);

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

  const exploreLists = useMemo(() => (data ? filterByQuery(data.lists, search) : []), [data, search]);

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

  const peopleToFollow = useMemo(() => (data ? data.users.filter((user) => user.id !== data.currentUserId) : []), [data]);

  const listDetail = data ? data.lists.find((list) => list.id === listDetailId) ?? null : null;
  const listDetailOwner = data && listDetail ? data.users.find((user) => user.id === listDetail.ownerId) : undefined;

  const viewedProfile = data ? data.users.find((user) => user.id === viewedProfileId) ?? null : null;
  const viewedProfileStats = data && viewedProfile ? getUserStats(viewedProfile.id, data) : null;
  const viewedProfileLists = data && viewedProfile ? data.lists.filter((list) => list.ownerId === viewedProfile.id) : [];

  const peopleListUsers =
    data && peopleListOpen
      ? peopleListOpen.mode === 'followers'
        ? getFollowerUsers(peopleListOpen.userId, data)
        : getFollowingUsers(peopleListOpen.userId, data)
      : [];

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
    setDraft(emptyDraft);
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

    if (!draft.title.trim() || !draft.location.trim() || draft.places.length === 0) {
      return;
    }

    const editingListId = listFormMode === 'edit' ? selectedList?.id : undefined;
    const preparedDraft: DraftList = { ...draft, coverImage: draft.coverImage.trim() || DEFAULT_COVER };
    const resultId = await actions.saveList(listFormMode, editingListId, preparedDraft);

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
              currentUserId={data.currentUserId}
              onSaveAttachment={(placeId, attachment) => updatePlaceAttachment(placeId, attachment)}
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
  currentUserId,
  onSaveAttachment,
}: {
  days: TripDay[];
  places: Place[];
  isOwner: boolean;
  attachments: Record<string, PlaceAttachment> | null;
  currentUserId: string;
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
                            currentUserId={currentUserId}
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

function TimelineAttachment({
  attachment,
  onSave,
  currentUserId,
}: {
  attachment: PlaceAttachment | undefined;
  onSave: (attachment: PlaceAttachment | null) => void;
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

  useEffect(() => {
    setNote(attachment?.note ?? '');
    setFiles(attachment?.files ?? []);
    setPreviewUrls({});
  }, [attachment]);

  const hasContent = Boolean(attachment?.note?.trim() || attachment?.files?.length);

  async function handleFiles(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files;
    event.target.value = '';
    if (!selected || selected.length === 0) {
      return;
    }

    setUploading(true);
    try {
      const added: AttachmentFile[] = [];
      const newPreviews: Record<string, string> = {};

      for (const file of Array.from(selected)) {
        const { path, previewUrl } = await uploadAttachmentFile(currentUserId, file);
        const id = crypto.randomUUID();
        added.push({ id, fileName: file.name, fileType: file.type, fileDataUrl: path });
        newPreviews[id] = previewUrl;
      }

      setFiles((current) => [...current, ...added]);
      setPreviewUrls((current) => ({ ...current, ...newPreviews }));
    } finally {
      setUploading(false);
    }
  }

  function previewFor(file: AttachmentFile) {
    return previewUrls[file.id] ?? file.fileDataUrl;
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
