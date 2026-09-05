-- EatMap schema + Row Level Security
-- Run once in the Supabase Dashboard's SQL Editor (Project -> SQL Editor -> New query).
-- Safe to re-run: every statement is guarded with "if not exists" / "or replace" / drop-then-create.

-- ============================================================================
-- Extensions
-- ============================================================================

create extension if not exists pgcrypto;

-- ============================================================================
-- profiles (1:1 with auth.users)
-- ============================================================================

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  name text not null,
  handle text not null unique,
  city text not null default '',
  bio text not null default '',
  avatar text not null default '',
  avatar_image_url text,
  accent text not null default 'linear-gradient(135deg, #f97316, #fb7185)',
  email text,
  created_at timestamptz not null default now()
);

-- Auto-create a profile row whenever someone signs up (Google or magic link).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  base_name text;
  base_handle text;
  accents text[] := array[
    'linear-gradient(135deg, #f97316, #fb7185)',
    'linear-gradient(135deg, #14b8a6, #0f766e)',
    'linear-gradient(135deg, #2563eb, #7c3aed)',
    'linear-gradient(135deg, #ea580c, #f43f5e)',
    'linear-gradient(135deg, #0ea5e9, #6366f1)'
  ];
begin
  base_name := coalesce(
    new.raw_user_meta_data ->> 'full_name',
    new.raw_user_meta_data ->> 'name',
    split_part(new.email, '@', 1),
    'Traveler'
  );

  base_handle := '@' || lower(regexp_replace(base_name, '[^a-zA-Z0-9]+', '', 'g'))
    || substr(replace(new.id::text, '-', ''), 1, 4);

  insert into public.profiles (id, name, handle, avatar, avatar_image_url, accent, email)
  values (
    new.id,
    base_name,
    base_handle,
    upper(left(base_name, 1)) || coalesce(upper(left(split_part(base_name, ' ', 2), 1)), ''),
    new.raw_user_meta_data ->> 'avatar_url',
    accents[1 + floor(random() * array_length(accents, 1))::int],
    new.email
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================================
-- lists / places / trip_days / trip_day_places
-- ============================================================================

create table if not exists public.lists (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  title text not null,
  cover_image_url text,
  location text not null default '',
  country text not null default '',
  vibe text not null default '',
  description text not null default '',
  season text not null default 'summer' check (season in ('spring', 'summer', 'autumn', 'winter')),
  budget text not null default 'mid-range' check (budget in ('low', 'mid-range', 'high', 'mixed')),
  created_at timestamptz not null default now()
);

create index if not exists lists_owner_id_idx on public.lists (owner_id);

create table if not exists public.places (
  id uuid primary key default gen_random_uuid(),
  list_id uuid not null references public.lists (id) on delete cascade,
  name text not null,
  address text not null default '',
  lat double precision not null,
  lng double precision not null,
  category text not null default 'other'
    check (category in ('food', 'attraction', 'hotel', 'cafe', 'shopping', 'nature', 'nightlife', 'other'))
);

create index if not exists places_list_id_idx on public.places (list_id);

create table if not exists public.trip_days (
  id uuid primary key default gen_random_uuid(),
  list_id uuid not null references public.lists (id) on delete cascade,
  label text not null,
  sort_order int not null default 0
);

create index if not exists trip_days_list_id_idx on public.trip_days (list_id);

create table if not exists public.trip_day_places (
  day_id uuid not null references public.trip_days (id) on delete cascade,
  place_id uuid not null unique references public.places (id) on delete cascade,
  sort_order int not null default 0,
  primary key (day_id, place_id)
);

-- ============================================================================
-- place_attachments / attachment_files (private, owner-only)
-- ============================================================================

create table if not exists public.place_attachments (
  id uuid primary key default gen_random_uuid(),
  place_id uuid not null unique references public.places (id) on delete cascade,
  note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists place_attachments_set_updated_at on public.place_attachments;
create trigger place_attachments_set_updated_at
  before update on public.place_attachments
  for each row execute function public.set_updated_at();

create table if not exists public.attachment_files (
  id uuid primary key default gen_random_uuid(),
  attachment_id uuid not null references public.place_attachments (id) on delete cascade,
  file_name text not null,
  file_type text not null default '',
  file_url text not null,
  created_at timestamptz not null default now()
);

create index if not exists attachment_files_attachment_id_idx on public.attachment_files (attachment_id);

-- ============================================================================
-- ratings / follows / saved_lists / likes / dm_messages
-- ============================================================================

create table if not exists public.ratings (
  id uuid primary key default gen_random_uuid(),
  list_id uuid not null references public.lists (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  score int not null check (score between 1 and 5),
  created_at timestamptz not null default now(),
  unique (list_id, user_id)
);

create index if not exists ratings_list_id_idx on public.ratings (list_id);

create table if not exists public.follows (
  follower_id uuid not null references public.profiles (id) on delete cascade,
  following_id uuid not null references public.profiles (id) on delete cascade,
  primary key (follower_id, following_id)
);

create index if not exists follows_following_id_idx on public.follows (following_id);

create table if not exists public.saved_lists (
  user_id uuid not null references public.profiles (id) on delete cascade,
  list_id uuid not null references public.lists (id) on delete cascade,
  primary key (user_id, list_id)
);

create table if not exists public.likes (
  user_id uuid not null references public.profiles (id) on delete cascade,
  list_id uuid not null references public.lists (id) on delete cascade,
  primary key (user_id, list_id)
);

create index if not exists likes_list_id_idx on public.likes (list_id);

create table if not exists public.dm_messages (
  id uuid primary key default gen_random_uuid(),
  from_id uuid not null references public.profiles (id) on delete cascade,
  to_id uuid not null references public.profiles (id) on delete cascade,
  text text not null,
  created_at timestamptz not null default now()
);

create index if not exists dm_messages_participants_idx on public.dm_messages (from_id, to_id);

-- ============================================================================
-- Row Level Security
-- ============================================================================

alter table public.profiles enable row level security;
alter table public.lists enable row level security;
alter table public.places enable row level security;
alter table public.trip_days enable row level security;
alter table public.trip_day_places enable row level security;
alter table public.place_attachments enable row level security;
alter table public.attachment_files enable row level security;
alter table public.ratings enable row level security;
alter table public.follows enable row level security;
alter table public.saved_lists enable row level security;
alter table public.likes enable row level security;
alter table public.dm_messages enable row level security;

-- profiles: readable by any signed-in user, editable only by yourself.
drop policy if exists "Profiles are readable by authenticated users" on public.profiles;
create policy "Profiles are readable by authenticated users" on public.profiles
  for select using (auth.role() = 'authenticated');

drop policy if exists "Users can update their own profile" on public.profiles;
create policy "Users can update their own profile" on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- lists: readable by any signed-in user, writable only by the owner.
drop policy if exists "Lists are readable by authenticated users" on public.lists;
create policy "Lists are readable by authenticated users" on public.lists
  for select using (auth.role() = 'authenticated');

drop policy if exists "Owners can insert lists" on public.lists;
create policy "Owners can insert lists" on public.lists
  for insert with check (auth.uid() = owner_id);

drop policy if exists "Owners can update their lists" on public.lists;
create policy "Owners can update their lists" on public.lists
  for update using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

drop policy if exists "Owners can delete their lists" on public.lists;
create policy "Owners can delete their lists" on public.lists
  for delete using (auth.uid() = owner_id);

-- places / trip_days / trip_day_places: readable by everyone signed in,
-- writable only where the parent list belongs to you.
drop policy if exists "Places are readable by authenticated users" on public.places;
create policy "Places are readable by authenticated users" on public.places
  for select using (auth.role() = 'authenticated');

drop policy if exists "Owners can manage their places" on public.places;
create policy "Owners can manage their places" on public.places
  for all
  using (exists (select 1 from public.lists where lists.id = places.list_id and lists.owner_id = auth.uid()))
  with check (exists (select 1 from public.lists where lists.id = places.list_id and lists.owner_id = auth.uid()));

drop policy if exists "Trip days are readable by authenticated users" on public.trip_days;
create policy "Trip days are readable by authenticated users" on public.trip_days
  for select using (auth.role() = 'authenticated');

drop policy if exists "Owners can manage their trip days" on public.trip_days;
create policy "Owners can manage their trip days" on public.trip_days
  for all
  using (exists (select 1 from public.lists where lists.id = trip_days.list_id and lists.owner_id = auth.uid()))
  with check (exists (select 1 from public.lists where lists.id = trip_days.list_id and lists.owner_id = auth.uid()));

drop policy if exists "Trip day places are readable by authenticated users" on public.trip_day_places;
create policy "Trip day places are readable by authenticated users" on public.trip_day_places
  for select using (auth.role() = 'authenticated');

drop policy if exists "Owners can manage their trip day places" on public.trip_day_places;
create policy "Owners can manage their trip day places" on public.trip_day_places
  for all
  using (exists (
    select 1 from public.trip_days
    join public.lists on lists.id = trip_days.list_id
    where trip_days.id = trip_day_places.day_id and lists.owner_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.trip_days
    join public.lists on lists.id = trip_days.list_id
    where trip_days.id = trip_day_places.day_id and lists.owner_id = auth.uid()
  ));

-- place_attachments / attachment_files: owner-only, full stop. Nobody else can
-- read these even via a direct query -- this is the real privacy boundary.
drop policy if exists "Only the list owner can see place attachments" on public.place_attachments;
create policy "Only the list owner can see place attachments" on public.place_attachments
  for all
  using (exists (
    select 1 from public.places
    join public.lists on lists.id = places.list_id
    where places.id = place_attachments.place_id and lists.owner_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.places
    join public.lists on lists.id = places.list_id
    where places.id = place_attachments.place_id and lists.owner_id = auth.uid()
  ));

drop policy if exists "Only the list owner can see attachment files" on public.attachment_files;
create policy "Only the list owner can see attachment files" on public.attachment_files
  for all
  using (exists (
    select 1 from public.place_attachments
    join public.places on places.id = place_attachments.place_id
    join public.lists on lists.id = places.list_id
    where place_attachments.id = attachment_files.attachment_id and lists.owner_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.place_attachments
    join public.places on places.id = place_attachments.place_id
    join public.lists on lists.id = places.list_id
    where place_attachments.id = attachment_files.attachment_id and lists.owner_id = auth.uid()
  ));

-- ratings: readable by everyone signed in, writable only as yourself.
drop policy if exists "Ratings are readable by authenticated users" on public.ratings;
create policy "Ratings are readable by authenticated users" on public.ratings
  for select using (auth.role() = 'authenticated');

drop policy if exists "Users can manage their own ratings" on public.ratings;
create policy "Users can manage their own ratings" on public.ratings
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- follows / saved_lists / likes: readable by everyone signed in,
-- writable only as yourself.
drop policy if exists "Follows are readable by authenticated users" on public.follows;
create policy "Follows are readable by authenticated users" on public.follows
  for select using (auth.role() = 'authenticated');

drop policy if exists "Users can manage their own follows" on public.follows;
create policy "Users can manage their own follows" on public.follows
  for all using (auth.uid() = follower_id) with check (auth.uid() = follower_id);

drop policy if exists "Saved lists are readable by authenticated users" on public.saved_lists;
create policy "Saved lists are readable by authenticated users" on public.saved_lists
  for select using (auth.role() = 'authenticated');

drop policy if exists "Users can manage their own saved lists" on public.saved_lists;
create policy "Users can manage their own saved lists" on public.saved_lists
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Likes are readable by authenticated users" on public.likes;
create policy "Likes are readable by authenticated users" on public.likes
  for select using (auth.role() = 'authenticated');

drop policy if exists "Users can manage their own likes" on public.likes;
create policy "Users can manage their own likes" on public.likes
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- dm_messages: only the two participants can read a thread.
drop policy if exists "Participants can read their DMs" on public.dm_messages;
create policy "Participants can read their DMs" on public.dm_messages
  for select using (auth.uid() = from_id or auth.uid() = to_id);

drop policy if exists "Users can send DMs as themselves" on public.dm_messages;
create policy "Users can send DMs as themselves" on public.dm_messages
  for insert with check (auth.uid() = from_id);

-- ============================================================================
-- Storage buckets
-- ============================================================================

insert into storage.buckets (id, name, public)
values ('public-media', 'public-media', true)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('attachments', 'attachments', false)
on conflict (id) do nothing;

drop policy if exists "Public media is readable by anyone" on storage.objects;
create policy "Public media is readable by anyone" on storage.objects
  for select using (bucket_id = 'public-media');

drop policy if exists "Authenticated users can upload public media" on storage.objects;
create policy "Authenticated users can upload public media" on storage.objects
  for insert with check (bucket_id = 'public-media' and auth.role() = 'authenticated');

drop policy if exists "Owners can update their public media" on storage.objects;
create policy "Owners can update their public media" on storage.objects
  for update using (bucket_id = 'public-media' and owner = auth.uid());

drop policy if exists "Owners can delete their public media" on storage.objects;
create policy "Owners can delete their public media" on storage.objects
  for delete using (bucket_id = 'public-media' and owner = auth.uid());

drop policy if exists "Owners can manage their attachment files" on storage.objects;
create policy "Owners can manage their attachment files" on storage.objects
  for all
  using (bucket_id = 'attachments' and owner = auth.uid())
  with check (bucket_id = 'attachments' and owner = auth.uid());
