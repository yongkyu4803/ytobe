import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Head from 'next/head';
import Layout from '../components/Layout';
import GqaiIcon from '../components/GqaiIcon';
import FavoriteButton from '../components/FavoriteButton';
import UsageLimitNotice from '../components/UsageLimitNotice';
import CategoryFilterModal, { type TopicCount } from '../components/CategoryFilterModal';
import ChannelUploadPreviews, { UPLOAD_PREVIEW_LIMIT, type RecentUpload } from '../components/ChannelUploadPreviews';
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

type ChannelResult = ChannelRow & { recentUploads: RecentUpload[] | null };

const PERIODS: { value: Period; label: string }[] = [
  { value: '', label: '없음' }, { value: '1d', label: '1일' }, { value: '2d', label: '48시간' },
  { value: '7d', label: '7일' }, { value: '30d', label: '30일' },
];
const PAGE = 50;
const EMPTY_RANGES = { subMin: '', subMax: '', videoMin: '', videoMax: '' };

function parseCount(value: string) {
  const digits = value.replace(/[^\d]/g, '');
  return digits ? Number(digits) : null;
}

function rangeLabel(label: string, min: number | null, max: number | null) {
  if (min !== null && max !== null) return `${label} ${formatMetric(min)}~${formatMetric(max)}`;
  if (min !== null) return `${label} ${formatMetric(min)} 이상`;
  if (max !== null) return `${label} ${formatMetric(max)} 이하`;
  return null;
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
  const [ranges, setRanges] = useState(EMPTY_RANGES);
  const [countries, setCountries] = useState<string[]>([]);
  const [topics, setTopics] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [debounced, setDebounced] = useState(EMPTY_RANGES);
  const [rows, setRows] = useState<ChannelResult[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [moreError, setMoreError] = useState('');
  const [topicCounts, setTopicCounts] = useState<TopicCount[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const requestRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(ranges), 400);
    return () => clearTimeout(timer);
  }, [ranges]);

  useEffect(() => {
    const timer = setTimeout(() => setSearchTerm(query.trim()), 400);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    void supabase.rpc('youtube_app_topic_counts').then(({ data }) => setTopicCounts((data || []) as TopicCount[]));
  }, []);

  const params = useMemo(() => ({
    p_period: period || null, p_sort: sort,
    p_sub_min: parseCount(debounced.subMin), p_sub_max: parseCount(debounced.subMax),
    p_video_min: parseCount(debounced.videoMin), p_video_max: parseCount(debounced.videoMax),
    p_countries: countries.length ? countries : null, p_topics: topics.length ? topics : null,
    p_query: searchTerm || null,
  }), [period, sort, debounced, countries, topics, searchTerm]);

  const load = useCallback(async (offset: number, signal: AbortSignal): Promise<ChannelResult[]> => {
    const { data, error: rpcError } = await supabase.rpc('youtube_app_search_channels', {
      ...params, p_limit: PAGE, p_offset: offset,
    }).abortSignal(signal);
    if (rpcError) throw rpcError;

    const channels = (data ?? []) as ChannelRow[];
    if (channels.length === 0) return [];

    const { data: uploads, error: uploadsError } = await supabase
      .from('youtube_app_channels')
      .select('channel_id, youtube_app_videos(video_id, title, thumbnail_url)')
      .in('channel_id', channels.map(channel => channel.channel_id))
      .order('published_at', { referencedTable: 'youtube_app_videos', ascending: false })
      .order('video_id', { referencedTable: 'youtube_app_videos' })
      .limit(UPLOAD_PREVIEW_LIMIT, { referencedTable: 'youtube_app_videos' })
      .abortSignal(signal);
    const uploadsByChannel = new Map(uploads?.map(channel => [channel.channel_id, channel.youtube_app_videos]));
    return channels.map(channel => ({
      ...channel,
      recentUploads: uploadsError ? null : uploadsByChannel.get(channel.channel_id) ?? [],
    }));
  }, [params]);

  useEffect(() => {
    const controller = new AbortController();
    requestRef.current = controller;
    const { signal } = controller;
    setLoading(true); setError(''); setLoadingMore(false); setMoreError('');
    load(0, signal).then(result => {
      if (signal.aborted) return;
      setRows(result); setTotal(result.length ? Number(result[0].total_count) : 0);
    }).catch(() => { if (!signal.aborted) { setRows([]); setTotal(0); setError('채널을 불러오지 못했습니다. 잠시 후 다시 시도하세요.'); } })
      .finally(() => { if (!signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [load]);

  const loadMore = async () => {
    const signal = requestRef.current?.signal;
    if (!signal || signal.aborted || loading || loadingMore) return;
    setLoadingMore(true);
    setMoreError('');
    try {
      const more = await load(rows.length, signal);
      if (!signal.aborted) setRows(list => [...list, ...more]);
    } catch {
      if (!signal.aborted) setMoreError('추가 결과를 불러오지 못했습니다.');
    } finally {
      if (!signal.aborted) setLoadingMore(false);
    }
  };

  const toggleCountry = (value: string) => setCountries(list => list.includes(value) ? list.filter(x => x !== value) : [...list, value]);
  const reset = () => {
    setPeriod(''); setSort('views'); setRanges(EMPTY_RANGES);
    setCountries([]); setTopics([]); setQuery(''); setSearchTerm('');
    setDebounced(EMPTY_RANGES);
  };
  const periodLabel = PERIODS.find(p => p.value === period)?.label;
  const closeModal = useCallback(() => setModalOpen(false), []);
  const sortLabel = period ? '조회수 증감순' : sort === 'subscribers' ? '구독자순' : '총 조회수순';
  const topicsLabel = topics.length > 2 ? `${topics.slice(0, 2).map(topicLabel).join(', ')} 외 ${topics.length - 2}개` : topics.map(topicLabel).join(', ');
  const summary = [
    period && `${periodLabel} 기준`,
    rangeLabel('구독자', params.p_sub_min, params.p_sub_max),
    rangeLabel('영상 수', params.p_video_min, params.p_video_max),
    countries.length > 0 && COUNTRY_OPTIONS.filter(country => countries.includes(country.value)).map(country => country.label).join(', '),
    topicsLabel,
  ].filter(Boolean);

  return (
    <Layout>
      <Head>
        <title>채널 탐색 - YouTube Analytics</title>
        <meta name="description" content="수집한 채널을 조회수 증감, 구독자, 국가, 카테고리로 찾습니다" />
      </Head>

      <div className="page-heading explore-head">
        <h1>채널 탐색</h1>
        <UsageLimitNotice variant="inline" scope="channels" />
      </div>

      <section className="toolbar" aria-label="채널 검색 및 필터">
        <div className="filter-bar">
          <button type="button" className="filter-button" aria-expanded={filtersOpen} aria-controls="channel-filters"
            onClick={() => setFiltersOpen(open => !open)}>
            <GqaiIcon name="content-data-dashboard" size={19} />
            고급 필터 설정
          </button>
          <button type="button" className="filter-button" aria-haspopup="dialog" data-active={topics.length > 0}
            onClick={() => setModalOpen(true)}>
            <GqaiIcon name="content-archive" size={19} />
            카테고리 필터{topics.length > 0 && <span className="filter-count">{topics.length}</span>}
          </button>
          <div className="filter-summary" aria-label="현재 정렬 및 필터">
            <strong>{sortLabel}</strong>
            {summary.map(item => <span key={String(item)}>{item}</span>)}
          </div>
        </div>

        <div id="channel-filters" className="advanced" hidden={!filtersOpen}>
          <section className="wide-filter">
            <h2>조회수 증감 기준</h2>
            <div className="choice-row">
              {PERIODS.map(p => (
                <button key={p.value} type="button" className="choice" aria-pressed={period === p.value} onClick={() => setPeriod(p.value)}>{p.label}</button>
              ))}
            </div>
            <p className="hint">1일 조회수가 갱신되지 않은 채널은 48시간 이상으로 확인할 수 있습니다.</p>
          </section>
          <section className="wide-filter">
            <h2>정렬 기준</h2>
            <div className="choice-row">
              <button type="button" className="choice" aria-pressed={!period && sort === 'views'} disabled={!!period} onClick={() => setSort('views')}>총 조회수</button>
              <button type="button" className="choice" aria-pressed={!period && sort === 'subscribers'} disabled={!!period} onClick={() => setSort('subscribers')}>구독자</button>
            </div>
            {period && <p className="hint">선택한 기간의 조회수 증감순으로 정렬합니다.</p>}
          </section>
          <section>
            <h2>구독자 범위</h2>
            <div className="range">
              <input inputMode="numeric" placeholder="최소" aria-label="최소 구독자" value={ranges.subMin} onChange={e => setRanges({ ...ranges, subMin: e.target.value })} />
              <span aria-hidden="true">–</span>
              <input inputMode="numeric" placeholder="최대" aria-label="최대 구독자" value={ranges.subMax} onChange={e => setRanges({ ...ranges, subMax: e.target.value })} />
            </div>
          </section>
          <section>
            <h2>영상 수 범위</h2>
            <div className="range">
              <input inputMode="numeric" placeholder="최소" aria-label="최소 영상 수" value={ranges.videoMin} onChange={e => setRanges({ ...ranges, videoMin: e.target.value })} />
              <span aria-hidden="true">–</span>
              <input inputMode="numeric" placeholder="최대" aria-label="최대 영상 수" value={ranges.videoMax} onChange={e => setRanges({ ...ranges, videoMax: e.target.value })} />
            </div>
          </section>
          <section className="wide-filter">
            <h2>국가</h2>
            <div className="choice-row">
              {COUNTRY_OPTIONS.map(c => (
                <button key={c.value} type="button" className="choice" aria-pressed={countries.includes(c.value)}
                  onClick={() => toggleCountry(c.value)}>{c.label}</button>
              ))}
            </div>
          </section>
          <div className="filter-actions">
            <button type="button" className="btn btn-outline-secondary" onClick={reset}>필터 초기화</button>
          </div>
        </div>

        <div className="search-row">
          <form className="channel-search" role="search" onSubmit={event => { event.preventDefault(); setSearchTerm(query.trim()); }}>
            <label htmlFor="search-channels">채널명</label>
            <input id="search-channels" type="search" maxLength={100} placeholder="채널명으로 검색" value={query} onChange={e => setQuery(e.target.value)} />
            <button type="submit" className="btn btn-primary" aria-label="채널 검색">
              <GqaiIcon name="action-search" size={19} />
            </button>
          </form>
          <p className="result-count" role="status">
            {!loading && !error && <>
              <span className="count-dot" aria-hidden="true" />
              {searchTerm || summary.length > 0 ? '검색 결과' : '발굴된 채널'} <strong>{total.toLocaleString('ko-KR')}</strong>개
            </>}
          </p>
        </div>
      </section>

      <section className="results" aria-label="채널 탐색 결과" aria-busy={loading}>
        {loading ? (
          <div className="state" role="status"><span className="spinner-border spinner-border-sm" aria-hidden="true" /> 채널을 찾고 있습니다.</div>
        ) : error ? (
          <div className="state" role="alert"><GqaiIcon name="status-warning" size={22} />{error}</div>
        ) : rows.length === 0 ? (
          <div className="state">
            <GqaiIcon name="status-info" size={22} />
            조건에 맞는 채널이 없습니다.
            <button type="button" className="btn btn-outline-secondary" onClick={reset}>필터 초기화</button>
          </div>
        ) : (
          <>
            <p className="scroll-note">옆으로 밀어 영상과 조회수를 확인할 수 있습니다.</p>
            <div className="table-wrap" role="region" aria-label="채널별 영상 및 통계" tabIndex={0}>
              <table className="channel-table">
                <colgroup>
                  <col className="channel-column" /><col className="subscribers-column" />
                  <col className="uploads-column" /><col className="count-column" />
                  <col className="views-column" /><col className="actions-column" />
                </colgroup>
                <thead>
                  <tr>
                    <th scope="col">채널 정보</th>
                    <th scope="col" className="num" aria-sort={!period && sort === 'subscribers' ? 'descending' : undefined}>구독자</th>
                    <th scope="col">최근 업로드</th>
                    <th scope="col" className="num">영상 수</th>
                    <th scope="col" className="num" aria-sort={period || sort === 'views' ? 'descending' : undefined}>
                      {period ? '조회수 증감' : '총 조회수'}
                    </th>
                    <th scope="col"><span className="visually-hidden">즐겨찾기</span></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(row => {
                    const delta = deltaText(row, period);
                    return (
                      <tr key={row.channel_id}>
                        <td>
                          <div className="channel">
                            <span className="avatar" aria-hidden="true">
                              {row.title.slice(0, 1)}
                              {row.thumbnail_url && (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={row.thumbnail_url} alt="" loading="lazy" onError={event => { event.currentTarget.hidden = true; }} />
                              )}
                            </span>
                            <div className="channel-name">
                              <a href={`https://www.youtube.com/channel/${encodeURIComponent(row.channel_id)}`} target="_blank" rel="noopener noreferrer">{row.title}</a>
                              <small>{[row.country, ...(row.topic_ids.length ? row.topic_ids.slice(0, 2).map(topicLabel) : ['미분류'])].filter(Boolean).join(' · ')}</small>
                            </div>
                          </div>
                        </td>
                        <td className="num">{row.hidden_subscriber ? '비공개' : formatMetric(row.subscriber_count)}</td>
                        <td>
                          <ChannelUploadPreviews channelId={row.channel_id} channelTitle={row.title} storedUploads={row.recentUploads} />
                        </td>
                        <td className="num">{formatMetric(row.video_count)}</td>
                        <td className="num">
                          {delta ? (
                            <>
                              <small className="metric-note">{periodLabel} 기준</small>
                              <span className={`delta ${delta.tone}`}>{delta.text}</span>
                              <small className="metric-note">총 {formatMetric(row.view_count)}</small>
                            </>
                          ) : formatMetric(row.view_count)}
                        </td>
                        <td className="favorite">
                          <FavoriteButton channelId={row.channel_id} channelTitle={row.title} channelThumbnail={row.thumbnail_url || undefined}
                            subscriberCount={row.subscriber_count === null ? null : String(row.subscriber_count)} size="sm" initialFavorite={row.is_favorite} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
        {!loading && !error && rows.length < total && (
          <div className="more">
            {moreError && <p role="alert">{moreError}</p>}
            <button type="button" className="btn btn-outline-secondary" onClick={loadMore} disabled={loadingMore}>
              {loadingMore ? '불러오는 중…' : `더 보기 (${rows.length.toLocaleString('ko-KR')} / ${total.toLocaleString('ko-KR')})`}
            </button>
          </div>
        )}
      </section>

      {modalOpen && <CategoryFilterModal counts={topicCounts} selected={topics} onApply={setTopics} onClose={closeModal} />}

      <style jsx>{`
        .explore-head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px 16px; margin: 0 0 20px; }
        .explore-head h1 { margin: 0; font: 700 clamp(28px, 4vw, 36px)/1.2 var(--gqai-font-display); letter-spacing: -.035em; }
        .toolbar, .results { --panel-line: #3d4543; --panel-raised: #292f2d; --panel-muted: #b4beba; border: 1px solid var(--panel-line); border-radius: var(--gqai-radius-lg); background: var(--gqai-canvas-night); color: var(--gqai-on-dark); }
        .toolbar { display: grid; gap: 16px; margin: 0 0 24px; padding: 20px; }
        .filter-bar, .filter-summary, .search-row, .choice-row { display: flex; flex-wrap: wrap; align-items: center; }
        .filter-bar { gap: 8px; }
        .filter-button, .choice { display: inline-flex; align-items: center; justify-content: center; gap: 7px; min-height: 40px; padding: 7px 12px; background: var(--panel-raised); border: 1px solid var(--panel-line); border-radius: var(--gqai-radius-sm); color: var(--gqai-on-dark); font-size: 14px; }
        .filter-button { font-weight: 600; }
        .filter-button:hover, .choice:not(:disabled):hover { border-color: var(--gqai-hairline-strong); }
        .filter-button[aria-expanded="true"], .filter-button[data-active="true"], .choice[aria-pressed="true"] { color: var(--gqai-primary); background: color-mix(in srgb, var(--gqai-primary) 10%, var(--gqai-canvas-night)); border-color: var(--gqai-primary-deep); }
        .filter-count { min-width: 20px; padding: 0 4px; border-radius: var(--gqai-radius-xs); background: var(--gqai-primary); color: var(--gqai-ink); font-size: 12px; text-align: center; }
        .filter-summary { gap: 6px 10px; padding: 7px 10px; color: var(--panel-muted); font-size: 13px; }
        .filter-summary strong { color: var(--gqai-on-dark); font-weight: 600; }
        .filter-summary span { padding-inline-start: 10px; border-inline-start: 1px solid var(--panel-line); overflow-wrap: anywhere; }
        .search-row { justify-content: space-between; gap: 10px 20px; }
        .channel-search { display: flex; align-items: stretch; width: min(100%, 540px); min-height: 44px; border: 1px solid var(--panel-line); border-radius: var(--gqai-radius-sm); background: var(--gqai-canvas-night-soft); color-scheme: dark; }
        .channel-search:focus-within { outline: 2px solid var(--gqai-primary-deep); outline-offset: 2px; }
        .channel-search label { display: grid; place-items: center; padding-inline: 13px; border-inline-end: 1px solid var(--panel-line); color: var(--panel-muted); font-size: 13px; font-weight: 600; white-space: nowrap; }
        .channel-search input { flex: 1; min-width: 0; padding: 8px 12px; border: 0; outline: none; color: var(--gqai-on-dark); background: transparent; font-size: 16px; }
        .channel-search input::placeholder { color: var(--panel-muted); }
        .channel-search button { display: grid; place-items: center; border-radius: 0 var(--gqai-radius-sm) var(--gqai-radius-sm) 0; padding: 0 14px; }
        .result-count { display: flex; align-items: center; gap: 5px; margin: 0; min-height: 24px; font-size: 13px; color: var(--panel-muted); }
        .result-count strong { color: var(--gqai-on-dark); font-size: 16px; font-variant-numeric: tabular-nums; }
        .count-dot { width: 7px; height: 7px; margin-inline-end: 3px; border-radius: 50%; background: var(--gqai-primary-deep); }
        .advanced { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 16px 20px; padding: 16px; border: 1px solid var(--panel-line); border-radius: var(--gqai-radius-md); background: var(--gqai-canvas-night-soft); }
        .advanced[hidden] { display: none; }
        .advanced h2 { margin: 0 0 8px; font-size: 14px; font-weight: 650; }
        .wide-filter { grid-column: span 2; }
        .choice-row { gap: 6px; }
        .choice { min-height: 36px; padding-inline: 9px; font-size: 13px; }
        .choice:disabled { color: var(--panel-muted); background: transparent; }
        .hint { margin: 7px 0 0; color: var(--panel-muted); font-size: 12px; }
        .range { display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr); gap: 6px; align-items: center; color: var(--panel-muted); }
        .range input { min-height: 36px; padding: 6px 8px; border: 1px solid var(--panel-line); border-radius: var(--gqai-radius-sm); background: var(--panel-raised); color: var(--gqai-on-dark); }
        .range input::placeholder { color: var(--panel-muted); }
        .filter-actions { grid-column: 1 / -1; justify-self: end; }
        .toolbar button:focus-visible, .range input:focus-visible, .results :is(button, a, [tabindex]):focus-visible { outline: 2px solid var(--gqai-primary); outline-offset: 2px; }
        .table-wrap { position: relative; width: 100%; overflow-x: auto; border-radius: inherit; }
        .channel-table { width: 100%; min-width: 880px; table-layout: fixed; border-collapse: collapse; }
        .channel-column { width: 25%; }
        .subscribers-column { width: 9%; }
        .uploads-column { width: 39%; }
        .count-column { width: 8%; }
        .views-column { width: 13%; }
        .actions-column { width: 6%; }
        .channel-table th, .channel-table td { padding: 16px 10px; vertical-align: middle; }
        .channel-table th:first-child, .channel-table td:first-child { padding-inline-start: 20px; }
        .channel-table th { background: var(--panel-raised); color: var(--panel-muted); font-size: 13px; font-weight: 600; }
        .channel-table th[aria-sort] { color: var(--gqai-primary); }
        .channel-table td { border-top: 1px solid var(--panel-line); font-size: 14px; }
        .channel { display: flex; align-items: center; gap: 12px; min-width: 0; }
        .avatar { position: relative; display: grid; flex: 0 0 44px; place-items: center; height: 44px; overflow: hidden; color: var(--panel-muted); background: var(--panel-raised); border: 1px solid var(--panel-line); border-radius: var(--gqai-radius-md); }
        .channel-name { min-width: 0; overflow-wrap: anywhere; }
        .channel-name a { color: inherit; font-size: 15px; font-weight: 650; text-underline-offset: 3px; }
        .channel-name a:hover { color: var(--gqai-primary); text-decoration: underline; }
        .channel-name small, .metric-note { display: block; margin-top: 4px; color: var(--panel-muted); font-size: 11px; font-weight: 400; }
        .num { text-align: right; font-variant-numeric: tabular-nums; }
        td.num { font-weight: 600; }
        .metric-note:first-child { margin: 0 0 3px; }
        .delta.up { color: var(--gqai-primary); }
        .delta.down { color: #ffad9b; }
        .delta.muted { color: var(--panel-muted); font-size: 12px; font-weight: 400; }
        .avatar img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
        .favorite :global(.btn) { justify-content: center; min-width: 36px; min-height: 36px; padding: 4px; color: var(--panel-muted); border-color: var(--panel-line); background: transparent; }
        .favorite :global(.btn:hover), .favorite :global(.btn[aria-pressed="true"]) { color: var(--gqai-primary); border-color: var(--gqai-primary-deep); }
        .state, .more { display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 9px; padding: 18px; color: var(--panel-muted); }
        .state { min-height: 190px; text-align: center; }
        .more { border-top: 1px solid var(--panel-line); }
        .more p { flex-basis: 100%; margin: 0; text-align: center; }
        .scroll-note { display: none; }
        @media (max-width: 960px) {
          .scroll-note { display: block; margin: 0; padding: 8px 16px; color: var(--panel-muted); font-size: 12px; }
          .scroll-note + .table-wrap { border-radius: 0 0 var(--gqai-radius-lg) var(--gqai-radius-lg); }
        }
        @media (max-width: 650px) {
          .toolbar { padding: 12px; gap: 10px; }
          .filter-summary { width: 100%; padding-inline: 0; }
          .advanced { grid-template-columns: repeat(2, minmax(0, 1fr)); padding: 12px; column-gap: 10px; }
          .channel-search { width: 100%; }
        }
      `}</style>
    </Layout>
  );
}
