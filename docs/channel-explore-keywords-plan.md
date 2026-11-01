# 채널 탐색 · 카테고리 필터 · 인기 키워드 구현 계획

작성 2026-11-01. 참고 화면은 저장소 상위 폴더의 `image*.png` 4장(채널 필터, 카테고리 모달 2장, 주간 인기 키워드).
상태: 1~4단계 구현·운영 적용 완료(2026-11-01). 운영 방법은 `docs/database-collection.md`의 "채널 탐색·인기 키워드" 절 참고.

## 1. 목표 기능

| # | 기능 | 화면 |
| --- | --- | --- |
| A | 채널 탐색 필터 — 조회수 증감 기준(없음/1일/48시간/7일/30일), 정렬(총 조회수/구독자), 구독자 범위, 영상 수 범위, 국가(KR/US/JP/그 외) | `image.png` |
| B | 카테고리 필터 모달 — 복수 선택, 카테고리별 채널 수(많은 순), 미분류 | `image copy.png`, `image copy 2.png` |
| C | 주간 인기 키워드 TOP 100 (Shorts) — 24시간/7일 소비량, 14일 일별 흐름, 가나다순 전체 보기, 내 키워드, 수집 상태 | `image copy 3.png` |

## 2. 현재 상태 (2026-11-01 실측)

- 추적 채널 31개(전부 즐겨찾기), 영상 2,937개(60초 이하 821개), 영상 스냅샷 426,494행, 채널 스냅샷 1,743행.
- 기존 수집기 API 사용량: 하루 851~888유닛(2026-10-24~30, 실패 1건). 무료 한도 10,000유닛.
- 채널 일 단위 스냅샷이 이미 있어 조회수 증감 계산 기반은 갖춰져 있다.
- 수집기는 `channels.list`를 `snippet,statistics,contentDetails`로 호출한다. `snippet.country`는 받지만 저장하지 않고, `topicDetails`는 요청하지 않는다.
- 영상은 `snippet`으로 받으므로 제목·태그가 응답에 있지만 태그는 저장하지 않는다.

**한계:** 참고 화면 서비스는 채널 수백만 개를 보유한다. 무료 한도로는 불가능하므로 아래처럼 범위를 정한다.

## 3. 범위 결정

### 3.1 채널 풀: 최대 20,000개, KR·US·JP 우선

| 항목 | 결정 | 이유 |
| --- | --- | --- |
| 규모 | 상한 20,000개. 30일 안에 약 1만 개 도달 목표 | 하루 통계 갱신 400유닛으로 유지 가능 |
| 최소 조건 | 구독자 1,000명 이상(비공개 구독자 수는 포함) | 의미 없는 소규모 채널로 풀이 차는 것 방지 |
| 국가 | 탐색 수집은 KR·US·JP. `country`가 없거나 다른 채널은 "그 외" | 화면의 국가 버튼과 일치 |
| 갱신 | 탐색 채널은 **채널 통계만 하루 1회**. 영상은 수집하지 않음 | 영상 수집(업로드 목록 조회)은 채널당 비용이 들어 2만 개에 적용 불가 |
| 즐겨찾기 | 기존 3시간 주기·영상 추적 그대로 | 기존 흐름과 분리 |

채널을 찾는 경로는 아래 3가지다.

1. **인기 차트** `videos.list chart=mostPopular` × 국가 3개 × 지정 가능한 카테고리 × 최대 4페이지. 요청당 1유닛. 결과 영상의 채널을 등록한다.
2. **채널 검색** `search.list type=channel regionCode=…` 하루 10회(1,000유닛). 카테고리별 시드 키워드를 돌아가며 사용하고, 한 번에 50개 후보를 얻는다.
3. **앱 사용 중 발견**: 키워드 검색·인기 추천 화면에서 이미 받아온 채널을 등록한다. 추가 비용이 없다.

> 기존 운영 문서의 "검색 결과의 모든 채널을 추적하지 않는다" 원칙은 이 계획으로 바뀐다. 탐색 채널은 통계만 추적하고, 알림·영상 수집 대상이 아니라는 점을 문서에 반영한다.

