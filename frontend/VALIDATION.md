# Frontend Validation Record

검증일: 2026-08-05 (Asia/Seoul)

## 검증 환경

- Node.js: `v22.23.1`
- npm: `10.9.8`
- 프로젝트 기준 권장 버전: Node.js 20 LTS

현재 실행 환경은 권장 버전보다 높은 Node.js 22입니다. 아래 자동 검증은 모두 성공했지만, 배포 파이프라인에서는 Node.js 20 LTS로 동일 명령을 한 번 더 실행하는 것을 권장합니다.

## 명령 및 결과

| 검증 | 명령 | 결과 |
| --- | --- | --- |
| 의존성 설치 | `npm install --ignore-scripts` | PASS — up to date |
| ESLint | `npm run lint` | PASS — warning/error 0 |
| strict TypeScript | `npm run typecheck` | PASS |
| Vitest 전체 테스트 | `npm run test:run` | PASS — 17 files, 70 tests |
| 프로덕션 빌드 | `npm run build` | PASS |

빌드 산출물:

- `dist/index.html`: 0.44 kB
- CSS bundle: 11.60 kB
- JavaScript bundle: 219.66 kB

## Mock Quickstart 검증

### UC1 — 음성/직접 입력 매장정보 변경

자동 통합 테스트 `src/test/mvpFlows.test.tsx`에서 다음 흐름을 검증했습니다.

1. 직접 입력으로 변경안 생성
2. DRAFT 검토
3. 승인 단계 이동
4. 명시적 승인 버튼 클릭
5. `Idempotency-Key`가 필요한 승인 API 처리
6. `job-001` SyncJob handoff

Web Speech API의 지원 감지, `ko-KR`, 네 상태, cleanup, 원본 오디오 미전송은 `src/hooks/useSpeechRecognition.test.ts`에서 별도로 검증했습니다.

### UC2 — 리뷰 기반 플랫폼별 SEO 생성

자동 통합 테스트 `src/test/mvpFlows.test.tsx`에서 다음 흐름을 검증했습니다.

1. 마스킹 리뷰 선택
2. Google/Naver/Kakao 초안 생성
3. 선택된 DRAFT 검토
4. 승인 단계 이동
5. 명시적 승인 버튼 클릭
6. `job-001` SyncJob handoff

### SyncJob 시나리오

MSW를 사용해 다음 시나리오를 검증했습니다.

- 전체 성공
- 부분 성공과 성공 플랫폼 보존
- 재시도 가능한 전체 실패
- 재시도 불가능한 권한 실패
- 서버 재시작 후 FAILED 보고
- 네트워크 오류 안내

## 검증 범위 주의사항

- 실제 Google/Naver/Kakao 외부 API 쓰기는 수행하지 않았습니다.
- 실제 브라우저 마이크 권한과 Web Speech 품질은 자동화된 호환 계층으로 검증했으며, 물리 마이크 수동 검증은 배포 전 HTTPS 또는 localhost 환경에서 수행해야 합니다.
- 실제 백엔드 전환은 API 계약과 환경 스위치를 검증한 상태이며, 운영 백엔드 연결 검증은 별도 배포 환경에서 수행해야 합니다.
