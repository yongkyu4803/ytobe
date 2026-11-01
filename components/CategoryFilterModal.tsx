import { useEffect, useRef, useState } from 'react';
import GqaiIcon from './GqaiIcon';
import { topicLabel, UNCLASSIFIED } from '../utils/topics';

export interface TopicCount { topic_id: string; channel_count: number | string }

export default function CategoryFilterModal({ open, counts, selected, onApply, onClose }: {
  open: boolean;
  counts: TopicCount[];
  selected: string[];
  onApply: (topics: string[]) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<string[]>(selected);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => { if (open) setDraft(selected); }, [open, selected]);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = ''; previous?.focus(); };
  }, [open, onClose]);

  if (!open) return null;
  const sorted = counts.filter(c => c.topic_id !== UNCLASSIFIED).sort((a, b) => Number(b.channel_count) - Number(a.channel_count));
  const unclassified = counts.find(c => c.topic_id === UNCLASSIFIED);
  const toggle = (id: string) => setDraft(list => list.includes(id) ? list.filter(x => x !== id) : [...list, id]);
  const chip = (c: TopicCount) => (
    <button key={c.topic_id} type="button" className={`chip ${draft.includes(c.topic_id) ? 'on' : ''}`}
      aria-pressed={draft.includes(c.topic_id)} onClick={() => toggle(c.topic_id)}>
      {c.topic_id === UNCLASSIFIED && <GqaiIcon name="reaction-question" size={16} />}
      {topicLabel(c.topic_id)} <span>({Number(c.channel_count).toLocaleString('ko-KR')})</span>
    </button>
  );

  return (
    <div className="backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="category-title" tabIndex={-1} ref={dialogRef}>
        <header>
          <div>
            <h3 id="category-title">카테고리 필터</h3>
            <p>관심 있는 카테고리를 선택하세요</p>
          </div>
          <button type="button" className="close" aria-label="닫기" onClick={onClose}><GqaiIcon name="action-close" size={20} /></button>
        </header>
        <div className="body">
          <p className="caption"><strong>카테고리 (복수 선택 가능)</strong> <span>채널 수 많은 순</span></p>
          {sorted.length === 0 ? <p className="empty">아직 카테고리 정보가 수집된 채널이 없습니다.</p> : <div className="chips">{sorted.map(chip)}</div>}
          {unclassified && Number(unclassified.channel_count) > 0 && <div className="chips none">{chip(unclassified)}</div>}
          <p className="hint"><GqaiIcon name="status-info" size={14} /> 복수 선택 시 선택한 카테고리 중 하나라도 포함한 채널을 표시합니다</p>
        </div>
        <footer>
          <button type="button" className="btn btn-outline-secondary" onClick={() => setDraft([])}><GqaiIcon name="action-retry" size={16} /> 초기화</button>
          <button type="button" className="btn btn-primary" onClick={() => { onApply(draft); onClose(); }}>
            필터 적용{draft.length ? ` (${draft.length})` : ''}
          </button>
        </footer>
      </div>
      <style jsx>{`
        .backdrop { position: fixed; inset: 0; z-index: 1050; display: grid; place-items: center; padding: 16px; background: rgba(0,0,0,.45); }
        .dialog { display: flex; flex-direction: column; width: min(880px, 100%); max-height: min(760px, calc(100vh - 32px)); background: var(--gqai-canvas); border-radius: var(--gqai-radius-xl); box-shadow: var(--gqai-shadow-3); outline: none; }
        header { display: flex; justify-content: space-between; gap: 16px; padding: 20px 24px; border-bottom: 1px solid var(--gqai-hairline); }
        h3 { margin: 0; font-size: 20px; }
        header p { margin: 4px 0 0; color: var(--gqai-ink-mute); font-size: 13px; }
        .close { width: 40px; height: 40px; border: 0; background: none; color: var(--gqai-ink-mute); }
        .body { overflow-y: auto; padding: 20px 24px; }
        .caption { margin: 0 0 12px; font-size: 14px; }
        .caption span { margin-left: 8px; color: var(--gqai-ink-mute); font-size: 12px; }
        .chips { display: flex; flex-wrap: wrap; gap: 8px; }
        .chips.none { margin-top: 16px; padding-top: 16px; border-top: 1px solid var(--gqai-hairline-cool); }
        .dialog :global(.chip) { display: inline-flex; align-items: center; gap: 6px; min-height: 36px; padding: 6px 12px; color: var(--gqai-ink); background: var(--gqai-canvas); border: 1px solid var(--gqai-hairline); border-radius: var(--gqai-radius-sm); font-size: 14px; }
        .dialog :global(.chip span) { color: var(--gqai-ink-mute); font-size: 12px; }
        .dialog :global(.chip.on) { background: var(--gqai-canvas-soft); border-color: var(--gqai-primary-deep); box-shadow: inset 0 0 0 1px var(--gqai-primary-deep); }
        .hint { display: flex; align-items: center; gap: 6px; margin: 16px 0 0; color: var(--gqai-ink-mute); font-size: 12px; }
        .empty { color: var(--gqai-ink-mute); font-size: 13px; }
        footer { display: flex; justify-content: space-between; gap: 12px; padding: 16px 24px; border-top: 1px solid var(--gqai-hairline); }
        footer :global(.btn) { display: inline-flex; align-items: center; gap: 6px; }
      `}</style>
    </div>
  );
}
