import { useCallback, useEffect, useMemo, useState } from 'react';
import Head from 'next/head';
import Layout from '../components/Layout';
import GqaiIcon from '../components/GqaiIcon';
import FavoriteButton from '../components/FavoriteButton';
import UsageLimitNotice from '../components/UsageLimitNotice';
import CategoryFilterModal, { type TopicCount } from '../components/CategoryFilterModal';
import { supabase } from '../lib/supabase';
import { formatMetric } from '../utils/metrics';
import { COUNTRY_OPTIONS, topicLabel } from '../utils/topics';

type Period = '' | '1d' | '2d' | '7d' | '30d';
type Sort = 'views' | 'subscribers';

interface ChannelRow {
  channel_id: string; title: string; thumbnail_url: string | null; country: string | null; topic_ids: string[];
  subscriber_count: string | number | null; hidden_subscriber: boolean | null; video_count: string | number | null;
  view_count: string | number | null; view_delta: string | number | null; views_stale: boolean; deltas_at: string | null;
  is_favorite: boolean; total_count: string | number;
}

const PERIODS: { value: Period; label: string }[] = [
  { value: '', label: '없음' }, { value: '1d', label: '1일' }, { value: '2d', label: '48시간' },
  { value: '7d', label: '7일' }, { value: '30d', label: '30일' },
];
const PAGE = 50;

function parseCount(value: string) {
  const digits = value.replace(/[^\d]/g, '');
  return digits ? Number(digits) : null;
}

function deltaText(row: ChannelRow, period: Period) {
  if (!period) return null;
  if (period === '1d' && row.views_stale) return { text: '갱신 안 됨', tone: 'muted' };
  if (row.view_delta === null || row.view_delta === undefined) return { text: '이력 수집 중', tone: 'muted' };
  const n = Number(row.view_delta);
  if (n < 0) return { text: `-${formatMetric(String(Math.abs(n)))}`, tone: 'down' };
  return { text: `+${formatMetric(String(n))}`, tone: 'up' };
}

