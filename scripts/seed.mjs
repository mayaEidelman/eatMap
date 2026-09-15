// One-time seed script: populates demo travelers + their lists in Supabase.
//
// Run once, after the schema in supabase/schema.sql has been applied:
//
  // SUPABASE_URL=https://phojjngmkngdmdminske.supabase.co \
  // SUPABASE_SERVICE_ROLE_KEY=secret_key \
  // node scripts/seed.mjs
//
// The service role key is the "secret" key from Supabase Settings -> API --
// NEVER put it in .env.local or commit it. It bypasses Row Level Security,
// which is exactly why this script needs it (to create auth users and seed
// content across multiple "owners"), and exactly why it must never ship to
// the browser.

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function place(id, name, address, lat, lng, category) {
  return { id, name, address, lat, lng, category };
}

function day(id, label, placeIds) {
  return { id, label, placeIds };
}

const demoUsers = [
  {
    id: 'u-maya',
    name: 'Maya Cohen',
    handle: '@mayawanders',
    email: 'maya.demo@eatmap.seed',
    city: 'Tel Aviv',
    bio: 'Builds routes around food stalls, hidden beaches, and long train rides.',
    avatar: 'MC',
    accent: 'linear-gradient(135deg, #f97316, #fb7185)',
  },
  {
    id: 'u-sofia',
    name: 'Sofia Park',
    handle: '@sofiaslowtravel',
    email: 'sofia.demo@eatmap.seed',
    city: 'Seoul',
    bio: 'Slow city walks, museum lunches, and late-night dessert missions.',
    avatar: 'SP',
    accent: 'linear-gradient(135deg, #14b8a6, #0f766e)',
  },
  {
    id: 'u-noah',
    name: 'Noah Levin',
    handle: '@noahnotes',
    email: 'noah.demo@eatmap.seed',
    city: 'Lisbon',
    bio: 'Traces every trip by coffee stops, viewpoints, and ferry crossings.',
    avatar: 'NL',
    accent: 'linear-gradient(135deg, #2563eb, #7c3aed)',
  },
  {
    id: 'u-aya',
    name: 'Aya Idris',
    handle: '@ayaplaces',
    email: 'aya.demo@eatmap.seed',
    city: 'Marrakesh',
    bio: 'Curates color-rich routes built for markets, rooftops, and design hotels.',
    avatar: 'AI',
    accent: 'linear-gradient(135deg, #ea580c, #f43f5e)',
  },
];

