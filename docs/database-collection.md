# 개인용 YouTube 수집 DB 운영

2026-09-07 적용. 사용자 인증·사용자별 테이블 분리는 추가하지 않았다. 기존 폴더/즐겨찾기/알림을 유지하고, 저장된 콘텐츠와 수집 이력을 추가했다. Supabase 프로젝트를 다른 앱과 공유하므로 모든 객체는 `youtube_app_` 접두어를 사용한다.

## 데이터 구조

| 테이블 | 역할 / 핵심 키 |
| --- | --- |
| `youtube_app_favorite_folders` | 기존 폴더. 삭제하면 소속 채널은 미분류로 남음 |
| `youtube_app_favorite_channels` | 기존 즐겨찾기. `channel_id` 고유, 구독자 수 `BIGINT NULL`, 폴더/정렬 순서 유지 |
| `youtube_app_video_notifications` | 기존 알림. `video_id` 고유, 채널 FK 추가 |
| `youtube_app_channels` | 채널 메타데이터, 최신 수치, 마지막 시도/성공, 다음 수집, 연속 실패 횟수 |
| `youtube_app_videos` | 영상 메타데이터, 최신 수치와 해당 영상의 실제 수집 시각 |
| `youtube_app_sync_runs` | 채널별 실행 로그: running/success/failed/cancelled, API 호출 수, 저장/알림 건수, 오류 코드 |
| `youtube_app_channel_metric_snapshots` | 채널별 UTC 하루 버킷의 첫 실제 측정값 |
| `youtube_app_video_metric_snapshots` | 영상별 UTC 3시간 버킷의 첫 실제 측정값 |

`youtube_app_video_growth` 뷰는 연속된 실제 측정 시각 간 조회수 증가량, 경과시간, 시간당 증가량을 제공한다. `youtube_app_channel_growth`는 구독자 증가량과 증가율을 제공한다. 이전 측정이 없거나 분모가 0인 경우 결과는 NULL이다. 측정 간격을 임의로 24시간으로 간주하지 않으며, 조회수 감소도 그대로 표시한다.

`youtube_app_rising_videos` 뷰는 현재 즐겨찾기 채널의 최근 30일 영상을 대상으로 한다. 최근 8시간 안의 실제 관측 구간이 있고, 영상별 측정값이 둘 이상인 경우만 반환한다. 시간당 조회수, 구독자 1,000명당 조회 속도, 채널별 중앙 조회 속도 대비 배율, 공개 후 경과 시간을 합산한 점수로 정렬한다.

숫자는 음수를 허용하지 않는다. 미수집/비공개 수치는 NULL, 실제 0은 0이다. 이력은 최초 자동 수집부터 시작한다. 기존 알림으로부터 복원한 영상에는 과거 통계를 만들어 넣지 않는다.

## 수집 방식

- Supabase Cron: `youtube-app-collection`, `*/5 * * * *` (5분마다 실행).
- Edge Function: `youtube-app-sync`. 실행마다 수집 시각이 도래한 채널을 최대 3개 처리한다.
- 즐겨찾기의 `전체 수집`은 채널 목록을 작업으로 고정한 뒤 3개씩 처리하고 채널 사이에 0.5초 간격을 둔다. 화면을 닫아도 5분 크론이 활성 작업을 우선 이어서 처리한다. 일시 실패는 전체 1회 재시도하며 할당량 오류는 즉시 재시도하지 않는다.
- 대상: 현재 즐겨찾기 채널과 최근 30일에 게시된 공개 영상. 검색 결과의 모든 채널을 추적하지 않는다.
- 채널별 성공 후 다음 수집은 3시간 뒤. 채널 수가 늘면 대기열 처리 때문에 실제 간격은 길어질 수 있다.
- 채널 API의 uploads playlist와 `playlistItems.list`를 사용한다. 수집기는 비용이 큰 검색 API를 사용하지 않는다.
- 최대 100페이지/5,000개 업로드를 검사한다. 한도까지 확인해도 30일 경계에 도달하지 못하면 실패 처리한다. 일부 결과로 성공 시각을 갱신하지 않는다. 실제 첫 수집에서 SBS Entertainment 644개 영상 처리를 확인했다.
- 영상 상세 요청은 최대 50개 ID씩 묶는다. 호출별 12초 타임아웃을 둔다.
- 초기 수집은 최근 30일까지만 확인한다. 그보다 오래된 미확인 알림을 소급 복구하지 않는다.
- 이미 저장한 영상은 추적 기간을 지나도 보존한다. 해당 영상의 수치는 `collected_at` 이후 갱신되지 않을 수 있다. 채널의 `last_success_at`과 영상별 수집 시각은 별개다.
- 현재 자동 삭제/보관기간 만료 작업은 없다. 데이터 규모를 측정한 뒤 보관 정책을 별도 결정한다.

