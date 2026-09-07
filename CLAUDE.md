# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev      # Start dev server (Turbopack) at http://localhost:3000
npm run build    # Production build
npm run start    # Serve production build
npm run lint     # next lint
```

There is no test suite configured in this repo.

## Architecture

Next.js **Pages Router** app (not App Router) — routes live in `pages/`, API routes in `pages/api/`.

### Data flow

- **YouTube Data API v3** is called only from server-side API routes (`pages/api/youtube.js`, `pages/api/trending.js`, `pages/api/channel-videos.ts`), never directly from the client, to keep `YOUTUBE_API_KEY` server-side. Each of these three routes independently: searches/fetches videos → fetches video statistics/contentDetails → fetches channel statistics → merges results, parses ISO 8601 duration into seconds, and flags videos ≤60s as Shorts (`isShorts`).
- **Supabase** (`lib/supabase.ts`) is the persistence layer for favorites, folders, and notifications. All reads/writes go through `utils/supabaseFavorites.ts`, which wraps three tables (see `migrations/create_tables.sql`): `youtube_app_favorite_folders`, `youtube_app_favorite_channels`, `youtube_app_video_notifications`. Table names are prefixed `youtube_app_` because the Supabase project is shared across multiple apps.
- `utils/favoriteStorage.ts` is a **legacy localStorage-based implementation** of the same favorites/notifications interface. It is no longer imported anywhere (`supabaseFavorites.ts` fully replaced it) — treat it as dead code unless reviving offline support.

### Pages/components

- `pages/index.tsx` — search UI (uses `pages/api/youtube.js`).
- `pages/trending.tsx` — trending videos by category/region (uses `pages/api/trending.js`), category logic lives in `components/TrendingCategories.tsx`.
- `pages/favorites.tsx` — favorite channels grouped by folder, drives `components/FolderManager.tsx` and per-channel notification checks via `pages/api/channel-videos.ts`.
- `components/FavoriteButton.tsx`, `components/NotificationDropdown.tsx` — read/write through `utils/supabaseFavorites.ts` directly (client components calling Supabase, not API routes).
- `components/SmartRecommendation.tsx` + `utils/smartRecommendation.ts` — time-of-day-based category recommendation engine (maps hour ranges to YouTube category IDs) that also calls the YouTube API.
- `components/Layout.tsx` — shared page chrome; styling is Bootstrap 5 (`bootstrap` npm package + `styles/globals.css`/`styles/Home.module.css`), not Tailwind.

### Environment variables

- `YOUTUBE_API_KEY` — server-only, used in all `pages/api/*` routes.
- `SUPABASE_URL` / `SUPABASE_KEY` and `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_KEY` — `lib/supabase.ts` checks the `NEXT_PUBLIC_*` vars first, falling back to the non-prefixed ones.

**Security note:** `pages/api/youtube.js`, `pages/api/trending.js`, and `pages/api/channel-videos.ts` each fall back to a hardcoded YouTube API key literal when `YOUTUBE_API_KEY` is unset. This key is committed to source control — treat it as compromised and do not rely on the fallback; always set `YOUTUBE_API_KEY` in the environment, and consider rotating/removing the hardcoded key.