const demoLists = [
  {
    id: 'list-kyoto',
    ownerId: 'u-sofia',
    title: 'Kyoto after rain',
    coverImage: 'https://images.unsplash.com/photo-1503899036084-c55cdd92da26?q=80&w=1200&auto=format&fit=crop',
    location: 'Kyoto',
    country: 'Japan',
    vibe: 'temples + tea houses',
    description: 'A compact route for peaceful mornings, old streets, and one perfect ramen stop.',
    places: [
      place('p-kyoto-1', 'Kiyomizu-dera', '1-294 Kiyomizu, Higashiyama Ward, Kyoto', 34.9949, 135.785, 'attraction'),
      place('p-kyoto-2', 'Ninenzaka', 'Ninenzaka, Higashiyama Ward, Kyoto', 34.9959, 135.7788, 'attraction'),
      place('p-kyoto-3', 'Nishiki Market', 'Nishikikoji-dori, Nakagyo Ward, Kyoto', 35.005, 135.7649, 'food'),
      place('p-kyoto-4', 'Togetsukyo Bridge', 'Saga Tenryuji, Ukyo Ward, Kyoto', 35.0094, 135.6779, 'nature'),
    ],
    days: [day('d-kyoto-1', 'Day 1', ['p-kyoto-1', 'p-kyoto-2']), day('d-kyoto-2', 'Day 2', ['p-kyoto-3', 'p-kyoto-4'])],
    season: 'spring',
    budget: 'mid-range',
    createdAt: '2026-06-02T08:00:00.000Z',
  },
  {
    id: 'list-mexico',
    ownerId: 'u-maya',
    title: 'Mexico City taqueria loop',
    coverImage: 'https://images.unsplash.com/photo-1518105779142-d975f22f1b0a?q=80&w=1200&auto=format&fit=crop',
    location: 'Mexico City',
    country: 'Mexico',
    vibe: 'tacos + design hotels',
    description: 'A social-night route with museums by day and neighborhood taquerias at dusk.',
    places: [
      place('p-mex-1', 'Roma Norte', 'Roma Norte, Mexico City', 19.42, -99.1637, 'attraction'),
      place('p-mex-2', 'Condesa', 'Condesa, Mexico City', 19.4108, -99.1706, 'attraction'),
      place('p-mex-3', 'Mercado de Coyoacán', 'Ignacio Allende s/n, Coyoacán, Mexico City', 19.355, -99.1625, 'food'),
      place('p-mex-4', 'Museo Jumex', 'Blvd. Miguel de Cervantes Saavedra, Mexico City', 19.4392, -99.2016, 'attraction'),
    ],
    days: [day('d-mex-1', 'Day 1', ['p-mex-1', 'p-mex-4', 'p-mex-3'])],
    season: 'autumn',
    budget: 'mixed',
    createdAt: '2026-06-10T08:00:00.000Z',
    placeAttachments: {
      'p-mex-4': { note: 'Museo Jumex tickets booked for 11am, confirmation #JX-88213.', files: [] },
    },
  },
  {
    id: 'list-patagonia',
    ownerId: 'u-noah',
    title: 'Patagonia road reset',
    coverImage: 'https://images.unsplash.com/photo-1531065208531-4036c0dba3ca?q=80&w=1200&auto=format&fit=crop',
    location: 'El Calafate',
    country: 'Argentina',
    vibe: 'glaciers + long drives',
    description: 'A wide-open trip list for lake viewpoints, rental cars, and windproof layers.',
    places: [
      place('p-pat-1', 'Perito Moreno Glacier', 'Los Glaciares National Park, Santa Cruz', -50.4967, -73.0501, 'nature'),
      place('p-pat-2', 'Lago Argentino', 'Lago Argentino, Santa Cruz', -50.38, -72.38, 'nature'),
      place('p-pat-3', 'Ruta 40 overlook', 'Ruta Nacional 40, Santa Cruz', -49.95, -71.55, 'nature'),
      place('p-pat-4', 'Estancia dinners', 'El Calafate, Santa Cruz', -50.25, -72.1, 'food'),
    ],
    days: [],
    season: 'summer',
    budget: 'high',
    createdAt: '2026-06-15T08:00:00.000Z',
  },
  {
    id: 'list-lisbon',
    ownerId: 'u-aya',
    title: 'Lisbon tram and rooftop map',
    coverImage: 'https://images.unsplash.com/photo-1585208798174-6cedd86e019a?q=80&w=1200&auto=format&fit=crop',
    location: 'Lisbon',
    country: 'Portugal',
    vibe: 'sunsets + petiscos',
    description: 'Built for tiled streets, ferry sunsets, and a rooftop dinner at golden hour.',
    places: [
      place('p-lis-1', 'Alfama', 'Alfama, Lisbon', 38.7139, -9.1301, 'attraction'),
      place('p-lis-2', 'Miradouro de Santa Catarina', 'R. de Santa Catarina, Lisbon', 38.7095, -9.1477, 'nature'),
      place('p-lis-3', 'LX Factory', 'R. Rodrigues de Faria 103, Lisbon', 38.7028, -9.1778, 'shopping'),
      place('p-lis-4', 'Cais do Sodré', 'Cais do Sodré, Lisbon', 38.7061, -9.1456, 'nightlife'),
    ],
    days: [day('d-lis-1', 'Day 1', ['p-lis-1', 'p-lis-2']), day('d-lis-2', 'Day 2', ['p-lis-3', 'p-lis-4'])],
    season: 'summer',
    budget: 'mid-range',
    createdAt: '2026-06-20T08:00:00.000Z',
  },
  {
    id: 'list-iceland',
    ownerId: 'u-sofia',
    title: 'Iceland ring road snippets',
    coverImage: 'https://images.unsplash.com/photo-1504829857797-ddff29c27927?q=80&w=1200&auto=format&fit=crop',
    location: 'Reykjavik',
    country: 'Iceland',
    vibe: 'waterfalls + hot springs',
    description: 'A flexible route of stops for short daylight windows and long horizon views.',
    places: [
      place('p-ice-1', 'Þingvellir National Park', 'Þingvellir, Iceland', 64.2559, -21.1295, 'nature'),
      place('p-ice-2', 'Blue Lagoon', 'Norðurljósavegur 9, Grindavík', 63.8804, -22.4495, 'nature'),
      place('p-ice-3', 'Reynisfjara black sand beach', 'Reynisfjara, Iceland', 63.4052, -19.0446, 'nature'),
      place('p-ice-4', 'Vík guesthouse dinners', 'Vík í Mýrdal, Iceland', 63.4186, -19.006, 'food'),
    ],
    days: [],
    season: 'winter',
    budget: 'high',
    createdAt: '2026-06-25T08:00:00.000Z',
  },
];