### 3.2 카테고리: YouTube 토픽 + 한국어 라벨

- `channels.list part`에 `topicDetails`를 추가한다. `topicCategories`(위키백과 URL)를 슬러그로 정규화해 `topic_ids text[]`로 저장한다(추가 비용 없음).
- 토픽이 없는 채널은 "미분류"로 둔다. 상위 토픽(Music, Gaming, Sports, Entertainment, Lifestyle, Society, Knowledge)과 하위 토픽을 모두 표시한다.
- 한국어 라벨 매핑은 코드 상수(`utils/topics.ts`)로 둔다. 예: `Lifestyle_(sociology)`→라이프스타일, `Video_game_culture`→비디오 게임 문화, `Music_of_Asia`→아시아 음악, `Mixed_martial_arts`→격투기, `Physical_attractiveness`→신체적 매력.
- 복수 선택은 **선택한 카테고리 중 하나라도 포함**(`topic_ids && 선택 배열`)으로 처리한다. 화면 안내 문구와 같은 의미다.

### 3.3 키워드: 한국(KR) 채널 Shorts 안에서의 순위

| 항목 | 결정 |
| --- | --- |
| 대상 영상 | KR 채널(탐색 풀 + 즐겨찾기)이 최근 30일 안에 올린 3분(180초) 이하 영상 |
| Shorts 수집 | 최근 7일 조회수 증가가 큰 KR 채널 상위 800개의 업로드 목록 첫 페이지만 하루 1회 조회(800유닛) + 신규 영상 상세(50개당 1유닛) |
| 영상 통계 | 게시 후 30일 이내 Shorts만 하루 1회 갱신(약 400유닛) |
| 키워드 추출 | ① 제목·태그의 해시태그 ② `snippet.tags` ③ 제목의 2글자 이상 한글/영문 토큰. 소문자 정규화, 불용어(`shorts`, `쇼츠`, `fyp` 등) 제외 |
| 노출 조건 | 하루 기준 2개 이상 채널에 등장한 키워드만 일별 집계에 저장하고, 순위 기간 합계 영상 수 3개 이상만 노출(한 채널의 태그 반복 방지) |
| 제목 단어 정제 | `하는·없는·만든`처럼 `는/던/든/된`으로 끝나는 한글 제목 단어와 `이유·방법·순간·vs` 같은 제목 상투어 제외. 해시태그·태그는 제작자가 고른 값이라 불용어만 제외 |
| 소비량 | 해당 키워드를 가진 영상들의 **일별 조회수 증가량 합계**. 24시간 = 최신 하루, 7일 = 최근 7일 합 |
| 일별 흐름 | 최근 14일 `keyword_daily` 값. 이력이 없는 날은 빈칸(0으로 채우지 않음) |

YouTube 전체 키워드 순위가 아니라 "수집 풀 안의 순위"라는 점을 화면 부제에 표기한다. 3분 길이 기준은 일반 짧은 영상도 포함하므로, 이후 `youtube.com/shorts/{id}` 응답으로 Shorts 여부를 확인하는 보정을 검토한다(할당량 비용 없음).

### 3.4 할당량 예산 (하루, 태평양 시간 자정 리셋)

| 항목 | 유닛 |
| --- | --- |
| 기존 즐겨찾기 수집 | 약 900 |
| 인기 차트 탐색 | 약 150 |
| 채널 검색 탐색 (10회) | 1,000 |
| 탐색 채널 통계 2만 개 | 400 |
| KR Shorts 업로드 조회 (800채널) | 800 |
| Shorts 상세·통계 갱신 | 약 450 |
| **수집 합계** | **약 3,700** |
| 화면 검색용 여유 (`search.list` 약 60회) | 약 6,300 |

수집 작업 합계가 하루 4,500유닛을 넘으면 채널 검색 탐색부터 자동으로 줄인다. 할당량 오류가 나면 기존 규칙대로 24시간 뒤 재시도한다.

