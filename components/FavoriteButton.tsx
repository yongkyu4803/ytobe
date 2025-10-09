import { useState, useEffect } from 'react';
import {
  isFavoriteChannel,
  addFavoriteChannel,
  removeFavoriteChannel,
} from '../utils/favoriteStorage';

interface FavoriteButtonProps {
  channelId: string;
  channelTitle: string;
  channelThumbnail?: string;
  subscriberCount: string;
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

  useEffect(() => {
    setIsFavorite(isFavoriteChannel(channelId));
  }, [channelId]);

  const handleToggle = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (isFavorite) {
      const success = removeFavoriteChannel(channelId);
      if (success) {
        setIsFavorite(false);
        onToggle?.(false);
      }
    } else {
      const success = addFavoriteChannel({
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
      className={`btn ${isFavorite ? 'btn-warning' : 'btn-outline-warning'} ${sizeClasses[size]}`}
      title={isFavorite ? '즐겨찾기 해제' : '즐겨찾기 추가'}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.25rem',
        whiteSpace: 'nowrap'
      }}
    >
      <span style={{ fontSize: iconSizes[size] }}>
        {isFavorite ? '⭐' : '☆'}
      </span>
      {showText && (
        <span className="ms-1">
          {isFavorite ? '즐겨찾기 해제' : '즐겨찾기'}
        </span>
      )}
    </button>
  );
}