const demoRatings = [
  { listId: 'list-kyoto', userId: 'u-maya', score: 5 },
  { listId: 'list-mexico', userId: 'u-sofia', score: 4 },
  { listId: 'list-lisbon', userId: 'u-maya', score: 5 },
];

const demoFollows = [
  { followerId: 'u-maya', followingId: 'u-sofia' },
  { followerId: 'u-maya', followingId: 'u-noah' },
  { followerId: 'u-sofia', followingId: 'u-aya' },
];

const demoSavedLists = [
  { userId: 'u-maya', listId: 'list-kyoto' },
  { userId: 'u-maya', listId: 'list-lisbon' },
];

const demoLikes = [
  { userId: 'u-maya', listId: 'list-kyoto' },
  { userId: 'u-sofia', listId: 'list-mexico' },
  { userId: 'u-noah', listId: 'list-mexico' },
  { userId: 'u-aya', listId: 'list-lisbon' },
  { userId: 'u-maya', listId: 'list-lisbon' },
];

const demoMessages = [
  { fromId: 'u-sofia', toId: 'u-noah', text: 'Send me the Kyoto route. I want to save that list.', createdAt: '2026-07-25T12:20:00.000Z' },
  { fromId: 'u-noah', toId: 'u-sofia', text: 'Already pinned. Check the map and the tea house notes.', createdAt: '2026-07-25T12:24:00.000Z' },
  { fromId: 'u-maya', toId: 'u-aya', text: 'I want to save your Lisbon rooftop list next.', createdAt: '2026-07-26T09:10:00.000Z' },
];

const demoExpenseGroups = [
  {
    id: 'group-lisbon',
    listId: 'list-lisbon',
    ownerId: 'u-aya',
    name: 'Lisbon trip expenses',
    baseCurrency: 'EUR',
    members: [
      { userId: 'u-aya', status: 'accepted' },
      { userId: 'u-maya', status: 'accepted' },
      { userId: 'u-noah', status: 'invited' },
    ],
  },
];

const demoExpenses = [
  {
    groupId: 'group-lisbon',
    paidBy: 'u-aya',
    description: 'Airbnb in Alfama',
    category: 'lodging',
    amount: 320,
    currency: 'EUR',
    exchangeRate: 1,
    convertedAmount: 320,
    spentAt: '2026-07-10',
    shares: [
      { userId: 'u-aya', amount: 160 },
      { userId: 'u-maya', amount: 160 },
    ],
  },
  {
    groupId: 'group-lisbon',
    paidBy: 'u-maya',
    description: 'Tram tickets + pastel de nata crawl',
    category: 'food',
    amount: 40,
    currency: 'EUR',
    exchangeRate: 1,
    convertedAmount: 40,
    spentAt: '2026-07-11',
    shares: [
      { userId: 'u-aya', amount: 25 },
      { userId: 'u-maya', amount: 15 },
    ],
  },
];

async function getOrCreateDemoUser(user) {
  const { data: created, error: createError } = await supabase.auth.admin.createUser({
    email: user.email,
    email_confirm: true,
    user_metadata: { full_name: user.name },
  });

  if (!createError) {
    return created.user.id;
  }

  // Already exists from a previous run of this script -- look it up instead.
  const { data: list, error: listError } = await supabase.auth.admin.listUsers({ perPage: 200 });
  if (listError) {
    throw listError;
  }

  const existing = list.users.find((candidate) => candidate.email === user.email);
  if (!existing) {
    throw createError;
  }

  return existing.id;
}

