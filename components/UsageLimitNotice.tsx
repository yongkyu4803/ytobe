import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import GqaiIcon from './GqaiIcon';

const DAILY_LIMIT = 10000;

type ExploreStatus = { units_today: number; quota_paused: boolean };

/**
 * Explains the YouTube Data API free-quota limits that shape what this app can show.
 * `compact` is a single line for search/trending screens; the full variant lists every constraint.
 */
export default function UsageLimitNotice({ variant = 'full', scope = 'channels' }: {
  variant?: 'full' | 'compact';
  scope?: 'channels' | 'keywords' | 'search';
}) {
  const [status, setStatus] = useState<ExploreStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    void supabase.rpc('youtube_app_explore_status').then(({ data, error }) => {
      if (!cancelled && !error && data) setStatus(data as ExploreStatus);
    });
    return () => { cancelled = true; };
  }, []);

  const usage = status ? (
    <span className="usage-meter">
      오늘 자동 수집 사용량 {Number(status.units_today).toLocaleString('ko-KR')} / {DAILY_LIMIT.toLocaleString('ko-KR')}유닛
      {status.quota_paused && ' · 할당량 소진으로 오늘 수집 중지'}
    </span>
  ) : null;

  if (variant === 'compact') {
    return (
      <p className="usage-compact" role="note">
        <GqaiIcon name="status-info" size={16} />
        <span>
          YouTube API 무료 할당량(하루 10,000유닛)을 자동 수집과 함께 사용합니다. 할당량이 소진되면 검색이 실패할 수 있으며,
          미국 태평양 시간 자정(한국 시간 오후 4~5시)에 초기화됩니다.
        </span>
        {usage}
        <style jsx>{`
          .usage-compact { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; margin: 0 0 var(--gqai-space-6); color: var(--gqai-ink-mute); font-size: 12px; line-height: 1.6; }
          .usage-compact :global(.usage-meter) { color: var(--gqai-ink); }
        `}</style>
      </p>
    );
  }

  return (
    <details className="usage-notice" role="note">
      <summary>
        <GqaiIcon name="status-warning" size={18} />
        <strong>사용량에 따른 제약사항</strong>
        <span className="usage-summary">무료 할당량 안에서 수집하므로 범위와 갱신 주기가 제한됩니다.</span>
        {usage}
      </summary>
      <ul>
        <li>YouTube Data API 무료 할당량은 하루 10,000유닛이며, 자동 수집과 키워드 검색·인기 추천 화면이 함께 씁니다. 미국 태평양 시간 자정(한국 시간 오후 4~5시)에 초기화됩니다.</li>
        {scope !== 'keywords' && <>
          <li>채널 탐색은 YouTube 전체가 아니라 수집한 채널(최대 2만 개, 한국·미국·일본 중심, 구독자 1,000명 이상)에서만 찾습니다. 채널 풀은 하루 수백 개씩 늘어납니다.</li>
          <li>채널 통계는 하루 1회 갱신합니다. 조회수 증감은 실제 측정값 사이의 차이이며, 기간만큼 이력이 쌓이기 전에는 &lsquo;이력 수집 중&rsquo;으로 표시합니다.</li>
          <li>YouTube가 간혹 전날과 같은 총 조회수를 돌려줍니다. 이 경우 1일 증감을 &lsquo;갱신 안 됨&rsquo;으로 표시하며, 48시간 이상 기준을 권장합니다.</li>
        </>}
        {scope !== 'channels' && <>
          <li>인기 키워드는 수집한 한국 채널의 3분 이하 영상 기준 순위입니다. YouTube 전체 순위가 아니며, 3분 이하 일반 영상이 섞일 수 있습니다.</li>
          <li>키워드 소비량은 하루 1회 측정한 조회수 증가량의 합계입니다. 2개 이상 채널에서 쓰인 키워드만 집계하고, 매일 0시 40분(한국 시간)에 전날 값을 계산합니다.</li>
        </>}
        <li>사용량이 하루 4,500유닛을 넘으면 새 채널 검색을, 6,000유닛을 넘으면 탐색 수집 전체를 멈춥니다. 할당량이 소진되면 그날 수집이 멈추고 검색이 실패할 수 있으며, 초기화 후 다시 이어집니다.</li>
      </ul>
      <style jsx>{`
        .usage-notice { margin-bottom: var(--gqai-space-6); padding: var(--gqai-space-3) var(--gqai-space-4); background: var(--gqai-canvas-soft); border: 1px solid var(--gqai-hairline); border-left: 3px solid var(--gqai-primary); border-radius: var(--gqai-radius-md); font-size: 13px; }
        summary { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; cursor: pointer; list-style: none; }
        summary::-webkit-details-marker { display: none; }
        summary::after { content: '자세히'; margin-left: auto; color: var(--gqai-ink-mute); font-size: 12px; text-decoration: underline; }
        details[open] summary::after { content: '접기'; }
        .usage-summary { color: var(--gqai-ink-mute); }
        summary :global(.usage-meter) { width: 100%; color: var(--gqai-ink-mute); font-size: 12px; }
        ul { margin: var(--gqai-space-3) 0 0; padding-left: 20px; color: var(--gqai-ink-secondary); line-height: 1.7; }
        li + li { margin-top: 4px; }
      `}</style>
    </details>
  );
}
