# Brand Pilot Database

Supabase를 기본 운영 데이터베이스로 사용합니다. Docker Compose 기반 로컬 PostgreSQL 16은 선택 사항이며 개발 및 스키마 테스트 용도로만 사용합니다.

> **주의:** 수동 SQL 적용 대신 `npm run db:migrate`를 사용합니다. 이미 스키마가 존재하지만 적용 이력이 없는 Supabase는 최초 한 번만 기준 마이그레이션을 명시해야 하며, 이 과정은 기존 SQL을 다시 실행하지 않습니다.

## Start

```powershell
docker compose up -d postgres
```

## Apply Migration

```powershell
npm run db:migrate
```

기존 Supabase가 `012_source_crawl_runs.sql`까지 이미 적용됐고 `schema_migrations`만 없는 경우에만 다음 한 번을 실행합니다.

```powershell
$env:MIGRATION_BASELINE_UP_TO="012_source_crawl_runs.sql"
npm run db:migrate
Remove-Item Env:MIGRATION_BASELINE_UP_TO
```

이후에는 `npm run db:migrate`만 실행합니다. 파일 checksum이 달라지면 실행을 중단합니다.

## Smoke Check

```powershell
docker compose exec -T postgres psql -U brand_pilot -d brand_pilot -v ON_ERROR_STOP=1 -f /smoke/001_schema_smoke.sql
```

## Connect

```powershell
docker compose exec postgres psql -U brand_pilot -d brand_pilot
```

Host connection:

```text
postgresql://brand_pilot:brand_pilot_dev@127.0.0.1:54329/brand_pilot
```

## Reset Local DB

This removes the local database volume.

```powershell
docker compose down -v
docker compose up -d postgres
```
