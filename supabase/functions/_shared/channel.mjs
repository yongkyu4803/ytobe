// Channel field normalization shared by the favorite collector and the explore collector.
export function topicIds(categories) {
  if (!Array.isArray(categories)) return [];
  const ids = new Set();
  for (const url of categories) {
    if (typeof url !== 'string') continue;
    const match = /\/wiki\/([^/?#]+)$/.exec(url);
    if (!match) continue;
    let id;
    try { id = decodeURIComponent(match[1]); } catch { continue; }
    if (id.length > 0 && id.length <= 100) ids.add(id);
  }
  return [...ids].sort();
}

export function countryCode(value) {
  return typeof value === 'string' && /^[A-Za-z]{2}$/.test(value) ? value.toUpperCase() : null;
}

export function videoTags(tags) {
  if (!Array.isArray(tags)) return [];
  return tags.filter(t => typeof t === 'string' && t.length > 0 && t.length <= 100).slice(0, 50);
}
