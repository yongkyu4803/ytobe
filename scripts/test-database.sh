#!/usr/bin/env bash
set -euo pipefail
container_name="youtube-app-test-${RANDOM}-${RANDOM}"
cleanup() { docker rm -f "$container_name" >/dev/null 2>&1 || true; }
trap cleanup EXIT
docker run --name "$container_name" -e POSTGRES_PASSWORD=local-test-only -d postgres:15-alpine >/dev/null
for attempt in {1..30}; do
  if docker exec "$container_name" pg_isready -U postgres >/dev/null 2>&1; then break; fi
  sleep 1
done
docker exec "$container_name" psql -U postgres -v ON_ERROR_STOP=1 -c 'CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;' >/dev/null
docker exec -i "$container_name" psql -U postgres -v ON_ERROR_STOP=1 < migrations/create_tables.sql >/dev/null
docker exec -i "$container_name" psql -U postgres -v ON_ERROR_STOP=1 < migrations/20260907_collection_upgrade.sql >/dev/null
docker exec -i "$container_name" psql -U postgres -v ON_ERROR_STOP=1 < migrations/20260907_collection_hardening.sql >/dev/null
docker exec -i "$container_name" psql -U postgres -v ON_ERROR_STOP=1 < migrations/20260907_full_collection.sql >/dev/null
docker exec -i "$container_name" psql -U postgres -v ON_ERROR_STOP=1 < migrations/20260907_rising_videos.sql >/dev/null
docker exec -i "$container_name" psql -U postgres -v ON_ERROR_STOP=1 < tests/database.sql
