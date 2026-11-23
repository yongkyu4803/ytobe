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

// Country inference evidence. YouTube's snippet.country is an optional owner setting (~20% of channels leave it
// empty), so the collectors also keep the owner's default language and a script hint from title + description.
export function languageCode(value) {
  return typeof value === 'string' && /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})?$/.test(value) ? value.toLowerCase() : null;
}

/** 'ko' when Hangul dominates, 'ja' when kana dominates, otherwise null (Latin or Han-only text is ambiguous). */
export function scriptHint(text) {
  if (typeof text !== 'string') return null;
  const hangul = (text.match(/[가-힣]/g) || []).length;
  const kana = (text.match(/[ぁ-ゟ゠-ヿ]/g) || []).length;
  if (hangul >= 2 && hangul >= kana) return 'ko';
  if (kana >= 2) return 'ja';
  return null;
}
