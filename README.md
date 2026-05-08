# 앉을각

서울 지하철 노선별 좌석 회전 가능성이 높은 호차-문 위치를 추천하는 모바일 퍼스트 웹 MVP입니다.

## Data Flow

운영 데이터 경로는 하드코딩하지 않습니다.

1. GitHub Actions 또는 로컬에서 `npm run db:ingest` 실행
2. `scripts/ingest-public-data.mjs`가 공공 API/CSV 소스에서 데이터를 수집
3. 수집값을 Postgres 테이블에 upsert
4. `scripts/export-transit-lines.mjs`가 `station_line_order`에서 전체 노선/역 목록을 `public/transit-lines.json`으로 생성
5. 모바일 UI는 시작 시 정적 `/transit-lines.json`을 읽고, 추천 계산 시에만 API를 호출
6. Next.js Route Handler가 Postgres에서 조회해 추천 점수를 계산

`DATABASE_URL`이 없으면 앱 API는 추천을 만들지 않습니다. 개발 편의용 더미 추천 응답은 두지 않습니다.

## Required Sources

- `SEOUL_OPEN_API_KEY`: 서울 열린데이터광장 API 키
- `SEOUL_REALTIME_SUBWAY_API_KEY`: 서울 열린데이터광장 실시간 지하철 API 키. 현재 MVP 추천 계산에는 사용하지 않고, 실시간 열차/운행 확장 때 사용합니다.
- `DATA_GO_KR_API_KEY`: 공공데이터포털 URL 인코딩 service key
- `TRANSFER_CSV_URL` 또는 `TRANSFER_API_URL_TEMPLATE`
- `FAST_EXIT_API_URL_TEMPLATE`
- `TRAIN_OPERATION_CSV_URL` 또는 `TRAIN_OPERATION_API_URL_TEMPLATE`
- `CONGESTION_CSV_URL` 또는 `CONGESTION_API_URL_TEMPLATE`

서울 열린데이터광장 승하차 시간대 데이터는 `CardSubwayTime`, 역 정보는 `SearchSTNBySubwayLineInfo`를 사용합니다. 환승정보, 빠른하차정보, 열차운행현황, 혼잡도는 환경변수로 지정한 공공 API/CSV 소스에서 가져옵니다.

## Production Environment

Vercel project environment variables:

```text
DATABASE_URL
NEXT_PUBLIC_SITE_URL
PG_POOL_MAX
PG_CONNECTION_TIMEOUT_MS
PG_IDLE_TIMEOUT_MS
RECOMMENDATION_CACHE_TTL_SECONDS
HEALTH_MAX_INGESTION_AGE_HOURS
```

GitHub Actions secrets:

```text
DATABASE_URL
SEOUL_OPEN_API_KEY
SEOUL_REALTIME_SUBWAY_API_KEY
DATA_GO_KR_API_KEY
TRANSFER_CSV_URL or TRANSFER_API_URL_TEMPLATE
FAST_EXIT_API_URL_TEMPLATE
TRAIN_OPERATION_CSV_URL or TRAIN_OPERATION_API_URL_TEMPLATE
CONGESTION_CSV_URL or CONGESTION_API_URL_TEMPLATE
```

GitHub Actions variables:

```text
NEXT_PUBLIC_SITE_URL
```

Never commit real API keys or database URLs. If a key is exposed in chat, issue trackers, logs, or shell history, rotate it before public production launch.

## Local Commands

```bash
npm install
npm run db:ingest
npm run export:transit-lines
npm run dev
```

## API

```http
GET /transit-lines.json
GET /api/v1/stations?line_no=3
GET /api/v1/train-layout?line_no=3&direction=오금
GET /api/v1/recommendations?origin=경복궁&destination=신사&line_no=3&direction=오금&datetime=2026-05-07T08:30:00+09:00&mode=seat
GET /api/v1/health
```
