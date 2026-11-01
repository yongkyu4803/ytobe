import { useEffect, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import Layout from '../../components/Layout';
import GqaiIcon from '../../components/GqaiIcon';
import UsageLimitNotice from '../../components/UsageLimitNotice';
import { supabase } from '../../lib/supabase';
import { formatMetric } from '../../utils/metrics';

interface KeywordVideo {
  video_id: string; channel_id: string; channel_title: string; title: string; thumbnail_url: string | null;
  published_at: string; view_count: string | number | null; view_gain: string | number | null; collected_at: string | null;
}

export default function KeywordVideosPage() {
  const router = useRouter();
  const keyword = typeof router.query.keyword === 'string' ? router.query.keyword : '';
  const [days, setDays] = useState<1 | 7>(7);
  const [videos, setVideos] = useState<KeywordVideo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!keyword) return;
    let cancelled = false;
    setLoading(true); setError('');
    void supabase.rpc('youtube_app_keyword_videos', { p_keyword: keyword, p_days: days }).then(({ data, error: rpcError }) => {
      if (cancelled) return;
      if (rpcError) { setError('영상 목록을 불러오지 못했습니다.'); setVideos([]); } else setVideos((data || []) as KeywordVideo[]);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [keyword, days]);

  return (
    <Layout>
      <Head><title>{keyword ? `${keyword} - 인기 키워드` : '인기 키워드'} - YouTube Analytics</title></Head>
      <div className="page-heading">
        <p className="back"><Link href="/keywords">← 인기 키워드</Link></p>
        <h2 className="display-6 fw-bold text-primary mb-2">#{keyword}</h2>
        <p className="lead text-muted mb-0">이 키워드가 붙은 최근 30일 영상(수집한 한국 채널, 3분 이하)을 기간 내 조회수 증가 순으로 보여줍니다.</p>
      </div>
      <UsageLimitNotice scope="keywords" />
      <div className="btn-group mb-3" role="group" aria-label="기간">
        <button type="button" className={`btn ${days === 1 ? 'btn-primary' : 'btn-outline-secondary'}`} aria-pressed={days === 1} onClick={() => setDays(1)}>24시간</button>
        <button type="button" className={`btn ${days === 7 ? 'btn-primary' : 'btn-outline-secondary'}`} aria-pressed={days === 7} onClick={() => setDays(7)}>7일</button>
      </div>
      <section className="list" aria-live="polite" aria-busy={loading}>
        {loading ? <div className="state"><span className="spinner-border spinner-border-sm" /> 불러오는 중입니다.</div>
          : error ? <div className="alert alert-warning m-3">{error}</div>
          : videos.length === 0 ? <div className="state"><GqaiIcon name="status-info" size={28} /><p>이 키워드가 붙은 수집 영상이 없습니다.</p></div>
          : videos.map((v, i) => (
            <a key={v.video_id} className="item" href={`https://www.youtube.com/shorts/${v.video_id}`} target="_blank" rel="noopener noreferrer">
              <strong className="rank">{i + 1}</strong>
              <div className="thumb">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {v.thumbnail_url && <img src={v.thumbnail_url} alt="" loading="lazy" />}
              </div>
              <div className="body">
                <h4>{v.title}</h4>
                <p>{v.channel_title} · 공개 {new Date(v.published_at).toLocaleDateString('ko-KR')}</p>
                <p className="metrics">
                  <span className="gain">{v.view_gain === null ? '증가량 측정 중' : `+${formatMetric(String(Math.max(0, Number(v.view_gain))))}회`}</span>
                  <span>누적 {formatMetric(v.view_count === null ? null : String(v.view_count))}회</span>
                </p>
              </div>
            </a>
          ))}
      </section>
      <style jsx>{`
        .back { margin: 0 0 8px; font-size: 13px; }
        .list { overflow: hidden; border: 1px solid var(--gqai-hairline); border-radius: var(--gqai-radius-lg); background: var(--gqai-canvas); }
        .state { display: grid; place-items: center; gap: 12px; min-height: 220px; color: var(--gqai-ink-mute); }
        .item { display: grid; grid-template-columns: 32px 64px minmax(0,1fr); gap: 16px; align-items: center; padding: 12px 20px; color: var(--gqai-ink); border-bottom: 1px solid var(--gqai-hairline-cool); }
        .item:last-child { border-bottom: 0; }
        .item:hover { background: var(--gqai-canvas-soft); color: var(--gqai-ink); }
        .rank { color: var(--gqai-ink-mute); text-align: center; }
        .thumb { position: relative; overflow: hidden; aspect-ratio: 9 / 16; background: var(--gqai-canvas-soft); border-radius: 6px; }
        .thumb img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
        h4 { margin: 0; font-size: 15px; line-height: 1.45; overflow-wrap: anywhere; }
        .body p { margin: 4px 0 0; color: var(--gqai-ink-mute); font-size: 12px; }
        .metrics { display: flex; gap: 12px; }
        .gain { color: #15803d; font-weight: 600; }
      `}</style>
    </Layout>
  );
}
