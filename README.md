# EatMap

EatMap is a map-first social trip planner, structured like Instagram: a Map home page, an Explore feed, DMs, and an Account page. Instead of photo posts, each "post" is a **trip list** — a named collection with a cover image and a set of real places pinned on Google Maps.

- **Map** — your own lists and the lists you've saved from other people, selectable in the sidebar and shown as pins on the map
- **Explore** — trip lists from the whole community, with a Save (bookmark) button on anyone else's list
- **DM** — message other travelers about routes
- **Account** — every list you've created, shown as a grid with cover images

Data lives in a real Postgres database (via [Supabase](https://supabase.com)), with Row Level Security enforcing that private per-place attachments (booking notes, tickets) are only ever readable by the list's owner — not just hidden in the UI.

## Setup

1. Copy `.env.example` to `.env.local`
2. Add a Google Maps API key (Maps JavaScript API + Places API enabled) — needed for the map and place search:
   `VITE_GOOGLE_MAPS_API_KEY=your-key-here`
3. Create a [Supabase](https://supabase.com) project (free tier, no card required) and add its API credentials from Settings → API:
   ```
   VITE_SUPABASE_URL=https://your-project-ref.supabase.co
   VITE_SUPABASE_ANON_KEY=your-anon-public-key
   ```
4. In the Supabase Dashboard's SQL Editor, paste and run `supabase/schema.sql` once — this creates every table, Row Level Security policy, and the two storage buckets (`public-media`, `attachments`).
5. Seed demo content (a handful of travelers with lists, follows, and ratings, so Explore isn't empty) by running the seed script once, using your project's **service role** key (Settings → API → `service_role` — never put this in `.env.local` or commit it, it bypasses Row Level Security):
   ```bash
   SUPABASE_URL=https://your-project-ref.supabase.co \
   SUPABASE_SERVICE_ROLE_KEY=your-service-role-key \
   node scripts/seed.mjs
   ```
6. To enable "Continue with Google": in Google Cloud Console, add `https://your-project-ref.supabase.co/auth/v1/callback` under Authorized redirect URIs on your OAuth client, then paste that Client ID + its Client Secret into Supabase Dashboard → Authentication → Providers → Google. Email magic-link sign-in works out of the box with no setup.
7. Install and run:

```bash
npm install
npm run dev
```

## Signing in

- **Continue with Google** — real OAuth via Supabase Auth. First-time sign-in creates a `profiles` row from your Google name/photo; signing in again returns to that same profile.
- **Email magic link** — enter your email and follow the sign-in link Supabase sends you. No password.

## Included in this starter

- Google Maps with a pin per saved place, colored by list
- Google Places autocomplete for adding real places to a list
- List covers and profile pictures (paste a URL or upload — stored in Supabase Storage)
- Save/bookmark other people's lists to your own map sidebar
- Social accounts with follow/unfollow, ratings with notes, and DMs — all backed by Postgres tables
- Private per-place attachments (notes, tickets/confirmations) visible only to the list owner, enforced by database Row Level Security rather than just client-side hiding
