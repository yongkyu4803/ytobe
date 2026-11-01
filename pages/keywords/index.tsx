import { useEffect, useMemo, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import axios from 'axios';
import Layout from '../../components/Layout';
import GqaiIcon from '../../components/GqaiIcon';
import Sparkline, { type SeriesPoint } from '../../components/Sparkline';
import UsageLimitNotice from '../../components/UsageLimitNotice';
import { supabase } from '../../lib/supabase';
import { formatMetric } from '../../utils/metrics';

type Tab = 'top' | 'mine';
type Range = 1 | 7;

interface KeywordRow {
  keyword: string; view_gain: string | number | null; video_count?: string | number; channel_count?: number;
  series: SeriesPoint[] | null; latest_day?: string;
}

export default function KeywordsPage() {
  const [tab, setTab] = useState<Tab>('top');
  const [range, setRange] = useState<Range>(7);
  const [alphabetical, setAlphabetical] = useState(false);
  const [rows, setRows] = useState<KeywordRow[]>([]);
  const [saved, setSaved] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [status, setStatus] = useState<{ keyword_latest_day: string | null; keyword_computed_at: string | null } | null>(null);

  useEffect(() => {
    void supabase.rpc('youtube_app_explore_status').then(({ data }) => { if (data) setStatus(data); });
    void supabase.from('youtube_app_saved_keywords').select('keyword').order('created_at', { ascending: false })
      .then(({ data }) => setSaved((data || []).map(r => r.keyword)));
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true); setError('');
      if (tab === 'top') {
        const { data, error: rpcError } = await supabase.rpc('youtube_app_keyword_ranking', { p_days: range, p_limit: alphabetical ? 1000 : 100 });
        if (cancelled) return;
        if (rpcError) { setError('키워드 순위를 불러오지 못했습니다.'); setRows([]); }
        else setRows((data || []) as KeywordRow[]);
      } else {
        if (!saved.length) { setRows([]); setLoading(false); return; }
        const [series, ranking] = await Promise.all([
          supabase.rpc('youtube_app_keyword_series', { p_keywords: saved }),
          supabase.rpc('youtube_app_keyword_ranking', { p_days: range, p_limit: 1000 }),
        ]);
        if (cancelled) return;
        if (series.error) { setError('내 키워드를 불러오지 못했습니다.'); setRows([]); }
        else {
          const gains = new Map(((ranking.data || []) as KeywordRow[]).map(r => [r.keyword, r]));
          setRows(((series.data || []) as KeywordRow[]).map(r => ({ ...r, view_gain: gains.get(r.keyword)?.view_gain ?? null,
            video_count: gains.get(r.keyword)?.video_count, channel_count: gains.get(r.keyword)?.channel_count })));
        }
      }
      setLoading(false);
    }
    void load();
    return () => { cancelled = true; };
  }, [tab, range, alphabetical, saved]);

  const display = useMemo(() => {
    if (!alphabetical) return rows;
    return [...rows].sort((a, b) => a.keyword.localeCompare(b.keyword, 'ko'));
  }, [rows, alphabetical]);

  const toggleSave = async (keyword: string) => {
    const isSaved = saved.includes(keyword);
    setMessage('');
    try {
      if (isSaved) await axios.delete('/api/keywords/saved', { data: { keyword } });
      else await axios.post('/api/keywords/saved', { keyword });
      setSaved(list => isSaved ? list.filter(k => k !== keyword) : [keyword, ...list]);
    } catch (e) {
      setMessage(axios.isAxiosError(e) && e.response?.status === 401
        ? '키워드 저장은 로그인 후 사용할 수 있습니다. 키워드 검색 화면에서 로그인하세요.'
        : '키워드를 저장하지 못했습니다.');
    }
  };

  const latest = status?.keyword_latest_day;

  return (
    <Layout>
      <Head>
        <title>인기 키워드 - YouTube Analytics</title>
        <meta name="description" content="수집한 한국 채널 Shorts의 키워드별 조회 소비량 흐름" />
      </Head>

      <div className="page-heading hero">
        <h2 className="display-6 fw-bold text-primary mb-2">주간 인기 키워드</h2>
        <p className="lead text-muted mb-0">수집한 한국 채널의 3분 이하 영상(Shorts) 조회수로 요즘 뜨는 키워드와 일별 소비량 흐름을 확인하세요.</p>
        <div className="tabs" role="tablist" aria-label="키워드 보기">
          <button type="button" role="tab" aria-selected={tab === 'top'} className={`btn ${tab === 'top' ? 'btn-primary' : 'btn-outline-secondary'}`} onClick={() => setTab('top')}>주간 Top 100</button>
          <button type="button" role="tab" aria-selected={tab === 'mine'} className={`btn ${tab === 'mine' ? 'btn-primary' : 'btn-outline-secondary'}`} onClick={() => setTab('mine')}>
            내 키워드{saved.length ? ` (${saved.length})` : ''}
          </button>
        </div>
      </div>

      <UsageLimitNotice scope="keywords" />

      <section className="panel" aria-live="polite" aria-busy={loading}>
        <div className="panel-head">
          <div>
            <h3>{tab === 'top' ? '주간 인기 키워드 TOP 100' : '내 키워드'} <span className="badge-range">{range === 1 ? '24시간' : '7일'} 조회수 기준</span></h3>
            <p>키워드를 누르면 해당 키워드가 붙은 영상 목록을 볼 수 있습니다. 수집 풀 안의 순위이며 YouTube 전체 순위가 아닙니다.</p>
          </div>
          <div className="controls">
            <div className="btn-group" role="group" aria-label="집계 기간">
              <button type="button" className={`btn ${range === 1 ? 'btn-primary' : 'btn-outline-secondary'}`} aria-pressed={range === 1} onClick={() => setRange(1)}>24시간</button>
              <button type="button" className={`btn ${range === 7 ? 'btn-primary' : 'btn-outline-secondary'}`} aria-pressed={range === 7} onClick={() => setRange(7)}>7일</button>
            </div>
            <button type="button" className={`btn ${alphabetical ? 'btn-dark' : 'btn-outline-secondary'}`} aria-pressed={alphabetical} onClick={() => setAlphabetical(v => !v)}>
              가나다 전체 보기
            </button>
          </div>
        </div>
        <p className="status-line">
          {latest ? `마지막 집계 ${latest} (한국 시간 기준 하루) · 매일 0시 40분 갱신` : '아직 집계된 날이 없습니다. 수집 시작 다음 날부터 표시됩니다.'}
        </p>
        {message && <div className="alert alert-warning mx-3">{message}</div>}

        {loading ? (
          <div className="state"><span className="spinner-border spinner-border-sm" /> 키워드를 불러오고 있습니다.</div>
        ) : error ? (
          <div className="alert alert-warning m-3">{error}</div>
        ) : display.length === 0 ? (
          <div className="state">
            <GqaiIcon name="status-info" size={28} />
            <p>{tab === 'mine' ? '저장한 키워드가 없습니다. 순위에서 별표를 눌러 저장하세요.' : '표시할 키워드가 없습니다. 영상 조회수가 이틀 이상 측정되면 순위가 생깁니다.'}</p>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="table align-middle">
              <thead>
                <tr>
                  <th scope="col">순위</th><th scope="col">키워드</th>
                  <th scope="col" className="num">{range === 1 ? '24시간' : '7일'} 소비량</th>
                  <th scope="col">일별 흐름 (최근 최대 14일)</th>
                  <th scope="col" className="num">영상·채널</th>
                  <th scope="col"><span className="visually-hidden">저장</span></th>
                </tr>
              </thead>
              <tbody>
                {display.map((row, index) => (
                  <tr key={row.keyword}>
                    <td><span className={`rank ${!alphabetical && index < 3 ? 'top' : ''}`}>{alphabetical ? '–' : index + 1}</span></td>
                    <td><Link className="kw" href={`/keywords/${encodeURIComponent(row.keyword)}`}>{row.keyword} <GqaiIcon name="action-external-link" size={14} /></Link></td>
                    <td className="num gain">{row.view_gain === null || row.view_gain === undefined ? <span className="muted">집계 없음</span> : `${formatMetric(String(row.view_gain))}회`}</td>
                    <td><Sparkline series={row.series} /></td>
                    <td className="num muted">{row.video_count !== undefined ? `${Number(row.video_count).toLocaleString('ko-KR')} · ${row.channel_count ?? '-'}` : '–'}</td>
                    <td>
                      <button type="button" className="star" aria-pressed={saved.includes(row.keyword)}
                        aria-label={saved.includes(row.keyword) ? `${row.keyword} 저장 해제` : `${row.keyword} 저장`} onClick={() => toggleSave(row.keyword)}>
                        {saved.includes(row.keyword) ? '★' : '☆'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <style jsx>{`
        .hero { text-align: center; }
        .tabs { display: flex; justify-content: center; gap: 12px; margin-top: 24px; }
        .panel { overflow: hidden; border: 1px solid var(--gqai-hairline); border-radius: var(--gqai-radius-lg); background: var(--gqai-canvas); }
        .panel-head { display: flex; justify-content: space-between; align-items: center; gap: 16px; padding: 20px 24px; border-bottom: 1px solid var(--gqai-hairline); background: var(--gqai-canvas-soft); }
        .panel-head h3 { margin: 0 0 4px; font-size: 18px; }
        .panel-head p { margin: 0; color: var(--gqai-ink-mute); font-size: 13px; }
        .badge-range { margin-left: 8px; padding: 2px 8px; color: #b42318; background: #fef3f2; border: 1px solid #fecdca; border-radius: 999px; font-size: 12px; font-weight: 500; vertical-align: middle; }
        .controls { display: flex; flex-wrap: wrap; gap: 8px; }
        .status-line { margin: 0; padding: 10px 24px; color: var(--gqai-ink-mute); font-size: 12px; border-bottom: 1px solid var(--gqai-hairline-cool); }
        .state { display: grid; place-items: center; gap: 12px; min-height: 240px; padding: 24px; color: var(--gqai-ink-mute); text-align: center; }
        .table-wrap { position: relative; overflow-x: auto; }
        .table th { color: var(--gqai-ink-mute); font-weight: 500; white-space: nowrap; }
        .num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
        .rank { display: inline-grid; place-items: center; min-width: 28px; height: 28px; color: var(--gqai-ink-mute); border-radius: 6px; font-size: 13px; }
        .rank.top { color: #b42318; background: #fef3f2; font-weight: 600; }
        .table :global(.kw) { display: inline-flex; align-items: center; gap: 4px; color: var(--gqai-ink); font-weight: 600; }
        .gain { color: #15803d; font-weight: 600; font-size: 15px; }
        .muted { color: var(--gqai-ink-mute); font-size: 12px; font-weight: 400; }
        .star { width: 36px; height: 36px; border: 0; background: none; color: #d97706; font-size: 20px; }
        @media (max-width: 767px) {
          .panel-head { flex-direction: column; align-items: start; }
        }
      `}</style>
    </Layout>
  );
}
