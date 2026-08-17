# Mapkeeper AI Frontend

5060 소상공인을 위한 매장정보 변경(UC1), 4단계 모바일 로컬 SEO 문구 생성(UC2), Google/Naver/Kakao 동기화 현황을 제공하는 React/Vite 프론트엔드입니다.

## 요구 환경

- Node.js 24 LTS
- npm
- 음성 기능 사용 시 Web Speech API를 지원하는 브라우저
- 실제 마이크 사용 시 HTTPS 또는 `localhost`, 브라우저 마이크 권한

음성은 브라우저에서 텍스트로 변환됩니다. 서버에는 `storeProfileId`, `recognizedText`, `locale`만 전송하며 원본 오디오를 전송하거나 저장하지 않습니다.

## 설치 및 실행

```bash
cd workspace/frontend
npm install
cp .env.example .env.local
npm run dev
```

개발 서버의 기본 주소는 Vite가 출력하는 로컬 URL입니다.

## MSW 모의 API로 실행

`.env.local`에서 다음 값을 사용합니다.

```dotenv
VITE_API_BASE_URL=
VITE_API_MOCKING=true
VITE_MOCK_SCENARIO=default
```

화면의 개발자 패널에서 다음 시나리오를 즉시 전환할 수 있습니다.

- `default`, `all-success`: 대기 → 처리 중 → 전체 성공
- `partial-success`: 일부 성공과 실패 플랫폼 재시도
- `retryable-failure`: 시간 초과 등 재시도 가능한 전체 실패
- `non-retryable-failure`: 권한 오류 등 재시도 불가 실패
- `slow`: 느린 API 응답
- `network-error`: 네트워크 연결 실패

MSW service worker는 로컬 개발에서만 사용하며 `VITE_API_MOCKING=false`일 때 로드되지 않습니다.
mock 모드에서는 Vite의 `/api` 백엔드 프록시가 비활성화되고, `VITE_API_BASE_URL` 값이 있더라도 API 요청은 service worker가 제어하는 same-origin `/api` 경로를 사용합니다. 미등록 `/api` 요청은 실제 네트워크로 우회하지 않고 오류로 보고됩니다.

## 두 가지 실행 모드와 실제 계약 검증

프론트엔드는 화면 개발용 MSW와 실제 FastAPI 연결을 지원합니다. 두 모드 모두 같은 서비스 함수를 사용합니다.

1. **MSW 화면 개발** — `VITE_API_MOCKING=true`. service worker가 same-origin `/api`를 가로채며 실제 네트워크로 우회하지 않습니다.
2. **실제 FastAPI 연결** — `VITE_API_MOCKING=false`. 로컬 Compose와 배포 앱이 사용하는 모드입니다.

CI의 `Frontend and backend contract gate`는 PostgreSQL 16에 migration과 공식 데모 seed를 적용하고 FastAPI를 실제로 실행합니다. 그 다음 `npm run test:backend-contract`가 프론트 프로덕션 서비스 함수로 UC1의 `{open, close}` 응답과 UC2 생성 근거를 검증합니다. MSW나 별도 계약 stub은 사용하지 않습니다.

## 실제 백엔드로 전환

```dotenv
VITE_API_BASE_URL=
VITE_API_MOCKING=false
VITE_MOCK_SCENARIO=default
VITE_STORE_PROFILE_ID=11111111-1111-4111-8111-111111111111
```

로컬 브라우저에서는 backend를 `127.0.0.1:8000`에 실행하고 `VITE_API_BASE_URL`을 비워 Vite의 same-origin `/api` proxy를 사용합니다. 절대 URL을 지정하면 backend가 해당 frontend origin을 CORS로 허용해야 합니다. 배포 환경도 frontend Nginx가 `/api`를 backend로 전달하므로 브라우저에는 same-origin으로 보입니다. 컴포넌트는 mock 모듈이나 시나리오에 따라 API 동작을 분기하지 않습니다.

백엔드는 API Contract v0.2의 공통 envelope와 다음 제품 endpoint 11개를 구현합니다. 개별 Draft PATCH·선택 승인이나 SyncJob 취소는 만들지 않습니다.

