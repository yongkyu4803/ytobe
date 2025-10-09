-- YouTube App - Update existing tables to add folder support
-- 프로젝트명: youtube-app
-- 테이블 접두어: youtube_app_

-- 기존 트리거 삭제 (있으면)
DROP TRIGGER IF EXISTS update_youtube_app_favorite_folders_updated_at ON youtube_app_favorite_folders;
DROP TRIGGER IF EXISTS update_youtube_app_favorite_channels_updated_at ON youtube_app_favorite_channels;

-- 1. 폴더 테이블 생성 (없으면)
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

-- 2. 기존 채널 테이블에 폴더 관련 컬럼 추가 (없으면)
DO $$
BEGIN
  -- folder_id 컬럼 추가
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='youtube_app_favorite_channels' AND column_name='folder_id'
  ) THEN
    ALTER TABLE youtube_app_favorite_channels
    ADD COLUMN folder_id UUID REFERENCES youtube_app_favorite_folders(id) ON DELETE SET NULL;
  END IF;

  -- sort_order 컬럼 추가
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='youtube_app_favorite_channels' AND column_name='sort_order'
  ) THEN
    ALTER TABLE youtube_app_favorite_channels
    ADD COLUMN sort_order INTEGER DEFAULT 0;
  END IF;
END $$;

-- 인덱스 생성 (없으면)
CREATE INDEX IF NOT EXISTS idx_youtube_app_favorite_folders_sort_order
  ON youtube_app_favorite_folders(sort_order);

CREATE INDEX IF NOT EXISTS idx_youtube_app_favorite_channels_folder_id
  ON youtube_app_favorite_channels(folder_id);

CREATE INDEX IF NOT EXISTS idx_youtube_app_favorite_channels_sort_order
  ON youtube_app_favorite_channels(sort_order);

-- updated_at 자동 업데이트 트리거 함수 (이미 있으면 재생성)
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 트리거 생성 (기존 것 삭제 후 재생성)
CREATE TRIGGER update_youtube_app_favorite_folders_updated_at
  BEFORE UPDATE ON youtube_app_favorite_folders
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_youtube_app_favorite_channels_updated_at
  BEFORE UPDATE ON youtube_app_favorite_channels
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Row Level Security (RLS) 활성화
ALTER TABLE youtube_app_favorite_folders ENABLE ROW LEVEL SECURITY;

-- RLS 정책 생성 (없으면)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'youtube_app_favorite_folders'
    AND policyname = 'Allow all access to favorite_folders'
  ) THEN
    CREATE POLICY "Allow all access to favorite_folders"
      ON youtube_app_favorite_folders
      FOR ALL
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;

-- 코멘트 추가
COMMENT ON TABLE youtube_app_favorite_folders IS '즐겨찾기 채널을 그룹화하는 폴더';
COMMENT ON COLUMN youtube_app_favorite_folders.name IS '폴더 이름';
COMMENT ON COLUMN youtube_app_favorite_folders.description IS '폴더 설명';
COMMENT ON COLUMN youtube_app_favorite_folders.color IS '폴더 색상 (hex 코드)';
COMMENT ON COLUMN youtube_app_favorite_folders.icon IS '폴더 아이콘 (emoji)';
COMMENT ON COLUMN youtube_app_favorite_folders.sort_order IS '폴더 정렬 순서';

COMMENT ON COLUMN youtube_app_favorite_channels.folder_id IS '소속 폴더 ID (NULL이면 미분류)';
COMMENT ON COLUMN youtube_app_favorite_channels.sort_order IS '폴더 내 정렬 순서';

-- 기본 폴더 데이터 삽입 (중복 방지)
INSERT INTO youtube_app_favorite_folders (name, description, color, icon, sort_order)
SELECT '전체', '모든 즐겨찾기 채널', '#6c757d', '📚', 0
WHERE NOT EXISTS (
  SELECT 1 FROM youtube_app_favorite_folders WHERE name = '전체'
);

INSERT INTO youtube_app_favorite_folders (name, description, color, icon, sort_order)
SELECT '미분류', '폴더에 분류되지 않은 채널', '#6c757d', '📂', 999
WHERE NOT EXISTS (
  SELECT 1 FROM youtube_app_favorite_folders WHERE name = '미분류'
);
