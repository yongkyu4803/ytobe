import { useState } from 'react';
import axios from 'axios';
import { formatMetric } from '../utils/metrics';
import { addFavoriteChannel, isFavoriteChannel } from '../utils/supabaseFavorites';

interface Candidate {
  channelId: string;
  title: string;
  thumbnail: string | null;
  subscriberCount: string | null;
  handle: string | null;
  description: string;
}

interface AddChannelFormProps {
  folderId: string | null;
  onAdded: () => void;
}

export default function AddChannelForm({ folderId, onAdded }: AddChannelFormProps) {
  const [query, setQuery] = useState('');
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [existing, setExisting] = useState<Set<string>>(new Set());
  const [searching, setSearching] = useState(false);
  const [addingId, setAddingId] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [searched, setSearched] = useState(false);

  const handleSearch = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const trimmed = query.trim();
    if (!trimmed || searching) return;

    setSearching(true);
    setMessage('');
    setCandidates([]);
    setSearched(false);
    try {
      const response = await axios.post('/api/resolve-channel', { query: trimmed });
      const found: Candidate[] = response.data.candidates || [];
      const flags = await Promise.all(found.map(c => isFavoriteChannel(c.channelId)));
      setExisting(new Set(found.filter((_, i) => flags[i]).map(c => c.channelId)));
      setCandidates(found);
      setSearched(true);
    } catch (error: unknown) {
      setMessage(axios.isAxiosError(error)
        ? error.response?.data?.message || '채널을 조회하지 못했습니다.'
        : '채널을 조회하지 못했습니다.');
    } finally {
      setSearching(false);
    }
  };

  const handleAdd = async (candidate: Candidate) => {
    setAddingId(candidate.channelId);
    setMessage('');
    try {
      const success = await addFavoriteChannel({
        channelId: candidate.channelId,
        channelTitle: candidate.title,
        channelThumbnail: candidate.thumbnail || undefined,
        subscriberCount: candidate.subscriberCount,
        folderId: folderId || undefined,
      });
      if (!success) {
        setMessage(`${candidate.title} 추가에 실패했습니다.`);
        return;
      }
      setExisting(prev => new Set(prev).add(candidate.channelId));
      setMessage(`${candidate.title} 채널을 추가했습니다.`);
      onAdded();
    } finally {
      setAddingId(null);
    }
  };

  return (
    <div className="card shadow-sm mb-4">
      <div className="card-header bg-light">
        <strong>채널 추가</strong>
      </div>
      <div className="card-body">
        <form onSubmit={handleSearch} className="d-flex gap-2 flex-wrap">
          <input
            type="text"
            className="form-control"
            style={{ flex: 1, minWidth: '260px' }}
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="채널 주소, @핸들, 영상 링크 또는 채널명"
            aria-label="추가할 채널"
            maxLength={200}
          />
          <button type="submit" className="btn btn-primary" disabled={searching || !query.trim()} aria-busy={searching}>
            {searching ? <><span className="spinner-border spinner-border-sm me-1" />찾는 중...</> : '찾기'}
          </button>
        </form>
        <p className="small text-muted mt-2 mb-0">
          채널 주소·@핸들·영상 링크는 바로 찾고, 채널명으로도 검색할 수 있습니다.
        </p>

        {message && <div className="alert alert-info py-2 small mt-3 mb-0" role="status">{message}</div>}

        {searched && candidates.length === 0 && !message && (
          <div className="alert alert-warning py-2 small mt-3 mb-0">일치하는 채널을 찾지 못했습니다.</div>
        )}

        {candidates.length > 0 && (
          <ul className="list-group list-group-flush mt-3">
            {candidates.map(candidate => {
              const added = existing.has(candidate.channelId);
              return (
                <li key={candidate.channelId} className="list-group-item d-flex align-items-center gap-3 px-0">
                  {candidate.thumbnail && (
                    <img
                      src={candidate.thumbnail}
                      alt=""
                      width={48}
                      height={48}
                      className="rounded-circle flex-shrink-0"
                    />
                  )}
                  <div className="flex-grow-1 min-width-0">
                    <div className="fw-semibold text-truncate">{candidate.title}</div>
                    <div className="small text-muted text-truncate">
                      {candidate.handle ? `${candidate.handle} · ` : ''}
                      구독자 {formatMetric(candidate.subscriberCount)}
                    </div>
                  </div>
                  <button
                    className={`btn btn-sm ${added ? 'btn-outline-secondary' : 'btn-dark'} flex-shrink-0`}
                    onClick={() => handleAdd(candidate)}
                    disabled={added || addingId === candidate.channelId}
                    aria-busy={addingId === candidate.channelId}
                  >
                    {added ? '추가됨' : addingId === candidate.channelId ? '추가 중...' : '추가'}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