| 기능 | 메서드와 경로 | HTTP |
| --- | --- | ---: |
| UC1 생성 | `POST /api/v1/store-change-proposals` | 201 |
| UC1 수정 | `PATCH /api/v1/store-change-proposals/{proposalId}` | 200 |
| UC1 거절 | `POST /api/v1/store-change-proposals/{proposalId}/reject` | 200 |
| UC1 승인 | `POST /api/v1/store-change-proposals/{proposalId}/approve` | 202 |
| UC2 생성 | `POST /api/v1/seo/generations` | 201 |
| UC2 전체 재생성 | `POST /api/v1/seo/generations/{generationId}/regenerate` | 200 |
| UC2 전체 거절 | `POST /api/v1/seo/generations/{generationId}/reject` | 200 |
| UC2 전체 승인 | `POST /api/v1/seo/generations/{generationId}/approve` | 202 |
| SyncJob 상태 조회 | `GET /api/v1/sync-jobs/{syncJobId}` | 200 |
| SyncJob 재시도 | `POST /api/v1/sync-jobs/{syncJobId}/retry` | 202 |
| 리뷰 요약 | `GET /api/v1/store-profiles/{storeProfileId}/reviews/summary` | 200 |

## 검증 명령

```bash
npm run lint
npm run typecheck
npm run test:run
npm run build
```

실제 FastAPI 계약 검증은 backend와 PostgreSQL이 실행 중인 상태에서 수행합니다.

```bash
VITE_API_MOCKING=false \
VITE_API_BASE_URL=http://127.0.0.1:18000 \
npm run test:backend-contract
```

## 컨테이너 실행

프로젝트의 `workspace` 디렉터리에서 프론트엔드와 백엔드를 함께 실행합니다.

```bash
docker compose up --build -d
curl http://127.0.0.1:3000/healthz
```

프론트엔드는 비루트 Nginx가 8080 포트에서 정적 파일을 제공하고, 호스트의 기본 3000 포트로 연결됩니다. `/api` 요청은 같은 Compose 네트워크의 `backend:8000`으로 전달됩니다.

Vite 환경변수는 이미지 빌드 시점에 적용됩니다. 개발 배포에서는 내부 응답을 사용하되 `VITE_SHOW_DEVELOPER_TOOLS=false`로 사용자 화면에서 개발자 도구를 숨깁니다. 실제 백엔드 API로 전환할 때는 이미지를 다음 값으로 다시 빌드합니다.

```dotenv
VITE_API_BASE_URL=
VITE_API_MOCKING=false
VITE_SHOW_DEVELOPER_TOOLS=false
```

특정 테스트만 실행하려면 다음과 같이 경로를 전달합니다.

```bash
npm run test:run -- src/test/mvpFlows.test.tsx
```

## 브라우저 음성 확인

1. HTTPS 또는 `localhost`로 접속합니다.
2. “음성 인식 시작”을 누르고 마이크 권한을 허용합니다.
3. “영업시간을 밤 11시까지로 바꿔줘”처럼 현재 값과 다른 매장정보 변경을 말합니다.
4. 인식 실패 또는 권한 거부 시 큰 직접 입력 UI가 즉시 표시되는지 확인합니다.
5. 음성이나 Enter 키만으로 승인되지 않고, 최종 “승인” 버튼 클릭 후에만 동기화가 시작되는지 확인합니다.

지원되지 않는 브라우저에서도 직접 입력 fallback으로 UC1을 계속 사용할 수 있습니다.

## UC2 모바일 단계 흐름

UC2는 한 화면에 한 단계만 표시하며, 개별 Draft가 아니라 `ContentGeneration` 전체를 다룹니다.

1. **SUMMARY** — 리뷰 AI 요약, 키워드, 분석 건수 확인
2. **COMMON_INPUT** — 공통 홍보 설명(`briefText`)과 핵심 키워드(`seedKeywords`, 1~5개) 입력
3. **RESULT** — Google·Naver·Kakao 세 결과를 읽기 전용으로 확인하고 재생성·거절·승인 중 하나를 선택 (재생성은 공통 입력을 수정해 3사 결과 전체를 새 `revision`으로 교체, 승인은 Body 없이 Generation 전체를 한 번에 승인)
4. **SYNC** — 승인 후 발급된 SyncJob의 Google/Naver/Kakao 반영 상태와 재시도 확인

플랫폼별 개별 Draft 선택·수정·승인 UI는 없습니다. 승인 요청에는 `draftIds`나 `approvedPlatforms`를 보내지 않으며, `approvedPlatforms`는 서버가 승인 응답에만 포함하는 값입니다.
