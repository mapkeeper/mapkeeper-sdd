# Frontend Validation Record

검증일: 2026-08-08 (Asia/Seoul)

## 검증 환경

- Node.js: `v24.18.0`
- npm: 프로젝트 기준 권장 버전 Node.js 24 LTS와 동일

## 명령 및 결과

| 검증 | 명령 | 결과 |
| --- | --- | --- |
| 의존성 설치 | `npm ci` | PASS |
| ESLint | `npm run lint` | PASS — warning/error 0 |
| strict TypeScript | `npm run typecheck` | PASS |
| Vitest 전체 테스트 (mock 모드) | `npm run test:run` | PASS — 20 files, 139 tests |
| Vitest 계약 전송 테스트 (MSW 비활성) | `npm run test:transport` | PASS — 1 file, 9 tests |
| 프로덕션 빌드 | `npm run build` | PASS |
| React Doctor | `npx -y react-doctor@0.9.6 --json` | PASS — errorCount 0 (경고만 존재) |
| Compose 설정 검증 | `docker compose -f workspace/compose.yaml config --quiet` | PASS |
| 컨테이너 기동 및 헤더 | `docker compose up --build -d` 후 `curl -I` | PASS — 아래 "컨테이너·헤더 검증" 참고 |

## 세 가지 연동 모드 검증

### 1. Mock 개발/배포 (기본값, `VITE_API_MOCKING=true`)

자동 통합 테스트로 검증했습니다.

- UC1: `src/features/store-change/StoreChangeWizard.test.tsx`, `src/test/mvpFlows.test.tsx` — 인식 텍스트로 구조화된 변경안 생성, 필드별 수정, 거절, 명시적 승인 버튼 클릭 후 `Idempotency-Key`가 필요한 승인 API 처리, SyncJob handoff.
- UC2: `src/features/seo/SeoGenerationWizard.test.tsx`, `src/test/mvpFlows.test.tsx` — 공통 입력(`briefText`/`seedKeywords`) 제출, Google/Naver/Kakao 3사 결과를 읽기 전용으로 표시, 재생성(새 revision으로 3사 결과 전체 교체), 거절, Generation 전체의 명시적 승인, SyncJob handoff.
- SyncJob: `src/components/SyncStatus/SyncStatus.test.tsx` — 전체 성공, 부분 성공(성공 플랫폼 보존), 재시도 가능/불가능 전체 실패, 2초 간격·60초 상한 polling, 지연 시 1회 즉시 재확인, 네트워크 오류 처리.
- 계약 경계: `src/services/api.contract.test.ts`, `src/mocks/contractMocks.test.ts` — 문서화된 성공 예시 파싱, 알 수 없는 envelope 키·최상위 `PARTIAL_SUCCESS`·잘못된 UUID/시각·구조화 Proposal 값 오류·Generation revision 누락·플랫폼 중복/누락·`attemptCount` 범위·오류 네임스페이스 혼용 거부, MSW가 정확히 10개 endpoint만 등록했는지 확인.

### 2. 로컬 mock-off contract transport (필수 검증, MSW 비활성)

`npm run test:transport`가 `node:http`로 띄운 실제 TCP 계약 stub에 `apiRequestParsed`로 UC1 생성→승인, UC2 생성→재생성→거절→승인, SyncJob 상태 조회·재시도를 요청하고, 비 JSON 응답·손상된 envelope·422·409·승인 직후 연결 끊김(status 0)·클라이언트 timeout을 검증합니다. MSW는 이 스위트에서 임포트되지 않으므로 시작조차 하지 않습니다.

수동 프록시 스모크(`npm run stub:contract` + `VITE_API_MOCKING=false npm run dev -- --host 127.0.0.1`)는 curl로 상대 경로 `/api/v1/store-change-proposals` 요청이 Vite 프록시를 거쳐 stub에 도달해 201과 올바른 envelope를 반환함을 확인했습니다. 실제 Chrome 개발자 도구 network/service-worker 패널 확인은 이번 세션에 브라우저 자동화 도구가 연결되지 않아 수행하지 못했으며, 이후 세션에서 F3 수동 QA 때 수행이 필요합니다.

### 3. 실제 백엔드 v0.2 (외부 opt-in 게이트)

**NOT RUN: health-only backend lacks v0.2 endpoints.** 현재 배포된 백엔드는 `/health`만 제공하며 v0.2의 10개 endpoint를 구현하지 않았습니다. `/health` 통과를 API 계약 완료로 해석하지 않습니다. 실제 백엔드가 준비되면 `VITE_API_BASE_URL`·`VITE_STORE_PROFILE_ID`를 설정해 별도 게이트로 검증합니다.

## 컨테이너·헤더 검증

`docker compose up --build -d` (Colima 기반 Docker)로 frontend/backend를 함께 기동한 뒤 확인했습니다.

- `curl -I http://127.0.0.1:3000/`, `/healthz`, `/assets/index-*.js`, `/mockServiceWorker.js` 모두에서 `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy: strict-origin-when-cross-origin`, `Content-Security-Policy`, `Permissions-Policy: microphone=(self), camera=(), geolocation=()` 헤더를 확인했습니다. (기존 nginx 설정은 `location`별 `add_header`가 서버 블록의 헤더 상속을 끊는 버그로 이 헤더들이 `/`, `/assets/`, `/mockServiceWorker.js` 응답에서 누락되어 있었고, 이번에 `security-headers.conf`를 각 location에 `include`하도록 고쳐 실제로 검증했습니다.)
- 캐시 헤더: `/` → `Cache-Control: no-cache`, `/assets/*` → `public, max-age=31536000, immutable`, `/mockServiceWorker.js` → `no-store`.
- `/healthz` → `200 ok`.
- HSTS는 의도적으로 추가하지 않았습니다. 외부 Nginx Proxy Manager TLS edge가 소유합니다.

## 검증 범위 주의사항

- 실제 Google/Naver/Kakao 외부 API 쓰기는 수행하지 않았습니다.
- 320/375/768 뷰포트에서의 실제 Chrome 렌더링(문서 가로 스크롤 없음, 초점 이동, 한글 제목의 음절 단위 줄바꿈 없음, reduced-motion 동작)은 이번 세션에 브라우저 자동화 도구가 연결되지 않아 시각적으로 확인하지 못했습니다. 코드 수준에서는 전역 `word-break: keep-all` + `overflow-wrap: anywhere`(App.css)를 추가했고, 고정 폭 CSS로 인한 320px 미만 오버플로우는 정적 검색으로 발견하지 못했습니다. 실제 브라우저 확인은 F3 수동 QA에서 수행합니다.
- 실제 브라우저 마이크 권한과 Web Speech 품질의 물리 마이크 수동 검증은 배포 전 HTTPS 또는 localhost 환경에서 수행해야 합니다.
- 실제 백엔드 전환은 위 "3. 실제 백엔드 v0.2" 참고 — NOT RUN.
