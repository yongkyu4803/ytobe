-- YouTube App - Favorites & Notifications Tables with Folder Support
-- 프로젝트명: youtube-app
-- 테이블 접두어: youtube_app_

-- 1. 즐겨찾기 폴더 테이블
CREATE TABLE IF NOT EXISTS youtube_app_favorite_folders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  color TEXT DEFAULT '#6c757d',
  icon TEXT DEFAULT '📁',
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. 즐겨찾기 채널 테이블 (폴더 관계 추가)
CREATE TABLE IF NOT EXISTS youtube_app_favorite_channels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id TEXT NOT NULL UNIQUE,
  channel_title TEXT NOT NULL,
  channel_thumbnail TEXT,
  subscriber_count TEXT NOT NULL,
  folder_id UUID REFERENCES youtube_app_favorite_folders(id) ON DELETE SET NULL,
  sort_order INTEGER DEFAULT 0,
  added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_checked TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. 비디오 알림 테이블
CREATE TABLE IF NOT EXISTS youtube_app_video_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id TEXT NOT NULL UNIQUE,
  video_title TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  channel_title TEXT NOT NULL,
  published_at TIMESTAMPTZ NOT NULL,
  thumbnail_url TEXT NOT NULL,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  notified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 인덱스 생성 (성능 최적화)
CREATE INDEX IF NOT EXISTS idx_youtube_app_favorite_folders_sort_order
  ON youtube_app_favorite_folders(sort_order);

CREATE INDEX IF NOT EXISTS idx_youtube_app_favorite_channels_channel_id
  ON youtube_app_favorite_channels(channel_id);

CREATE INDEX IF NOT EXISTS idx_youtube_app_favorite_channels_folder_id
  ON youtube_app_favorite_channels(folder_id);

CREATE INDEX IF NOT EXISTS idx_youtube_app_favorite_channels_added_at
  ON youtube_app_favorite_channels(added_at DESC);

CREATE INDEX IF NOT EXISTS idx_youtube_app_favorite_channels_sort_order
  ON youtube_app_favorite_channels(sort_order);

CREATE INDEX IF NOT EXISTS idx_youtube_app_video_notifications_video_id
  ON youtube_app_video_notifications(video_id);

CREATE INDEX IF NOT EXISTS idx_youtube_app_video_notifications_channel_id
  ON youtube_app_video_notifications(channel_id);

CREATE INDEX IF NOT EXISTS idx_youtube_app_video_notifications_is_read
  ON youtube_app_video_notifications(is_read);

CREATE INDEX IF NOT EXISTS idx_youtube_app_video_notifications_notified_at
  ON youtube_app_video_notifications(notified_at DESC);

-- updated_at 자동 업데이트 트리거 함수
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 트리거 생성
CREATE TRIGGER update_youtube_app_favorite_folders_updated_at
  BEFORE UPDATE ON youtube_app_favorite_folders
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_youtube_app_favorite_channels_updated_at
  BEFORE UPDATE ON youtube_app_favorite_channels
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_youtube_app_video_notifications_updated_at
  BEFORE UPDATE ON youtube_app_video_notifications
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Row Level Security (RLS) 활성화 (향후 사용자 인증 연동 시 사용)
ALTER TABLE youtube_app_favorite_folders ENABLE ROW LEVEL SECURITY;
ALTER TABLE youtube_app_favorite_channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE youtube_app_video_notifications ENABLE ROW LEVEL SECURITY;

-- 임시로 모든 사용자가 모든 행에 접근 가능하도록 설정 (개발 환경)
-- 프로덕션 환경에서는 사용자별 정책으로 변경 필요
CREATE POLICY "Allow all access to favorite_folders"
  ON youtube_app_favorite_folders
  FOR ALL
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Allow all access to favorite_channels"
  ON youtube_app_favorite_channels
  FOR ALL
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Allow all access to video_notifications"
  ON youtube_app_video_notifications
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- 코멘트 추가 (테이블 설명)
COMMENT ON TABLE youtube_app_favorite_folders IS '즐겨찾기 채널을 그룹화하는 폴더';
COMMENT ON TABLE youtube_app_favorite_channels IS '사용자가 즐겨찾기한 YouTube 채널 목록';
COMMENT ON TABLE youtube_app_video_notifications IS 'YouTube 채널의 새 영상 알림 목록';

COMMENT ON COLUMN youtube_app_favorite_folders.name IS '폴더 이름';
COMMENT ON COLUMN youtube_app_favorite_folders.description IS '폴더 설명';
COMMENT ON COLUMN youtube_app_favorite_folders.color IS '폴더 색상 (hex 코드)';
COMMENT ON COLUMN youtube_app_favorite_folders.icon IS '폴더 아이콘 (emoji)';
COMMENT ON COLUMN youtube_app_favorite_folders.sort_order IS '폴더 정렬 순서';

COMMENT ON COLUMN youtube_app_favorite_channels.channel_id IS 'YouTube 채널 고유 ID';
COMMENT ON COLUMN youtube_app_favorite_channels.channel_title IS '채널 이름';
COMMENT ON COLUMN youtube_app_favorite_channels.channel_thumbnail IS '채널 썸네일 URL';
COMMENT ON COLUMN youtube_app_favorite_channels.subscriber_count IS '구독자 수 (문자열 형식)';
COMMENT ON COLUMN youtube_app_favorite_channels.folder_id IS '소속 폴더 ID (NULL이면 미분류)';
COMMENT ON COLUMN youtube_app_favorite_channels.sort_order IS '폴더 내 정렬 순서';
COMMENT ON COLUMN youtube_app_favorite_channels.added_at IS '즐겨찾기 추가 시간';
COMMENT ON COLUMN youtube_app_favorite_channels.last_checked IS '마지막으로 새 영상을 확인한 시간';

COMMENT ON COLUMN youtube_app_video_notifications.video_id IS 'YouTube 비디오 고유 ID';
COMMENT ON COLUMN youtube_app_video_notifications.video_title IS '비디오 제목';
COMMENT ON COLUMN youtube_app_video_notifications.channel_id IS '채널 고유 ID';
COMMENT ON COLUMN youtube_app_video_notifications.channel_title IS '채널 이름';
COMMENT ON COLUMN youtube_app_video_notifications.published_at IS '비디오 게시 시간';
COMMENT ON COLUMN youtube_app_video_notifications.thumbnail_url IS '비디오 썸네일 URL';
COMMENT ON COLUMN youtube_app_video_notifications.is_read IS '알림 읽음 여부';
COMMENT ON COLUMN youtube_app_video_notifications.notified_at IS '알림 생성 시간';

-- 기본 폴더 데이터 삽입 (선택사항)
INSERT INTO youtube_app_favorite_folders (name, description, color, icon, sort_order)
VALUES
  ('전체', '모든 즐겨찾기 채널', '#6c757d', '📚', 0),
  ('미분류', '폴더에 분류되지 않은 채널', '#6c757d', '📂', 999)
ON CONFLICT DO NOTHING;