### 3.5 조회수 정체 감지 (화면의 초록 안내문)

직전 스냅샷과 총 조회수가 같고 구독자·영상 수 중 하나는 바뀐 채널, 또는 조회수가 2일 연속 같은 채널에 `stale` 표시를 붙인다. 1일 기준을 고르면 "48시간 이상 권장" 안내를 띄운다. 정체 값은 증감 0으로 계산하지 않고 "갱신 안 됨"으로 표시한다.

## 4. 데이터 변경

```sql
-- youtube_app_channels 확장
ALTER TABLE youtube_app_channels
  ADD COLUMN country text,                 -- snippet.country (ISO 3166-1)
  ADD COLUMN topic_ids text[] NOT NULL DEFAULT '{}',
  ADD COLUMN source text NOT NULL DEFAULT 'favorite' CHECK (source IN ('favorite','discovered')),
  ADD COLUMN discovered_via text,          -- chart / search / app
  ADD COLUMN stats_next_at timestamptz,    -- 탐색 채널 일일 통계 갱신 예정
  ADD COLUMN hidden_subscriber boolean;
CREATE INDEX ON youtube_app_channels USING gin (topic_ids);
CREATE INDEX ON youtube_app_channels (country, subscriber_count DESC);

-- 영상 확장
ALTER TABLE youtube_app_videos
  ADD COLUMN tags text[],
  ADD COLUMN is_short_candidate boolean GENERATED ALWAYS AS (duration_seconds <= 180) STORED;

-- 신규
youtube_app_explore_runs   (id, job, started_at, finished_at, status, api_requests, items, error_code)
youtube_app_video_keywords (video_id, keyword, PRIMARY KEY(video_id, keyword))
youtube_app_keyword_daily  (keyword, day date, view_gain bigint, video_count int, channel_count int, PRIMARY KEY(keyword, day))
youtube_app_saved_keywords (keyword PRIMARY KEY, created_at)

-- 뷰/RPC
youtube_app_channel_view_deltas  -- 채널별 최신 대비 1/2/7/30일 전 조회수 차이, stale 여부
youtube_app_topic_counts()       -- 현재 필터 조건에서 토픽별 채널 수
youtube_app_aggregate_keywords(p_day date)  -- 하루치 keyword_daily 재계산(멱등)
```

- 기존 규칙 유지: 접두어 `youtube_app_`, 브라우저는 읽기만, 쓰기는 service role 또는 세션 확인 서버 API.
- 탐색 채널 스냅샷은 기존 `youtube_app_channel_metric_snapshots`에 그대로 쌓는다. 하루 최대 2만 행이므로 **탐색 채널 스냅샷은 60일 보관** 정책을 함께 도입한다(즐겨찾기 이력은 보관 기간 없음 유지).
- 즐겨찾기 삭제 트리거는 채널 행을 지우지 않으므로, 즐겨찾기에서 빠진 채널은 `source='discovered'`로 바꿔 탐색 풀에 남긴다.

## 5. 수집 구성

새 Edge Function `youtube-app-explore`로 분리한다. 기존 `youtube-app-sync`가 실패해도 탐색이 멈추지 않고, 반대도 마찬가지다.

| Cron | 주기 (KST) | 작업 |
| --- | --- | --- |
| `youtube-app-explore-discover` | 매일 17:30 (PT 리셋 직후) | 인기 차트 + 채널 검색 → 신규 채널 등록 |
| `youtube-app-explore-stats` | 10분마다 | `stats_next_at` 도래 채널 1,000개(20회 호출) 통계·국가·토픽 갱신. PostgREST가 RPC 결과를 1,000행으로 자르므로 1회 상한도 1,000 |
| `youtube-app-explore-shorts` | 10분마다 | KR 상위 채널 100개씩 업로드 첫 페이지 → 신규 영상 상세, 30일 이내 Shorts 통계 갱신 |
| `youtube-app-keywords` | 매일 08:00 | `youtube_app_aggregate_keywords(어제)` |

