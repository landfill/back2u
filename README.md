# 찾아줘 (back2u) — 전국 유실물 찾기

경찰청 **습득물(경찰관서)** · **포털기관 습득물** 공식 API를 실시간으로 조회해 기간·지역·품목·검색어로 찾아보는 웹 서비스입니다.

- 프론트엔드: React 18 + Vite + TypeScript (`src/`)
- 백엔드: Node.js + [Hono](https://hono.dev) + TypeScript (`server/`) — 공식 API 프록시. 인증키는 서버에만 보관되고 브라우저로 노출되지 않습니다.
- 공용 타입·지역코드: `shared/`

## 사용 API

| 출처 | 엔드포인트 |
| --- | --- |
| 경찰관서 | `{LOST112_API_BASE}/LosfundInfoInqireService/getLosfundInfoAccToClAreaPd` |
| 포털기관 | `{LOST112_API_BASE}/LosPtfundInfoInqireService/getPtLosfundInfoAccToClAreaPd` |

- 기본 `LOST112_API_BASE`: `https://api.koreaconnect.kr/01/1/2603101713597416530PDP/SAFETY/1320000`
- 인증: 요청 헤더 `api_user_key_id: <LOST112_API_KEY>`
- 요청: `START_YMD`, `END_YMD`, `N_FD_LCT_CD`(상위 지역코드), `pageNo`, `numOfRows`
- 응답은 JSON·XML 모두 해석합니다 (`response.header` / `response.body.items.item`, `resultMsg`·`resultMag` 둘 다 지원).

공식 API에는 검색어 파라미터가 없으므로, 서버가 기간·지역 조건으로 목록 전체를 페이지 단위(기본 1000건)로 받아온 뒤 품목·검색어를 필터링하고 습득일 최신순으로 정렬해 페이지를 나눕니다. 같은 기간·지역 조회는 메모리에 캐시(기본 10분)되어 페이지 이동·필터 변경 시 공식 API를 다시 호출하지 않습니다. 출처별 수신 상한(기본 20,000건)을 넘으면 결과에 "일부만 수신"으로 표시됩니다.

## 로컬 개발

```bash
npm install
cp .env.example .env   # LOST112_API_KEY 입력
npm run dev            # API: http://localhost:8787, 웹: http://localhost:5173
```

## 프로덕션

```bash
npm run build          # 타입체크 + dist/ (프론트) + dist-server/ (서버)
LOST112_API_KEY=... npm start
```

서버 하나가 `/api/*`와 빌드된 프론트엔드(`dist/`)를 함께 서빙합니다. 기본 포트는 `8787`(`PORT`로 변경).

### Docker

```bash
docker build -t back2u .
docker run -p 8787:8787 -e LOST112_API_KEY=... back2u
```

## 환경 변수

| 이름 | 기본값 | 설명 |
| --- | --- | --- |
| `LOST112_API_KEY` | (필수) | koreaconnect 발급 사용자 인증키 |
| `LOST112_API_BASE` | 위 기본 URL | 서비스 경로 앞부분 |
| `LOST112_TIMEOUT_MS` | `15000` | 공식 API 1회 호출 타임아웃 |
| `LOST112_PAGE_SIZE` | `1000` | 1회 호출당 `numOfRows` |
| `LOST112_MAX_ITEMS_PER_SOURCE` | `20000` | 출처별 최대 수신 건수 |
| `LOST112_CONCURRENCY` | `4` | 동시 호출 수 |
| `LOST112_CACHE_TTL_SECONDS` | `600` | 조회 캐시 시간 |
| `LOST112_MAX_RANGE_DAYS` | `92` | 최대 조회 기간(일) |
| `PORT` / `HOST` | `8787` / `0.0.0.0` | 서버 바인딩 |

## API (서버)

- `GET /api/health` — `{ ok, apiKeyConfigured }`
- `GET /api/meta` — 지역코드 목록, 최대 조회 기간 등
- `GET /api/lost-items?START_YMD=YYYYMMDD&END_YMD=YYYYMMDD&region=LCA000&institution=경찰관서|포털기관|기관전체&category=...&keyword=...&pageNo=1&numOfRows=20`
  - `status`: `ok` | `invalid_request`(400) | `config_error`(503, 인증키 없음) | `upstream_error`(502)

## 테스트

```bash
npm test
```

공식 API를 모의 응답으로 대체해 JSON/XML 파싱, 페이지 수집, 필터, 캐시, 오류 처리를 검증합니다.

## 개인정보

목록의 괄호 속 상세 특징과 습득물 사진은 표시하지 않고 원본(LOST112) 확인을 안내합니다. 검색 조건 저장은 사용자 브라우저(localStorage)에만 저장됩니다.
