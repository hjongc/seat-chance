# 데이터와 운영

이 문서는 운영자와 기여자를 위한 데이터 수집, 환경변수, 배포 확인 절차를 정리합니다.

## 데이터 흐름

1. GitHub Actions 또는 로컬에서 `npm run db:ingest`를 실행합니다.
2. `scripts/ingest-public-data.mjs`가 공공 API/CSV 소스에서 데이터를 수집합니다.
3. 수집값을 Postgres 테이블에 upsert합니다.
4. `scripts/export-transit-lines.mjs`가 `station_line_order`에서 노선/역 목록을 `public/transit-lines.json`으로 생성합니다.
5. UI는 시작 시 정적 `/transit-lines.json`을 읽고, 추천 계산 시 API를 호출합니다.
6. API는 Postgres에서 필요한 데이터를 조회해 앉을각 점수를 계산합니다.

`DATABASE_URL`이 없으면 추천 API는 실제 추천을 만들지 않습니다. 개발 편의를 위한 더미 추천 응답은 두지 않습니다.

## 주요 데이터 소스

- 서울 열린데이터광장 역별 시간대 승하차 데이터
- 서울 열린데이터광장 역 정보
- 서울교통공사 환승정보
- 서울교통공사 환승역 환승인원정보
- 서울교통공사 빠른하차정보
- 서울교통공사 열차운행현황
- 혼잡도 CSV/API 소스
- 한국 공휴일 라이브러리와 보정 로직

## 로컬 명령

```bash
npm install
npm run dev
```

데이터 수집과 정적 노선 파일 생성:

```bash
npm run db:ingest
npm run export:transit-lines
```

검증:

```bash
npm run typecheck
npm test
npm run build
```

## Vercel 환경변수

```text
DATABASE_URL
NEXT_PUBLIC_SITE_URL
PG_POOL_MAX
PG_CONNECTION_TIMEOUT_MS
PG_IDLE_TIMEOUT_MS
RECOMMENDATION_CACHE_TTL_SECONDS
HEALTH_MAX_INGESTION_AGE_HOURS
```

## GitHub Actions secrets

```text
DATABASE_URL
SEOUL_OPEN_API_KEY
SEOUL_REALTIME_SUBWAY_API_KEY
DATA_GO_KR_API_KEY
TRANSFER_CSV_URL or TRANSFER_API_URL_TEMPLATE
TRANSFER_DEMAND_CSV_URL or TRANSFER_DEMAND_API_URL_TEMPLATE
TRANSFER_DEMAND_OBSERVED_ON
FAST_EXIT_API_URL_TEMPLATE
TRAIN_OPERATION_CSV_URL or TRAIN_OPERATION_API_URL_TEMPLATE
CONGESTION_CSV_URL or CONGESTION_API_URL_TEMPLATE
TARGET_LINE_NO
INGEST_REQUEST_TIMEOUT_MS
INGEST_FETCH_ATTEMPTS
ALERT_WEBHOOK_URL
```

## GitHub Actions variables

```text
NEXT_PUBLIC_SITE_URL
```

## 보안 원칙

실제 API 키와 데이터베이스 URL은 커밋하지 않습니다. 키가 채팅, 이슈, 로그, shell history 등에 노출되면 운영 배포 전에 반드시 회전합니다.

## 배포 전 확인

1. `npm run typecheck`
2. `npm test`
3. `npm run build`
4. Vercel Preview 배포 확인
5. `/api/v1/health`와 `/api/v1/data-status` 확인