## 동시 실행과 실패

DB의 `FOR UPDATE SKIP LOCKED`와 채널별 running 상태 고유 인덱스로 중복 수집을 막는다. 10분이 지난 실행은 만료 처리하며, 만료된 실행은 결과를 저장할 수 없다.

`youtube_app_finish_sync`가 채널·영상·스냅샷·알림·성공 시각을 하나의 트랜잭션으로 저장한다. 오류 발생 시 모두 취소되므로 실패가 성공처럼 기록되지 않는다. 같은 시간 버킷의 재실행은 이력을 중복 생성하지 않는다. 응답만 유실된 경우에는 실행 ID로 DB의 최종 상태를 다시 확인한다.

일반 오류는 15/30/60/120/180분 간격으로 재시도한다. YouTube 할당량 초과는 24시간 뒤 재시도한다. 실패한 API 요청도 호출 수에 포함한다. 기존 성공 데이터는 유지하며 오류 코드는 실행 이력에 남긴다.

알림은 현재 즐겨찾기 기간에 처음 발견되고 즐겨찾기 추가 이후 게시된 영상에서만 생성한다. 늦게 공개된 영상은 이전 성공 시각보다 게시 시각이 이르더라도 최초 발견 시 알림을 만들며, 채널을 삭제했다가 다시 추가한 경우 미구독 기간 영상은 알리지 않는다. 영상 열람은 수집 커서를 갱신하지 않는다. 즐겨찾기 삭제와 해당 채널 알림 삭제는 DB 트리거로 함께 처리하며, 수집한 영상/통계는 유지한다.

## 앱 연결

`/api/channel-videos`는 수집이 완료된 채널의 영상을 DB에서 읽고 원본 응답 형태로 변환한다. 최초 수집 대기 채널에 한해 기존 YouTube 실시간 조회를 사용한다. DB 조회 실패는 오류로 표시하며, 빈 결과로 오인하지 않는다.

즐겨찾기 화면에서 수집 현황·마지막 수집 시각을 확인할 수 있다. `수집 실행`은 예정 시각이 도래한 다음 3개 채널을 처리한다. 모든 채널의 수집 주기를 강제로 초기화하는 버튼은 아니다. 자동 수집은 웹 서버나 브라우저가 꺼져 있어도 Supabase에서 계속된다.

웹 배포에는 서버 전용 `YOUTUBE_APP_SYNC_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`, `YOUTUBE_APP_PASSWORD`를 설정한다. 비밀번호 확인 후 발급한 HttpOnly 세션이 있어야 폴더·즐겨찾기·알림 변경과 수동 수집을 실행할 수 있다. 브라우저는 기존 데이터를 직접 조회할 수 있지만 테이블에 직접 쓸 수 없다. 예약 수집에는 웹 호스팅의 환경변수가 필요하지 않으며 서비스 역할 키는 클라이언트 번들에 포함하지 않는다.

Vercel에서 `YOUTUBE_APP_PASSWORD`를 변경하면 새 배포를 실행해야 반영된다. 길이 제한은 두지 않지만 16자 이상의 고유한 값을 권장한다.

## 설정과 적용 기록

원본 적용 파일:

1. `migrations/20260907_collection_upgrade.sql` — 데이터 타입, 테이블, 함수, 뷰와 접근 권한.
2. `migrations/20260907_collection_schedule.sql` — Cron/pg_net dispatch.
3. `migrations/20260907_collection_hardening.sql` — 익명 쓰기 차단, 전역 실행 한도, 알림·커밋 복구 보완.
4. `migrations/20260907_full_collection.sql` — 재개 가능한 전체 수집 작업과 진행 상태.
5. `migrations/20260907_rising_videos.sql` — 즐겨찾기 채널의 급상승 영상 순위 뷰.

