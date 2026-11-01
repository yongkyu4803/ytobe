// YouTube Data API client and value parsing shared by both collectors.
export function metric(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string' || !/^\d+$/.test(value) || BigInt(value) > 9223372036854775807n) {
    throw new CollectionError('invalid_metric', 'YouTube returned an invalid metric');
  }
  return value; // Preserve BIGINT precision through JSON/PostgREST.
}
export class CollectionError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
export function durationSeconds(value) {
  const m = /^P(?:(\d+)D)?T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(value || '');
  if (!m) return null;
  const seconds = Number(m[1] || 0)*86400 + Number(m[2] || 0)*3600 + Number(m[3] || 0)*60 + Number(m[4] || 0);
  if (!Number.isSafeInteger(seconds) || seconds > 2147483647) throw new CollectionError('invalid_duration', 'Invalid video duration');
  return seconds;
}
export function youtubeClient(apiKey, fetcher = fetch) {
  let requests = 0;
  return {
    get requests() { return requests; },
    async get(resource, params) {
      const url = new URL(`https://www.googleapis.com/youtube/v3/${resource}`);
      url.search = new URLSearchParams({...params, key: apiKey}).toString();
      requests++;
      let response;
      try { response = await fetcher(url, {signal: AbortSignal.timeout(12000)}); }
      catch { throw new CollectionError('network_timeout', 'YouTube request failed or timed out'); }
      let data;
      try { data = await response.json(); }
      catch { throw new CollectionError('invalid_response', 'YouTube returned an unreadable response'); }
      if (!response.ok) throw new CollectionError(data.error?.errors?.[0]?.reason || 'youtube_error', 'YouTube collection request was rejected');
      if (!Array.isArray(data.items)) throw new CollectionError('invalid_response', 'YouTube response is missing items');
      return data;
    }
  };
}
