# EatMap

EatMap is a map-first social trip planner, structured like Instagram: a Map home page, an Explore feed, DMs, and an Account page. Instead of photo posts, each "post" is a **trip list** — a named collection with a cover image and a set of real places pinned on Google Maps.

- **Map** — your own lists and the lists you've saved from other people, selectable in the sidebar and shown as pins on the map
- **Explore** — trip lists from the whole community, with a Save (bookmark) button on anyone else's list
- **DM** — message other travelers about routes
- **Account** — every list you've created, shown as a grid with cover images

## Setup

You need a Google Maps API key (Maps JavaScript API + Places API enabled) for the map and place search to work.

1. Copy `.env.example` to `.env.local`
2. Add your key: `VITE_GOOGLE_MAPS_API_KEY=your-key-here`
3. Install and run:

```bash
npm install
npm run dev
```

## Included in this starter

- Google Maps with a pin per saved place, colored by list
- Google Places autocomplete for adding real places to a list
- List covers (paste a URL or upload an image)
- Save/bookmark other people's lists to your own map sidebar
- Social accounts with follow/unfollow, ratings with notes, and DMs
- Local persistence via `localStorage`
