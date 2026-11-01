// Keyword extraction shared by both collectors and offline tests. No IO.
const STOPWORDS = new Set([
  'shorts', 'short', 'shortsvideo', 'youtubeshorts', 'ytshorts', 'shortvideo', 'shortsfeed', 'shortsviral',
  'fyp', 'foryou', 'foryoupage', 'viral', 'trending', 'trend', 'youtube', 'subscribe', 'video', 'videos',
  'the', 'and', 'for', 'with', 'you', 'this', 'that', 'of', 'in', 'on', 'to', 'is', 'my', 'me', 'it',
  '쇼츠', '숏츠', '쇼쯔', '숏폼', '유튜브', '유튜브쇼츠', '구독', '좋아요', '구독과좋아요', '영상', '동영상',
  '진짜', '너무', '정말', '그냥', '이거', '그거', '저거', '이제', '지금', '오늘', '우리', '이번', '모든',
  '가장', '제일', '완전', '이렇게', '그렇게', '어떻게', '이런', '그런', '저런', '같은', '다른', '어떤', '모두', '다시',
  // Title templates ("~하는 이유", "~한 순간") that would otherwise top every ranking.
  '이유', '방법', '순간', '결과', '모음', '반응', '최초', 'vs', 'ep', 'part', 'feat',
]);
// Title words ending like a verb/adjective modifier (하는, 없는, 만든, 하던) carry no topic.
const MODIFIER_ENDING = /[는던든된]$/u;
// Unambiguous trailing particles only; short tokens are kept as-is to avoid cutting nouns like 고양이.
const PARTICLES = ['에서', '으로', '에게', '한테', '까지', '부터', '처럼', '보다', '은', '는', '을', '를', '의'];
const MAX_KEYWORDS = 30;
const MAX_LENGTH = 30;

export function normalizeKeyword(raw) {
  if (typeof raw !== 'string') return null;
  let value = raw.normalize('NFC').toLowerCase().replace(/^#+/, '').replace(/\s+/g, ' ').trim();
  // Laughter/crying runs (ㅋㅋㅋㅋ) collapse to one keyword.
  value = value.replace(/^([ㅋㅎㅠㅜ])\1+$/u, '$1$1');
  if (value.length < 2 || value.length > MAX_LENGTH) return null;
  if (/^\d+$/.test(value) || STOPWORDS.has(value) || STOPWORDS.has(value.replaceAll(' ', ''))) return null;
  if (!/[\p{L}]/u.test(value)) return null;
  return value;
}

function stripParticle(token) {
  if (!/^[\p{Script=Hangul}]+$/u.test(token)) return token;
  for (const particle of PARTICLES) {
    if (token.length - particle.length >= 2 && token.endsWith(particle)) return token.slice(0, -particle.length);
  }
  return token;
}

export function extractKeywords({ title = '', description = '', tags = [] } = {}) {
  const found = new Set();
  const add = value => { const k = normalizeKeyword(value); if (k && found.size < MAX_KEYWORDS) found.add(k); };
  const text = `${title || ''}\n${description || ''}`;
  for (const match of text.matchAll(/#([\p{L}\p{N}_]+)/gu)) add(match[1]);
  for (const tag of Array.isArray(tags) ? tags : []) add(tag);
  const titleWithoutTags = String(title || '').replace(/#[\p{L}\p{N}_]+/gu, ' ');
  for (const token of titleWithoutTags.split(/[^\p{L}\p{N}]+/u)) {
    if (!token || (/^[\p{Script=Hangul}]+$/u.test(token) && MODIFIER_ENDING.test(token))) continue;
    add(stripParticle(token));
  }
  return [...found];
}