export default function ChannelExplorePage() {
  const [period, setPeriod] = useState<Period>('');
  const [sort, setSort] = useState<Sort>('views');
  const [subMin, setSubMin] = useState(''); const [subMax, setSubMax] = useState('');
  const [videoMin, setVideoMin] = useState(''); const [videoMax, setVideoMax] = useState('');
  const [countries, setCountries] = useState<string[]>([]);
  const [topics, setTopics] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState({ subMin: '', subMax: '', videoMin: '', videoMax: '', query: '' });
  const [rows, setRows] = useState<ChannelRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [topicCounts, setTopicCounts] = useState<TopicCount[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced({ subMin, subMax, videoMin, videoMax, query: query.trim() }), 400);
    return () => clearTimeout(timer);
  }, [subMin, subMax, videoMin, videoMax, query]);

  useEffect(() => {
    void supabase.rpc('youtube_app_topic_counts').then(({ data }) => setTopicCounts((data || []) as TopicCount[]));
  }, []);

  const params = useMemo(() => ({
    p_period: period || null, p_sort: sort,
    p_sub_min: parseCount(debounced.subMin), p_sub_max: parseCount(debounced.subMax),
    p_video_min: parseCount(debounced.videoMin), p_video_max: parseCount(debounced.videoMax),
    p_countries: countries.length ? countries : null, p_topics: topics.length ? topics : null,
    p_query: debounced.query || null,
  }), [period, sort, debounced, countries, topics]);

  const load = useCallback(async (offset: number) => {
    const { data, error: rpcError } = await supabase.rpc('youtube_app_search_channels', { ...params, p_limit: PAGE, p_offset: offset });
    if (rpcError) throw rpcError;
    return (data || []) as ChannelRow[];
  }, [params]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError('');
    load(0).then(result => {
      if (cancelled) return;
      setRows(result); setTotal(result.length ? Number(result[0].total_count) : 0);
    }).catch(() => { if (!cancelled) { setRows([]); setTotal(0); setError('채널을 불러오지 못했습니다. 잠시 후 다시 시도하세요.'); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [load]);

  const loadMore = async () => {
    setLoadingMore(true);
    try { const more = await load(rows.length); setRows(list => [...list, ...more]); }
    catch { setError('추가 결과를 불러오지 못했습니다.'); }
    finally { setLoadingMore(false); }
  };

  const toggleCountry = (value: string) => setCountries(list => list.includes(value) ? list.filter(x => x !== value) : [...list, value]);
  const reset = () => { setPeriod(''); setSort('views'); setSubMin(''); setSubMax(''); setVideoMin(''); setVideoMax(''); setCountries([]); setTopics([]); setQuery(''); };
  const periodLabel = PERIODS.find(p => p.value === period)?.label;
  const closeModal = useCallback(() => setModalOpen(false), []);
  const activeFilters = [period, subMin || subMax, videoMin || videoMax, countries.length, topics.length].filter(Boolean).length;

  return (
    <Layout>
      <Head>
        <title>채널 탐색 - YouTube Analytics</title>
        <meta name="description" content="수집한 채널을 조회수 증감, 구독자, 국가, 카테고리로 찾습니다" />
      </Head>

      <div className="page-heading explore-head">
        <h2 className="fw-bold text-primary">채널 탐색</h2>
        <p className="text-muted">수집한 채널을 조회수 증감, 구독자, 영상 수, 국가, 카테고리로 찾습니다.</p>
        <UsageLimitNotice variant="inline" scope="channels" />
      </div>

      <div className="explore-layout">
        <button type="button" className="filters-toggle btn btn-outline-secondary" aria-expanded={filtersOpen} aria-controls="channel-filters"
          onClick={() => setFiltersOpen(v => !v)}>
          {filtersOpen ? '필터 닫기' : `필터${activeFilters ? ` (${activeFilters}개 적용 중)` : ''}`}
        </button>
        <aside id="channel-filters" className={`filters ${filtersOpen ? 'open' : ''}`} aria-label="채널 필터">
          <section>
            <h3>조회수 증감 기준</h3>
            <p className="stale-note">YouTube API 오류로 간혹 오늘 총 조회수가 어제와 같이 갱신되지 않은 상태로 전송됩니다. 이 경우 48시간 이상의 기준을 권장합니다.</p>
            <div className="choice-row">
              {PERIODS.map(p => (
                <button key={p.value} type="button" className={`choice ${period === p.value ? 'on' : ''}`} aria-pressed={period === p.value} onClick={() => setPeriod(p.value)}>{p.label}</button>
              ))}
            </div>
          </section>
          <section>
            <h3>정렬 기준</h3>
            <div className="choice-row two">
              <button type="button" className={`choice ${!period && sort === 'views' ? 'on' : ''}`} aria-pressed={!period && sort === 'views'} disabled={!!period} onClick={() => setSort('views')}>총 조회수</button>
              <button type="button" className={`choice ${!period && sort === 'subscribers' ? 'on' : ''}`} aria-pressed={!period && sort === 'subscribers'} disabled={!!period} onClick={() => setSort('subscribers')}>구독자</button>
            </div>
            <p className="hint">* 기간 선택 시 자동으로 조회수 증감 기준 정렬됩니다</p>
          </section>
          <section>
            <h3>구독자 범위</h3>
            <div className="range">
              <input inputMode="numeric" placeholder="최소" aria-label="최소 구독자" value={subMin} onChange={e => setSubMin(e.target.value)} />
              <span>~</span>
              <input inputMode="numeric" placeholder="최대" aria-label="최대 구독자" value={subMax} onChange={e => setSubMax(e.target.value)} />
            </div>
          </section>
          <section>
            <h3>영상 수 범위</h3>
            <div className="range">
              <input inputMode="numeric" placeholder="최소" aria-label="최소 영상 수" value={videoMin} onChange={e => setVideoMin(e.target.value)} />
              <span>~</span>
              <input inputMode="numeric" placeholder="최대" aria-label="최대 영상 수" value={videoMax} onChange={e => setVideoMax(e.target.value)} />
            </div>
          </section>
          <section>
            <h3>국가</h3>
            <div className="choice-row">
              {COUNTRY_OPTIONS.map(c => (
                <button key={c.value} type="button" className={`choice ${countries.includes(c.value) ? 'on' : ''}`} aria-pressed={countries.includes(c.value)} onClick={() => toggleCountry(c.value)}>
                  {c.code ? <small>{c.code}</small> : <GqaiIcon name="status-offline" size={14} />} {c.label}
                </button>
              ))}
            </div>
          </section>
          <section>
            <h3>카테고리</h3>
            <button type="button" className="choice wide" onClick={() => setModalOpen(true)}>
              {topics.length ? `${topics.slice(0, 2).map(topicLabel).join(', ')}${topics.length > 2 ? ` 외 ${topics.length - 2}개` : ''}` : '전체 카테고리'}
            </button>
          </section>
          <button type="button" className="btn btn-outline-secondary w-100" onClick={reset}>필터 초기화</button>
        </aside>

        <section className="results" aria-live="polite" aria-busy={loading}>
          <div className="results-head">
            <label className="search">
              <GqaiIcon name="action-search" size={18} />
              <input placeholder="채널 이름으로 찾기" aria-label="채널 이름으로 찾기" value={query} onChange={e => setQuery(e.target.value)} />
            </label>
            {!loading && !error && <span className="count">{total.toLocaleString('ko-KR')}개 채널</span>}
          </div>

          {loading ? (
            <div className="state"><span className="spinner-border spinner-border-sm" /> 채널을 찾고 있습니다.</div>
          ) : error ? (
            <div className="alert alert-warning m-3">{error}</div>
          ) : rows.length === 0 ? (
            <div className="state">
              <GqaiIcon name="status-info" size={28} />
              <p>조건에 맞는 채널이 없습니다. 채널 풀은 매일 자동으로 늘어납니다.</p>
            </div>
          ) : (
            <div className="table-wrap">
              <table className="table align-middle">
                <thead>
                  <tr>
                    <th scope="col">#</th><th scope="col">채널</th><th scope="col">국가</th>
                    <th scope="col" className="num">구독자</th><th scope="col" className="num">영상</th><th scope="col" className="num">총 조회수</th>
                    {period && <th scope="col" className="num">{periodLabel} 증감</th>}
                    <th scope="col"><span className="visually-hidden">즐겨찾기</span></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, index) => {
                    const delta = deltaText(row, period);
                    return (
                      <tr key={row.channel_id}>
                        <td className="rank">{index + 1}</td>
                        <td>
                          <a className="channel" href={`https://www.youtube.com/channel/${row.channel_id}`} target="_blank" rel="noopener noreferrer">
                            {row.thumbnail_url
                              // eslint-disable-next-line @next/next/no-img-element
                              ? <img src={row.thumbnail_url} alt="" loading="lazy" />
                              : <span className="avatar" aria-hidden="true">{row.title.slice(0, 1)}</span>}
                            <span>
                              <strong>{row.title}</strong>
                              <small>{row.topic_ids.length ? row.topic_ids.slice(0, 3).map(topicLabel).join(' · ') : '미분류'}</small>
                            </span>
                          </a>
                        </td>
                        <td>{row.country || '—'}</td>
                        <td className="num">{row.hidden_subscriber ? '비공개' : formatMetric(row.subscriber_count === null ? null : String(row.subscriber_count))}</td>
                        <td className="num">{formatMetric(row.video_count === null ? null : String(row.video_count))}</td>
                        <td className="num">{formatMetric(row.view_count === null ? null : String(row.view_count))}</td>
                        {delta && <td className={`num delta ${delta.tone}`}>{delta.text}</td>}
                        <td>
                          <FavoriteButton channelId={row.channel_id} channelTitle={row.title} channelThumbnail={row.thumbnail_url || undefined}
                            subscriberCount={row.subscriber_count === null ? null : String(row.subscriber_count)} size="sm" initialFavorite={row.is_favorite} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {!loading && rows.length < total && (
            <div className="more">
              <button type="button" className="btn btn-outline-secondary" onClick={loadMore} disabled={loadingMore}>
                {loadingMore ? '불러오는 중…' : `더 보기 (${rows.length.toLocaleString('ko-KR')} / ${total.toLocaleString('ko-KR')})`}
              </button>
            </div>
          )}
        </section>
      </div>

      <CategoryFilterModal open={modalOpen} counts={topicCounts} selected={topics} onApply={setTopics} onClose={closeModal} />

      <style jsx>{`
        .explore-head { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 16px; margin: -24px 0 20px; }
        .explore-head h2 { margin: 0 !important; font-size: 26px; line-height: 1.2; }
        .explore-head p { flex: 1 1 280px; margin: 0; font-size: 14px; }
        .explore-layout { display: grid; grid-template-columns: 320px minmax(0, 1fr); gap: 24px; align-items: start; }
        .filters { position: sticky; top: 88px; display: grid; gap: 24px; padding: 20px; border: 1px solid var(--gqai-hairline); border-radius: var(--gqai-radius-lg); background: var(--gqai-canvas); }
        .filters h3 { margin: 0 0 10px; font-size: 15px; font-weight: 600; }
        .stale-note { margin: 0 0 10px; padding-left: 8px; color: var(--gqai-ink-secondary); border-left: 2px solid var(--gqai-primary); font-size: 12px; line-height: 1.6; }
        .hint { margin: 8px 0 0; color: var(--gqai-ink-mute); font-size: 12px; }
        .choice-row { display: flex; flex-wrap: wrap; gap: 8px; }
        .choice-row.two { display: grid; grid-template-columns: 1fr 1fr; }
        .choice { display: inline-flex; align-items: center; justify-content: center; gap: 4px; min-height: 38px; padding: 6px 12px; color: var(--gqai-ink); background: var(--gqai-canvas); border: 1px solid var(--gqai-hairline); border-radius: var(--gqai-radius-sm); font-size: 14px; }
        .choice small { color: var(--gqai-ink-mute); font-size: 11px; font-weight: 600; }
        .choice.on { border-color: var(--gqai-primary-deep); box-shadow: inset 0 0 0 1px var(--gqai-primary-deep); background: var(--gqai-canvas-soft); font-weight: 600; }
        .choice:disabled { opacity: .5; }
        .choice.wide { width: 100%; justify-content: flex-start; }
        .range { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 8px; color: var(--gqai-ink-mute); }
        .range input, .search input { width: 100%; min-height: 38px; padding: 6px 10px; color: var(--gqai-ink); background: var(--gqai-canvas); border: 1px solid var(--gqai-hairline); border-radius: var(--gqai-radius-sm); font-size: 14px; }
        .results { overflow: hidden; border: 1px solid var(--gqai-hairline); border-radius: var(--gqai-radius-lg); background: var(--gqai-canvas); }
        .results-head { display: flex; justify-content: space-between; align-items: center; gap: 16px; padding: 16px 20px; border-bottom: 1px solid var(--gqai-hairline); background: var(--gqai-canvas-soft); }
        .search { display: flex; align-items: center; gap: 8px; flex: 1; max-width: 360px; color: var(--gqai-ink-mute); }
        .count { color: var(--gqai-ink-mute); font-size: 13px; white-space: nowrap; }
        .state { display: grid; place-items: center; gap: 12px; min-height: 260px; padding: 24px; color: var(--gqai-ink-mute); text-align: center; }
        .table-wrap { position: relative; overflow-x: auto; }
        .table th { color: var(--gqai-ink-mute); font-weight: 500; white-space: nowrap; }
        .num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
        .rank { color: var(--gqai-ink-mute); width: 40px; }
        .channel { display: flex; align-items: center; gap: 10px; min-width: 220px; color: var(--gqai-ink); }
        .channel img, .avatar { flex: 0 0 auto; width: 36px; height: 36px; border-radius: 50%; object-fit: cover; }
        .avatar { display: grid; place-items: center; background: var(--gqai-canvas-soft); border: 1px solid var(--gqai-hairline); color: var(--gqai-ink-mute); }
        .channel strong { display: block; font-size: 14px; font-weight: 600; }
        .channel small { display: block; color: var(--gqai-ink-mute); font-size: 12px; }
        .delta.up { color: #15803d; font-weight: 600; }
        .delta.down { color: #c2410c; font-weight: 600; }
        .delta.muted { color: var(--gqai-ink-mute); font-size: 12px; }
        .more { display: flex; justify-content: center; padding: 16px; border-top: 1px solid var(--gqai-hairline-cool); }
        .filters-toggle { display: none; }
        @media (max-width: 991px) {
          .explore-layout { grid-template-columns: minmax(0, 1fr); gap: 12px; }
          .filters { position: static; display: none; }
          .filters.open { display: grid; }
          .filters-toggle { display: block; width: 100%; }
        }
      `}</style>
    </Layout>
  );
}