async function run() {
  const idMap = {};

  for (const user of demoUsers) {
    const authId = await getOrCreateDemoUser(user);
    idMap[user.id] = authId;

    const { error } = await supabase
      .from('profiles')
      .update({
        name: user.name,
        handle: user.handle,
        city: user.city,
        bio: user.bio,
        avatar: user.avatar,
        accent: user.accent,
      })
      .eq('id', authId);

    if (error) throw error;
    console.log(`Seeded profile: ${user.name}`);
  }

  for (const list of demoLists) {
    const { data: insertedList, error: listError } = await supabase
      .from('lists')
      .insert({
        owner_id: idMap[list.ownerId],
        title: list.title,
        cover_image_url: list.coverImage,
        location: list.location,
        country: list.country,
        vibe: list.vibe,
        description: list.description,
        season: list.season,
        budget: list.budget,
        created_at: list.createdAt,
      })
      .select('id')
      .single();

    if (listError) throw listError;
    const listId = insertedList.id;

    const placeIdMap = {};
    for (const p of list.places) {
      const { data: insertedPlace, error: placeError } = await supabase
        .from('places')
        .insert({ list_id: listId, name: p.name, address: p.address, lat: p.lat, lng: p.lng, category: p.category })
        .select('id')
        .single();

      if (placeError) throw placeError;
      placeIdMap[p.id] = insertedPlace.id;
    }

    for (const [index, d] of list.days.entries()) {
      const { data: insertedDay, error: dayError } = await supabase
        .from('trip_days')
        .insert({ list_id: listId, label: d.label, sort_order: index })
        .select('id')
        .single();

      if (dayError) throw dayError;

      for (const [placeIndex, placeId] of d.placeIds.entries()) {
        const { error: dayPlaceError } = await supabase
          .from('trip_day_places')
          .insert({ day_id: insertedDay.id, place_id: placeIdMap[placeId], sort_order: placeIndex });

        if (dayPlaceError) throw dayPlaceError;
      }
    }

    if (list.placeAttachments) {
      for (const [placeId, attachment] of Object.entries(list.placeAttachments)) {
        const { error: attachmentError } = await supabase
          .from('place_attachments')
          .insert({ place_id: placeIdMap[placeId], note: attachment.note });

        if (attachmentError) throw attachmentError;
      }
    }

    console.log(`Seeded list: ${list.title}`);
  }

  const { data: listRows, error: listLookupError } = await supabase.from('lists').select('id, title');
  if (listLookupError) throw listLookupError;
  const listIdByTitle = Object.fromEntries(listRows.map((row) => [row.title, row.id]));
  const listIdByOldId = Object.fromEntries(demoLists.map((list) => [list.id, listIdByTitle[list.title]]));

  for (const rating of demoRatings) {
    const { error } = await supabase
      .from('ratings')
      .upsert({ list_id: listIdByOldId[rating.listId], user_id: idMap[rating.userId], score: rating.score });
    if (error) throw error;
  }

  for (const follow of demoFollows) {
    const { error } = await supabase
      .from('follows')
      .upsert({ follower_id: idMap[follow.followerId], following_id: idMap[follow.followingId] });
    if (error) throw error;
  }

  for (const saved of demoSavedLists) {
    const { error } = await supabase
      .from('saved_lists')
      .upsert({ user_id: idMap[saved.userId], list_id: listIdByOldId[saved.listId] });
    if (error) throw error;
  }

  for (const like of demoLikes) {
    const { error } = await supabase.from('likes').upsert({ user_id: idMap[like.userId], list_id: listIdByOldId[like.listId] });
    if (error) throw error;
  }

  for (const message of demoMessages) {
    const { error } = await supabase.from('dm_messages').insert({
      from_id: idMap[message.fromId],
      to_id: idMap[message.toId],
      text: message.text,
      created_at: message.createdAt,
    });
    if (error) throw error;
  }

  const expenseGroupIdByOldId = {};
  for (const group of demoExpenseGroups) {
    const { data: insertedGroup, error: groupError } = await supabase
      .from('expense_groups')
      .insert({
        list_id: listIdByOldId[group.listId],
        owner_id: idMap[group.ownerId],
        name: group.name,
        base_currency: group.baseCurrency,
      })
      .select('id')
      .single();
    if (groupError) throw groupError;
    expenseGroupIdByOldId[group.id] = insertedGroup.id;

    for (const member of group.members) {
      const { error: memberError } = await supabase.from('expense_group_members').insert({
        group_id: insertedGroup.id,
        user_id: idMap[member.userId],
        status: member.status,
        invited_by: idMap[group.ownerId],
        responded_at: member.status === 'accepted' ? new Date().toISOString() : null,
      });
      if (memberError) throw memberError;
    }

    console.log(`Seeded expense group: ${group.name}`);
  }

  for (const expense of demoExpenses) {
    const { data: insertedExpense, error: expenseError } = await supabase
      .from('expenses')
      .insert({
        group_id: expenseGroupIdByOldId[expense.groupId],
        paid_by: idMap[expense.paidBy],
        description: expense.description,
        category: expense.category,
        amount: expense.amount,
        currency: expense.currency,
        exchange_rate: expense.exchangeRate,
        converted_amount: expense.convertedAmount,
        spent_at: expense.spentAt,
      })
      .select('id')
      .single();
    if (expenseError) throw expenseError;

    const { error: sharesError } = await supabase
      .from('expense_shares')
      .insert(expense.shares.map((share) => ({ expense_id: insertedExpense.id, user_id: idMap[share.userId], amount: share.amount })));
    if (sharesError) throw sharesError;
  }

  console.log('Seeded demo expenses.');
  console.log('Seed complete.');
}

run().catch((error) => {
  console.error('Seed failed:', error);
  process.exit(1);
});
