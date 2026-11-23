# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev      # Start dev server (Turbopack) at http://localhost:3000
npm run build    # Production build
npm run start    # Serve production build
npm run lint     # eslint
npm run typecheck
npm test         # node --test tests/*.test.mjs (collector, explore, shorts rules)
npm run test:db  # DB integration tests in a throwaway PostgreSQL 15 container
```

## Architecture

Next.js **Pages Router** app (not App Router) — routes live in `pages/`, API routes in `pages/api/`.

### Data flow

- **YouTube Data API v3** is called only from server-side API routes (`pages/api/youtube.ts`, `pages/api/trending.ts`, `pages/api/channel-videos.ts`), never directly from the client, to keep `YOUTUBE_API_KEY` server-side. The routes share `lib/server/youtube.ts` (`ytGet` with quota-error mapping, `fetchVideos`, `enrichVideos` for channel stats + duration + `isShorts`, a per-instance TTL cache). `youtube` and `trending` require the personal session (`hasValidPersonalSession`) because `search.list` costs 100 of the 10,000 daily units.
- **Shorts rule** (`utils/shorts.ts`): Shorts may be up to 180s, and the API has no isShorts flag. Live routes request `part=player` with `maxWidth` and treat *vertical and ≤180s* as Shorts (square only ≤60s); DB-collected rows have no dimensions and fall back to duration ≤180s. Keep 180 in sync with `explore.mjs` and the migrations.
- **Trending categories** (`components/TrendingCategories.tsx` `TRENDING_CATEGORIES`): only categories that have a KR `chart=mostPopular`. 19, 27, 29 return notFound and 22 is nearly empty; `/api/trending` turns a missing chart into an empty `unavailable` result.
- **Derived numbers** (reviewed 2026-11-24):
  - Channel period deltas are differences of lifetime totals (the public API has no per-day views). `youtube_app_refresh_channel_deltas` nulls a window containing a >2% drop or a >5x/+100k jump (`view_anomaly_days`, `view_delta_suspect` → "비교 불가").
  - Keyword 7-day `video_count`/`channel_count` are distinct counts precomputed nightly in `youtube_app_keyword_window`; never sum daily counts across days.
  - The nightly `youtube-app-keywords` cron sets `statement_timeout=15min`/`work_mem=128MB`; each day's aggregation takes ~45s and grows with the pool. It refills any missing day of the past week.
  - Search/trending 성과지표 = views ÷ subscribers, 참여율 = (likes + comments) ÷ views × 100 (`utils/videoMetrics.ts`). Unknown values are `null`, never 0.
- **Supabase** (`lib/supabase.ts`) is the persistence layer for favorites, folders, and notifications. All reads/writes go through `utils/supabaseFavorites.ts`, which wraps three tables (see `migrations/create_tables.sql`): `youtube_app_favorite_folders`, `youtube_app_favorite_channels`, `youtube_app_video_notifications`. Table names are prefixed `youtube_app_` because the Supabase project is shared across multiple apps.

### Pages/components

- `pages/index.tsx` — search UI (uses `pages/api/youtube.ts`; date filters are rolling windows: 24h/7d/30d/365d).
- `pages/trending.tsx` — popular-chart videos by category (uses `pages/api/trending.ts`) with a Shorts/long-form split; category list lives in `components/TrendingCategories.tsx`.
- `pages/favorites.tsx` — favorite channels grouped by folder, drives `components/FolderManager.tsx` and per-channel notification checks via `pages/api/channel-videos.ts`.
- `components/FavoriteButton.tsx`, `components/NotificationDropdown.tsx` — read/write through `utils/supabaseFavorites.ts` directly (client components calling Supabase, not API routes).
- `components/SmartRecommendation.tsx` + `utils/smartRecommendation.ts` — time-of-day-based category recommendation engine (maps hour ranges to YouTube category IDs) that also calls the YouTube API.
- `pages/channels.tsx` (channel explore filters + `components/CategoryFilterModal.tsx`) and `pages/keywords/` (Shorts keyword ranking) read Supabase RPCs (`youtube_app_search_channels`, `youtube_app_topic_counts`, `youtube_app_keyword_ranking`, …) filled by the `youtube-app-explore` Edge Function. Shared collector code lives in `supabase/functions/_shared/`. See `docs/channel-explore-keywords-plan.md` and `docs/database-collection.md`.
- `components/UsageLimitNotice.tsx` — shows the YouTube free-quota constraints and today's collector usage; keep it on any screen whose data depends on the quota.
- `components/Layout.tsx` — shared page chrome; styling is Bootstrap 5 (`bootstrap` npm package + `styles/globals.css`/`styles/Home.module.css`), not Tailwind.

### Environment variables

- `YOUTUBE_API_KEY` — server-only, used in all `pages/api/*` routes.
- `SUPABASE_URL` / `SUPABASE_KEY` and `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_KEY` — `lib/supabase.ts` checks the `NEXT_PUBLIC_*` vars first, falling back to the non-prefixed ones.

**API key exposure (known and accepted):** the API routes once fell back to a hardcoded `YOUTUBE_API_KEY` literal. The fallback is gone from the source, but the key is still reachable in this public repo's git history. The owner has decided not to rotate it — the free tier carries no billing risk, and the practical downside is only that someone else could burn the 10,000 units/day. Don't re-raise this; just never reintroduce a hardcoded fallback.
