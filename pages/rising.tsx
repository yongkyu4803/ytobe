import { useEffect, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import Layout from '../components/Layout';
import GqaiIcon from '../components/GqaiIcon';
import { supabase } from '../lib/supabase';
import { formatMetric } from '../utils/metrics';
import { getFolders, type FavoriteFolder } from '../utils/supabaseFavorites';

type Period = 'day' | 'week' | 'month';

interface RisingVideo {
  video_id: string;
  channel_id: string;
  title: string;
  thumbnail_url: string | null;
  published_at: string;
  view_count: string | null;
  folder_id: string | null;
  channel_title: string;
  subscriber_count: string | null;
  observed_at: string;
  view_delta: string | null;
  elapsed_hours: string | number;
  views_per_hour: string | number;
  observation_count: number;
  surge_ratio: string | number | null;
  trend_score: string | number;
}

const periodLabels: Record<Period, string> = { day: '24시간', week: '7일', month: '30일' };
const periodHours: Record<Period, number> = { day: 24, week: 24 * 7, month: 24 * 30 };

function numeric(value: unknown): number | null {
  const result = Number(value);
  return Number.isFinite(result) && result >= 0 ? result : null;
}

function formatNumber(value: unknown) {
  if (value === null || value === undefined || value === '') return '수집 안 됨';
  if (typeof value === 'string' && /^\d+$/.test(value)) return formatMetric(value);
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return formatMetric(value);
  return '확인 필요';
}

function formatRate(value: unknown) {
  const result = numeric(value);
  return result === null || result > Number.MAX_SAFE_INTEGER ? '확인 필요' : `${formatMetric(Math.round(result))}/시간`;
}

function formatRatio(value: unknown) {
  const result = numeric(value);
  return result === null ? '비교 데이터 수집 중' : `평소 대비 ${result.toFixed(1)}배`;
}

function formatDate(value: string) {
  return new Date(value).toLocaleString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default function RisingVideosPage() {
  const [videos, setVideos] = useState<RisingVideo[]>([]);
  const [folders, setFolders] = useState<FavoriteFolder[]>([]);
  const [period, setPeriod] = useState<Period>('week');
  const [folderId, setFolderId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [observedAt, setObservedAt] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError('');
      const publishedAfter = new Date(Date.now() - periodHours[period] * 3600000).toISOString();
      let query = supabase.from('youtube_app_rising_videos').select('*')
        .gte('published_at', publishedAfter)
        .order('trend_score', { ascending: false })
        .order('views_per_hour', { ascending: false })
        .limit(50);
      if (folderId) query = query.eq('folder_id', folderId);
      const { data, error: queryError } = await query;
      if (cancelled) return;
      if (queryError) {
        setError('급상승 영상을 불러오지 못했습니다. 잠시 후 다시 시도하세요.');
        setVideos([]);
      } else {
        const result = (data || []) as RisingVideo[];
        setVideos(result);
        setObservedAt(result.reduce<string | null>((latest, video) => !latest || video.observed_at > latest ? video.observed_at : latest, null));
      }
      setLoading(false);
    }
    void load();
    return () => { cancelled = true; };
  }, [period, folderId]);

  useEffect(() => {
    let cancelled = false;
    void getFolders().then(data => { if (!cancelled) setFolders(data); });
    return () => { cancelled = true; };
  }, []);

  return (
    <Layout>
      <Head>
        <title>급상승 영상 - YouTube Analytics</title>
        <meta name="description" content="즐겨찾기 채널에서 빠르게 성장하는 영상을 찾습니다" />
      </Head>

      <div className="page-heading rising-heading">
        <div>
          <p className="rising-eyebrow"><GqaiIcon name="content-analysis-report" size={18} /> 즐겨찾기 채널 기준</p>
          <h2 className="display-6 fw-bold text-primary mb-2">급상승 영상</h2>
          <p className="lead text-muted mb-0">최근 조회 속도와 채널의 평소 성과를 함께 비교합니다.</p>
        </div>
        {observedAt && <p className="rising-observed">최근 관측 {formatDate(observedAt)}</p>}
      </div>

      <section className="rising-controls" aria-label="급상승 영상 필터">
        <div className="btn-group" role="group" aria-label="공개 기간">
          {(Object.keys(periodLabels) as Period[]).map(value => (
            <button key={value} type="button" className={`btn ${period === value ? 'btn-primary' : 'btn-outline-secondary'}`}
              aria-pressed={period === value} onClick={() => setPeriod(value)}>
              {periodLabels[value]}
            </button>
          ))}
        </div>
        <label className="rising-folder-filter">
          <span>폴더</span>
          <select value={folderId} onChange={event => setFolderId(event.target.value)}>
            <option value="">전체 채널</option>
            {folders.map(folder => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
          </select>
        </label>
      </section>

      <section className="rising-panel" aria-live="polite" aria-busy={loading}>
        <div className="rising-panel-heading">
          <div>
            <h3>상승 속도 순위</h3>
            <p>최근 8시간 안에 서로 다른 두 번 이상의 실제 측정값이 있는 영상만 표시합니다.</p>
          </div>
          {!loading && !error && <span className="rising-count">{videos.length}개 영상</span>}
        </div>

        {loading ? (
          <div className="rising-state"><span className="spinner-border spinner-border-sm" /><span>급상승 데이터를 계산하고 있습니다.</span></div>
        ) : error ? (
          <div className="alert alert-warning mb-0">{error}</div>
        ) : videos.length === 0 ? (
          <div className="rising-empty">
            <GqaiIcon name="status-info" size={28} />
            <h3>아직 비교할 관측값이 없습니다</h3>
            <p>전체 수집 후 다음 3시간 수집이 완료되면 조회 속도를 비교할 수 있습니다.</p>
            <Link href="/favorites" className="btn btn-outline-secondary">채널 모음으로 이동</Link>
          </div>
        ) : (
          <div className="rising-list" role="list">
            {videos.map((video, index) => (
              <a key={video.video_id} href={`https://www.youtube.com/watch?v=${video.video_id}`} target="_blank" rel="noopener noreferrer"
                className="rising-item" role="listitem" aria-label={`${video.title} YouTube에서 보기`}>
                <strong className="rising-rank">{index + 1}</strong>
                <div className="rising-thumbnail">
                  <span>영상</span>
                  {video.thumbnail_url && (
                    // YouTube thumbnail hosts are dynamic; preserve the lightweight direct image behavior used by channel videos.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={video.thumbnail_url} alt={video.title} loading="lazy" onError={event => { event.currentTarget.hidden = true; }} />
                  )}
                </div>
                <div className="rising-content">
                  <div className="rising-title-row">
                    <h4>{video.title}</h4>
                    <span className="rising-score">점수 {Number(video.trend_score).toFixed(1)}</span>
                  </div>
                  <p>{video.channel_title} · 공개 {formatDate(video.published_at)}</p>
                  <div className="rising-metrics">
                    <span>최근 {formatNumber(video.view_delta)}회 증가</span>
                    <span>{formatRate(video.views_per_hour)}</span>
                    <span>{formatRatio(video.surge_ratio)}</span>
                  </div>
                </div>
                <GqaiIcon name="action-external-link" size={20} />
              </a>
            ))}
          </div>
        )}
      </section>

      <style jsx>{`
        .rising-heading { display: flex; justify-content: space-between; align-items: end; gap: var(--gqai-space-4); }
        .rising-eyebrow { display: flex; align-items: center; gap: var(--gqai-space-2); margin: 0 0 var(--gqai-space-2); color: var(--gqai-ink-mute); font-size: 13px; }
        .rising-observed { margin: 0; color: var(--gqai-ink-mute); font-size: 12px; }
        .rising-controls { display: flex; justify-content: space-between; align-items: end; gap: var(--gqai-space-4); margin-bottom: var(--gqai-space-6); }
        .rising-folder-filter { display: grid; gap: var(--gqai-space-1); color: var(--gqai-ink-mute); font-size: 12px; }
        .rising-folder-filter select { min-width: 176px; min-height: 40px; padding: 8px 12px; color: var(--gqai-ink); background: var(--gqai-canvas); border: 1px solid var(--gqai-hairline); border-radius: var(--gqai-radius-sm); }
        .rising-panel { overflow: hidden; border: 1px solid var(--gqai-hairline); border-radius: var(--gqai-radius-lg); background: var(--gqai-canvas); }
        .rising-panel-heading { display: flex; justify-content: space-between; gap: var(--gqai-space-4); padding: var(--gqai-space-6); border-bottom: 1px solid var(--gqai-hairline); background: var(--gqai-canvas-soft); }
        .rising-panel-heading h3, .rising-empty h3 { margin: 0 0 var(--gqai-space-1); font-size: 18px; }
        .rising-panel-heading p, .rising-empty p { margin: 0; color: var(--gqai-ink-mute); font-size: 13px; }
        .rising-count { align-self: center; color: var(--gqai-ink-mute); font-size: 13px; white-space: nowrap; }
        .rising-state, .rising-empty { display: grid; place-items: center; gap: var(--gqai-space-3); min-height: 280px; padding: var(--gqai-space-6); text-align: center; color: var(--gqai-ink-mute); }
        .rising-empty { justify-items: center; }
        .rising-list { width: 100%; }
        .rising-item { display: grid; grid-template-columns: 36px 144px minmax(0, 1fr) 24px; align-items: center; gap: var(--gqai-space-4); min-height: 112px; padding: var(--gqai-space-3) var(--gqai-space-6); color: var(--gqai-ink); border-bottom: 1px solid var(--gqai-hairline-cool); transition: background-color .15s ease; }
        .rising-item:last-child { border-bottom: 0; }
        .rising-item:hover { color: var(--gqai-ink); background: var(--gqai-canvas-soft); }
        .rising-rank { color: var(--gqai-ink-mute); font-size: 14px; text-align: center; }
        .rising-thumbnail { position: relative; display: grid; place-items: center; overflow: hidden; aspect-ratio: 16 / 9; color: var(--gqai-ink-mute); background: var(--gqai-canvas-soft); border: 1px solid var(--gqai-hairline); border-radius: var(--gqai-radius-md); font-size: 12px; }
        .rising-thumbnail img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
        .rising-content { min-width: 0; }
        .rising-title-row { display: flex; justify-content: space-between; align-items: start; gap: var(--gqai-space-3); }
        .rising-title-row h4 { margin: 0; color: var(--gqai-ink); font-size: 16px; line-height: 1.45; overflow-wrap: anywhere; }
        .rising-score { flex: 0 0 auto; padding: 3px 6px; color: var(--gqai-ink); background: var(--gqai-primary); border-radius: var(--gqai-radius-xs); font-size: 11px; font-weight: 500; }
        .rising-content > p { margin: var(--gqai-space-1) 0 var(--gqai-space-2); color: var(--gqai-ink-mute); font-size: 12px; }
        .rising-metrics { display: flex; flex-wrap: wrap; gap: var(--gqai-space-2) var(--gqai-space-4); color: var(--gqai-ink-mute); font-size: 12px; }
        @media (max-width: 767px) {
          .rising-heading, .rising-controls, .rising-panel-heading { align-items: start; flex-direction: column; }
          .rising-controls { gap: var(--gqai-space-3); }
          .rising-folder-filter, .rising-folder-filter select { width: 100%; }
          .rising-item { grid-template-columns: 28px 104px minmax(0, 1fr); gap: var(--gqai-space-2); min-height: 92px; padding: var(--gqai-space-2) var(--gqai-space-3); }
          .rising-item > :last-child { display: none; }
          .rising-title-row { display: block; }
          .rising-title-row h4 { font-size: 14px; }
          .rising-score { display: inline-block; margin-top: var(--gqai-space-1); }
          .rising-content > p, .rising-metrics { font-size: 11px; }
        }
      `}</style>
    </Layout>
  );
}
