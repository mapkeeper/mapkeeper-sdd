# Frontend Validation Record

검증일: 2026-08-17 (Asia/Seoul)

## 현재 검증 기준

| 검증 | 명령 또는 증빙 | 결과 |
|---|---|---|
| ESLint | `npm run lint` | PASS |
| strict TypeScript | `npm run typecheck` | PASS |
| Frontend 단위·컴포넌트 | `npm run test:run` | PASS — 18 files, 110 tests |
| 실제 FE·BE 계약 | `npm run test:backend-contract` | PASS — 1 file, 3 tests, 로컬 PostgreSQL 16·FastAPI |
| 프로덕션 빌드 | `npm run build` | PASS |
| 실제 브라우저 | same-origin Vite proxy → FastAPI | PASS — 공식 매장명, 리뷰 128건, UC1 `09:00-21:00` 미리보기 |
| 접근성 자동 점검 | axe WCAG 2 A·AA | PASS — violations 0 |
| 최신 원격 CI | Actions run `31945560292` | PASS — SHA `3b1b977...` |
| 최신 개발 배포 | Actions run `31946194685` | PASS — SHA `3b1b977...` |

새 `Frontend and backend contract gate`의 원격 실행은 이 브랜치의 Pull Request CI에서 확인한다. 실행 전 결과를 PASS로 기록하지 않는다.

## 실제 FastAPI 계약 회귀

CI와 로컬 회귀 테스트는 다음 순서로 동작한다.

1. PostgreSQL 16에 Alembic migration을 적용한다.
2. 공식 데모 StoreProfile `만두전골 하우스`와 마스킹 리뷰 128건을 seed한다.
3. `GEMINI_API_KEY` 없이 FastAPI를 실행해 결정적 생성 경로를 사용한다.
4. 프론트의 실제 `getReviewSummary`로 홈·UC2가 공유할 128건과 대표 리뷰 10건을 확인한다.
5. 프론트의 실제 `createStoreChangeProposal`로 UC1 응답을 받는다.
6. `{open, close}`를 `09:00-22:00` 같은 렌더링 가능한 문자열로 변환하는지 확인한다.
7. 프론트의 실제 `generateSeoDrafts`로 UC2 결과가 공식 StoreProfile·사용자 답변·허용 리뷰에 근거하는지 확인한다.

이 테스트에는 MSW나 프론트가 작성한 계약 stub이 개입하지 않는다.

## 모드별 범위

- `VITE_API_MOCKING=true`: 로컬 화면 개발용 MSW다.
- `VITE_API_MOCKING=false`: 로컬 Compose, FE·BE 계약 게이트, 배포 앱에서 실제 FastAPI를 사용한다.
- Google·Naver·Kakao 발행은 현재 `AcceptingAdapter` 시뮬레이션이며 실제 운영 플랫폼 쓰기 검증이 아니다.
- UC2 승인은 요청 Body 없이 Generation 전체에 적용하며 `draftIds`를 보내지 않는다.

## 남은 수동 검증

- 실제 브라우저 마이크 권한과 Web Speech 인식 품질
- 320·375·768px에서 주요 화면의 추가 시각 회귀 (390·1280px는 현재 브랜치에서 확인)
- 실제 Gemini 키를 사용한 응답 품질과 허용 근거 외 사실 생성 여부
- Google·Naver·Kakao 실제 운영 API 연동은 SDD 계약 개정 전까지 범위 밖
