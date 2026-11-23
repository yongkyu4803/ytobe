import { useState } from 'react';

export const UPLOAD_PREVIEW_LIMIT = 5;

export interface RecentUpload {
  video_id: string;
  title: string;
  thumbnail_url: string | null;
}

interface ChannelVideo {
  id: string;
  snippet: {
    title: string;
    publishedAt: string;
    thumbnails?: Partial<Record<'medium' | 'high' | 'default', { url: string }>>;
  };
}

type Lookup =
  | { status: 'idle' | 'loading' | 'error' }
  | { status: 'loaded'; uploads: RecentUpload[] };

export default function ChannelUploadPreviews({ channelId, channelTitle, storedUploads }: {
  channelId: string;
  channelTitle: string;
  storedUploads: RecentUpload[] | null;
}) {
  const [lookup, setLookup] = useState<Lookup>({ status: 'idle' });
  const uploads = lookup.status === 'loaded' ? lookup.uploads : storedUploads;
  const loading = lookup.status === 'loading';
  const buttonLabel = loading ? '불러오는 중…' : lookup.status === 'error' ? '다시 시도' : '최근 영상 불러오기';

  async function loadUploads() {
    setLookup({ status: 'loading' });
    try {
      const params = new URLSearchParams({
        channelId, maxResults: String(UPLOAD_PREVIEW_LIMIT), liveIfEmpty: '1',
      });
      const response = await fetch(`/api/channel-videos?${params}`, { signal: AbortSignal.timeout(40_000) });
      if (!response.ok) throw new Error('최근 영상 조회 실패');
      const { items } = await response.json() as { items: ChannelVideo[] };
      const recent = items
        .sort((a, b) => b.snippet.publishedAt.localeCompare(a.snippet.publishedAt))
        .map(({ id, snippet }) => ({
          video_id: id,
          title: snippet.title,
          thumbnail_url: snippet.thumbnails?.medium?.url || snippet.thumbnails?.high?.url || snippet.thumbnails?.default?.url || null,
        }));
      setLookup({ status: 'loaded', uploads: recent });
    } catch {
      setLookup({ status: 'error' });
    }
  }

  return (
    <>
      {uploads?.length ? (
        <ul className="upload-strip" aria-label={`${channelTitle} 최근 업로드`}>
          {uploads.map(video => (
            <li key={video.video_id}>
              <a className="upload" href={`https://www.youtube.com/watch?v=${encodeURIComponent(video.video_id)}`}
                aria-label={video.title} title={video.title} target="_blank" rel="noopener noreferrer">
                <span aria-hidden="true">{video.title}</span>
                {video.thumbnail_url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={video.thumbnail_url} alt="" loading="lazy" onError={event => { event.currentTarget.hidden = true; }} />
                )}
              </a>
            </li>
          ))}
        </ul>
      ) : lookup.status === 'loaded' ? (
        <span className="media-state" role="status">조회 가능한 공개 영상이 없습니다.</span>
      ) : (
        <div className="lookup">
          {lookup.status === 'error' && <span className="media-state" role="alert">최근 영상을 불러오지 못했습니다.</span>}
          <button type="button" className="load-uploads" disabled={loading} aria-busy={loading}
            aria-label={`${channelTitle} ${buttonLabel}`} onClick={loadUploads}>{buttonLabel}</button>
        </div>
      )}
      <style jsx>{`
        .lookup { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
        .media-state { color: var(--panel-muted); font-size: 12px; }
        .load-uploads { min-height: 36px; padding: 5px 10px; border: 1px solid var(--panel-line); border-radius: var(--gqai-radius-sm); background: var(--panel-raised); color: var(--gqai-on-dark); font-size: 12px; }
        .load-uploads:hover:not(:disabled) { border-color: var(--gqai-primary-deep); color: var(--gqai-primary); }
        .load-uploads:disabled { color: var(--panel-muted); }
        .upload-strip { display: grid; grid-template-columns: repeat(${UPLOAD_PREVIEW_LIMIT}, minmax(0, 1fr)); gap: 6px; margin: 0; padding: 0; list-style: none; }
        .upload { position: relative; display: grid; place-items: center; aspect-ratio: 16 / 25; overflow: hidden; border: 1px solid var(--panel-line); border-radius: var(--gqai-radius-sm); background: var(--panel-raised); color: var(--gqai-on-dark); }
        .upload span { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; padding-inline: 3px; font-size: 10px; line-height: 1.2; overflow-wrap: anywhere; text-align: center; }
        .upload img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
        .upload:hover, .upload:focus-visible, .load-uploads:focus-visible { outline: 2px solid var(--gqai-primary); outline-offset: 2px; }
      `}</style>
    </>
  );
}