공유 프로젝트 전체에 `db reset`이나 무차별 migration push를 실행하지 않는다. 이번 파일만 CLI의 linked query로 적용했다. 첫 번째 파일은 일회성 마이그레이션이므로 운영 DB에 재실행하지 않는다.

```sh
supabase link --project-ref rxwztfdnragffxbmlscf
# 최초 설치 시에만, 백업과 검증 후 실행
supabase db query --linked --file migrations/20260907_collection_upgrade.sql
node scripts/configure-collection.cjs
supabase functions deploy youtube-app-sync --project-ref rxwztfdnragffxbmlscf --use-api
supabase db query --linked --file migrations/20260907_collection_schedule.sql
```

설정 스크립트는 앱 전용 Edge secrets `YOUTUBE_APP_API_KEY`, `YOUTUBE_APP_SYNC_SECRET`과 Vault의 `youtube_app_sync_url`, `youtube_app_sync_token`만 관리한다. 다른 앱의 키를 덮어쓰지 않는다. 토큰은 소스에 포함하지 않으며, 비밀 값이 들어간 임시 파일은 처리 후 삭제한다. JWT 검증 대신 충분히 긴 전용 작업 토큰을 함수 내부에서 검증한다. 수집 RPC는 service_role만 실행할 수 있고, 모든 앱 테이블은 브라우저에서 읽기만 가능하다. 폴더·즐겨찾기·알림 쓰기는 개인 세션을 확인하는 서버 API가 service role로 수행한다.

## 점검 명령

```sh
npm test
npm run test:db  # Docker의 별도 PostgreSQL 15 컨테이너에서 실행 후 자동 삭제
npx tsc --noEmit
npm run build
supabase db query --linked --file scripts/collection-health.sql
npm run collect  # 로컬 비밀 설정으로 수집 예정 채널의 다음 배치 실행
```

`cron.job_run_details` 성공은 HTTP 요청 등록 성공을 뜻한다. 실제 수집 결과는 `youtube_app_sync_runs`와 채널의 `last_error`를 함께 확인한다. 필요하면 dispatch가 반환한 요청 ID로 `net._http_response`의 HTTP 상태를 확인한다. 요청 헤더/비밀 값은 출력하지 않는다.

기존 7개 폴더·30개 즐겨찾기·52개 알림을 저장소 밖의 권한 제한 파일에 백업하고, 별도 PostgreSQL 15에 복원하여 마이그레이션을 사전 검증했다. 운영 적용 직후에도 모든 기존 필드 값을 대조했다(구독자 수는 타입만 변환). 이후 수집에 따른 최신 정보 갱신과 새 알림 추가는 정상적인 변경이다.

첫 수집 완료: 30개 채널 성공, 영상/영상 통계 1,062개, 채널 통계 30개. 기존 알림 52개에 미확인 영상 알림 1,033개가 추가되어 총 1,085개가 되었다. 초기 500개 제한으로 발생한 실패 1건은 한도 조정 후 성공했으며, 실패 기록은 진단을 위해 보존했다. Cron 실제 실행 성공 및 pg_net dispatch HTTP 200을 확인했다.

## 중지와 복구

수집에 문제가 있으면 먼저 이 앱의 예약만 중지한다. 다른 앱의 Cron이나 Edge Function을 건드리지 않는다.

```sql
SELECT cron.unschedule('youtube-app-collection');
```

실행 중인 수집이 끝났는지 확인하고 신규 테이블과 기존 데이터 모두를 백업한다. 수집 코드 문제는 Edge Function을 검증된 버전으로 되돌린 뒤 재배포한다. 스키마를 즉시 삭제할 필요는 없다. 재개할 때는 schedule 마이그레이션으로 해당 앱의 예약을 복원한다.

원본 데이터 백업 위치: `~/.codex/backups/youtube-app/before-db-upgrade-20260907.json`. 백업을 운영에 덮어쓰면 이후 추가한 즐겨찾기·폴더·알림이 사라질 수 있으므로, 먼저 별도 DB로 복원해 현재 데이터와 대조한다. 개인 콘텐츠가 포함된 백업은 Git에 넣지 않는다.

## 공식 참고

- [Supabase 예약 Edge Functions](https://supabase.com/docs/guides/functions/schedule-functions)
- [Supabase Cron](https://supabase.com/docs/guides/cron)
- [YouTube playlistItems.list](https://developers.google.com/youtube/v3/docs/playlistItems/list)
