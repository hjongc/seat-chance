# API 문서

앉을각 API는 Next.js Route Handler로 제공됩니다. 추천 계산에는 명시적인 `day_type`과 `time_slot` 입력을 권장합니다.

## 추천 요청

```http
GET /api/v1/recommendations?origin=경복궁&destination=신사&line_no=3&direction=오금&day_type=WEEKDAY&time_slot=08:30&mode=seat
```

### Query Parameters

| 이름 | 필수 | 설명 |
|---|---:|---|
| `origin` | 예 | 승차역 이름 |
| `destination` | 예 | 하차역 이름 |
| `line_no` | 예 | 호선 번호 또는 노선 코드 |
| `direction` | 아니오 | 방향명. 없으면 역 순서로 추론합니다. |
| `day_type` | 조건부 | `WEEKDAY` 또는 `WEEKEND`. `datetime`을 쓰지 않을 때 필요합니다. |
| `time_slot` | 조건부 | `HH:00` 또는 `HH:30`. `datetime`을 쓰지 않을 때 필요합니다. |
| `datetime` | 조건부 | ISO 날짜/시간. 기존 클라이언트 호환용입니다. |
| `mode` | 아니오 | 현재는 `seat`만 지원합니다. |

`day_type`과 `time_slot`을 보내지 않는 기존 클라이언트를 위해 `datetime`도 호환용으로 지원합니다.

```http
GET /api/v1/recommendations?origin=경복궁&destination=신사&line_no=3&direction=오금&datetime=2026-05-07T08:30:00+09:00&mode=seat
```

`datetime`은 한국 시간 기준으로 해석하며, 한국 공휴일은 `WEEKEND`로 매핑합니다.

### Response

```json
{
  "origin": "경복궁",
  "destination": "신사",
  "line_no": "3",
  "direction": "오금",
  "day_type": "WEEKDAY",
  "time_slot": "08:30",
  "recommendations": [
    {
      "rank": 1,
      "car_no": 2,
      "door_no": 3,
      "score": 82.4,
      "grade": "HIGH",
      "expected_seat_window": "종로3가~충무로",
      "reasons": [
        "종로3가 하차/환승 흐름과 직접 맞아 좌석 회전 신호가 큽니다."
      ]
    }
  ],
  "cautions": [
    "앉을각 점수는 실제 착석 확률이 아니라 동일 경로 내 상대 추천 점수입니다."
  ],
  "train_layout": {
    "line_no": "3",
    "direction": "오금",
    "car_count": 10,
    "doors_per_car": 4,
    "source": "서울교통공사_열차운행현황 + 수동검증",
    "confidence": 0.9
  }
}
```

## 노선과 역 목록

정적 파일:

```http
GET /transit-lines.json
```

DB 기반 API:

```http
GET /api/v1/stations?line_no=3
```

## 열차 레이아웃

```http
GET /api/v1/train-layout?line_no=3&direction=오금
```

## 데이터 상태

```http
GET /api/v1/data-status
GET /api/v1/health
```

`/api/v1/data-status`는 사용자 화면이나 운영 확인에서 데이터 준비 상태를 볼 때 사용합니다. `/api/v1/health`는 배포와 모니터링용 상태 확인에 사용합니다.

## 에러

입력 오류는 `400`, 데이터베이스 설정이나 스키마 문제는 `503`, 예상하지 못한 서버 오류는 `500`으로 응답합니다.
