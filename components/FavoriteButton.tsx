import { useState, useEffect } from 'react';
import GqaiIcon from './GqaiIcon';
import {
  isFavoriteChannel,
  addFavoriteChannel,
  removeFavoriteChannel,
} from '../utils/supabaseFavorites';

interface FavoriteButtonProps {
  channelId: string;
  channelTitle: string;
  channelThumbnail?: string;
  subscriberCount: string | null;
  size?: 'sm' | 'md' | 'lg';
  showText?: boolean;
  onToggle?: (isFavorite: boolean) => void;
}

export default function FavoriteButton({
  channelId,
  channelTitle,
  channelThumbnail,
  subscriberCount,
  size = 'md',
  showText = false,
  onToggle,
}: FavoriteButtonProps) {
  const [isFavorite, setIsFavorite] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const checkFavorite = async () => {
      const result = await isFavoriteChannel(channelId);
      setIsFavorite(result);
    };
    checkFavorite();
  }, [channelId]);

  const handleToggle = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (isLoading) return;
    setIsLoading(true);

    try {
      if (isFavorite) {
        const success = await removeFavoriteChannel(channelId);
        if (success) {
          setIsFavorite(false);
          onToggle?.(false);
        }
      } else {
        const success = await addFavoriteChannel({
          channelId,
          channelTitle,
          channelThumbnail,
          subscriberCount,
        });
        if (success) {
          setIsFavorite(true);
          onToggle?.(true);
        }
      }
    } finally {
      setIsLoading(false);
    }
  };

  const sizeClasses = {
    sm: 'btn-sm',
    md: '',
    lg: 'btn-lg',
  };

  const iconSizes = {
    sm: '0.875rem',
    md: '1rem',
    lg: '1.25rem',
  };

  return (
    <button
      onClick={handleToggle}
      className={`btn ${isFavorite ? 'btn-dark' : 'btn-outline-secondary'} ${sizeClasses[size]}`}
      title={isFavorite ? '즐겨찾기 해제' : '즐겨찾기 추가'}
      aria-label={isFavorite ? '즐겨찾기 해제' : '즐겨찾기 추가'}
      aria-pressed={isFavorite}
      aria-busy={isLoading}
      disabled={isLoading}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.25rem',
        whiteSpace: 'nowrap'
      }}
    >
      {isLoading ? (
        <span className="spinner-border spinner-border-sm" role="status" aria-hidden="true" />
      ) : (
        <span style={{ fontSize: iconSizes[size] }}>
          <GqaiIcon name="content-archive" size={20} />
        </span>
      )}
      {showText && !isLoading && (
        <span className="ms-1">
          {isFavorite ? '즐겨찾기 해제' : '즐겨찾기'}
        </span>
      )}
    </button>
  );
}
