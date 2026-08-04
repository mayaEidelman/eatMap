# EatMap

EatMap is a map-first social trip planner, structured like Instagram: a Map home page, an Explore feed, DMs, and an Account page. Instead of photo posts, each "post" is a **trip list** — a named collection with a cover image and a set of real places pinned on Google Maps.

- **Map** — your own lists and the lists you've saved from other people, selectable in the sidebar and shown as pins on the map
- **Explore** — trip lists from the whole community, with a Save (bookmark) button on anyone else's list
- **DM** — message other travelers about routes
- **Account** — every list you've created, shown as a grid with cover images

## Setup

1. Copy `.env.example` to `.env.local`
2. Add a Google Maps API key (Maps JavaScript API + Places API enabled) — needed for the map and place search:
   `VITE_GOOGLE_MAPS_API_KEY=your-key-here`
3. Add a Google OAuth Client ID — needed for the "Continue with Google" sign-in button:
   `VITE_GOOGLE_CLIENT_ID=your-client-id-here`
   - Create one at [Google Cloud Console](https://console.cloud.google.com/) → APIs & Services → Credentials → Create Credentials → OAuth client ID → Web application
   - Under "Authorized JavaScript origins," add `http://localhost:5173` (and your real domain once deployed)
   - You don't need this to run the app — sign-in without Google (just a display name, stored locally) always works, and the app shows an inline message instead of breaking if this key is missing
4. Install and run:

```bash
npm install
npm run dev
```

## Signing in

- **Continue with Google** — real Google sign-in via Google Identity Services. First-time sign-in creates a local profile from your Google name/photo; signing in again logs back into that same profile. No account data is sent anywhere outside your browser.
- **Continue without Google** — type a display name to create (or return to) a local-only profile. No password, since there's no backend to check one against — everything is stored in this browser's `localStorage`.
- **Demo travelers** — jump straight into the app as one of the seeded demo accounts, useful for seeing existing lists, follows, and ratings.

## Included in this starter

- Google Maps with a pin per saved place, colored by list
- Google Places autocomplete for adding real places to a list
- List covers (paste a URL or upload an image)
- Save/bookmark other people's lists to your own map sidebar
- Social accounts with follow/unfollow, ratings with notes, and DMs
- Local persistence via `localStorage`