호출 1회당 12초 타임아웃, 배치 단위 트랜잭션, `explore_runs`에 호출 수 기록 등 기존 수집기 규칙을 따른다.

## 6. 화면

| 경로 | 내용 |
| --- | --- |
| `/channels` (메뉴 "채널 탐색") | A 필터 패널 + B 카테고리 모달 + 결과 표(채널, 국가, 카테고리, 구독자, 영상 수, 총 조회수, 선택 기간 증감, 즐겨찾기 추가 버튼) |
| `/keywords` (메뉴 "인기 키워드") | 주간 Top 100 / 내 키워드 탭, 24시간·7일 전환, 가나다 전체 보기, 일별 SVG 스파크라인, 수집 상태·마지막 업데이트 |
| `/keywords/[keyword]` | 해당 키워드 영상 목록(24시간/7일) |

- API: `GET /api/channels/search`(필터·정렬·페이지네이션, 서버에서 쿼리 조립), `GET /api/channels/topics`, `GET /api/keywords`, `POST/DELETE /api/keywords/saved`(세션 필요).
- 기간을 고르면 정렬이 자동으로 "조회수 증감"으로 바뀐다(화면 문구와 동일).
- 이력이 기간보다 짧은 채널은 증감 칸을 "이력 수집 중"으로 표시하고 정렬에서 뒤로 보낸다.
- 스타일은 기존 Bootstrap + `styles/gqai-tokens.css`를 따른다. 차트 라이브러리는 추가하지 않는다.

## 7. 단계와 완료 조건

| 단계 | 작업 | 완료 조건 |
| --- | --- | --- |
| 1 | 마이그레이션(컬럼·테이블·뷰), 기존 수집기에 `country`·`topicDetails`·`tags` 저장 추가 | 즐겨찾기 31개 채널에 국가·토픽 채워짐, 기존 테스트 통과 |
| 2 | `youtube-app-explore` 함수 + discover/stats cron | 7일 뒤 탐색 채널 3,000개 이상, 하루 수집 합계 4,500유닛 이하 |
| 3 | `/channels` 화면(A+B) | 1일/48시간/7일 필터 동작, 카테고리 수 집계가 실제 행 수와 일치 |
| 4 | Shorts 수집 + 키워드 추출·집계 + `/keywords` | 7일 이력 쌓인 뒤 TOP 100 노출, 14일 흐름 표시 |
| 5 | 보관 정책, 운영 문서(`database-collection.md`) 갱신, 상태 점검 SQL 추가 | 보관 작업 1회 실행 확인 |

30일 기준 증감은 2단계 시작 후 30일이 지나야 모든 채널에 값이 생긴다. 그전에는 "이력 수집 중"으로 표시한다.

## 8. 테스트

- 단위(`tests/*.test.mjs`): 토픽 URL 정규화·라벨 매핑, 키워드 추출(해시태그·불용어·정규화), 정체 감지 판정.
- DB(`npm run test:db`): 증감 뷰의 기간 경계·NULL 처리, 토픽 카운트, 키워드 집계 멱등성(같은 날 두 번 실행해도 동일).
- 운영: 첫 주 매일 `explore_runs` 유닛 합계와 실패 코드 확인.

## 9. 위험과 대응

| 위험 | 대응 |
| --- | --- |
| 할당량 초과로 화면 검색 불가 | 수집 합계 4,500 상한, 초과 시 검색 탐색부터 축소 |
| 탐색 풀이 특정 카테고리에 쏠림 | 채널 검색 시드를 카테고리×국가로 순환, 카테고리별 채널 수 모니터링 |
| 3분 기준이 일반 영상 포함 | 4단계 이후 `/shorts/` URL 확인으로 보정 |
| DB 용량 증가 | 탐색 스냅샷 60일 보관, 영상은 KR Shorts 30일 이내만 통계 갱신 |
| 공유 Supabase 프로젝트 영향 | 앱 전용 cron·함수 이름만 사용, 마이그레이션은 linked query로 해당 파일만 적용 |
