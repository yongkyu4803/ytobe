// YouTube Shorts can be up to 3 minutes (since 2024-10). The Data API has no isShorts flag,
// so duration is the only signal. Keep in sync with MAX_SHORT_SECONDS in
// supabase/functions/youtube-app-explore/explore.mjs and the `<= 180` filters in migrations.
export const SHORTS_MAX_SECONDS = 180;

export function isShortsDuration(seconds: number | null | undefined): boolean | null {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return null;
  return seconds > 0 && seconds <= SHORTS_MAX_SECONDS;
}

/**
 * Best available Shorts signal: videos.list part=player (with maxWidth) returns embed dimensions
 * that follow the video's aspect ratio, so vertical + ≤180s is a Short. Without dimensions
 * (DB-collected rows) fall back to duration only, which also flags short horizontal clips.
 * Square videos count only up to 60s (old Shorts rule); longer ones are usually music videos.
 */
export function isShortsVideo(seconds: number | null | undefined, embedWidth?: unknown, embedHeight?: unknown): boolean | null {
  const byDuration = isShortsDuration(seconds);
  const w = Number(embedWidth), h = Number(embedHeight);
  if (!byDuration || !(w > 0) || !(h > 0)) return byDuration;
  return h > w || (h === w && (seconds as number) <= 60);
}

/** Parses a numeric API string; missing or hidden values become null instead of NaN. */
export function toCount(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}
