# MapKeeper 주요 설계 결정 기록

> 문서 역할: 결정 배경을 설명하는 참고 자료
> 상태: **Informative / current decisions**
> 기준 코드: `2026-08-17 current working tree` (base `12687c2ed099cc6369d45b59791fa3ca62ea106d`)
> 최종 대조일: `2026-08-17`

## 1. UC2 승인 단위

### 결정

Google·Naver·Kakao Draft를 개별 선택하지 않고 `ContentGeneration` 전체를 승인한다.

### 이유

- 플랫폼별 선택 UI가 사용자의 판단 부담을 키운다.
- Generation·DB·승인 API의 상태 단위를 하나로 유지할 수 있다.
- 전체 승인 요청에서 `draftIds`가 필요하지 않다.

## 2. UC2 입력을 인터뷰로 구성

### 결정

직접 `briefText`와 키워드 목록을 작성하게 하기보다, 질문에 답하면 시스템이 API 입력으로 구성한다.

### 이유

- 소상공인이 마케팅 용어를 직접 작성하지 않아도 된다.
- 음성과 텍스트를 같은 질문 흐름에서 사용할 수 있다.
- 리뷰 요약 키워드를 재사용해 홈과 홍보 화면의 맥락을 연결할 수 있다.

### 결과

- API 계약의 `briefText`·`seedKeywords`는 유지한다.
- UI 계약은 직접 편집 컴포넌트에서 인터뷰 기반 구성으로 변경한다.

## 3. 소개글과 새소식 분리

### 결정

`ContentPurpose`를 `INTRODUCTION`, `NEWS`로 구분한다.

### 이유

- 새소식이 일반 매장 소개글로 생성되는 문제를 막는다.
- 질문·프롬프트·결과 검토 문구를 목적에 맞게 만들 수 있다.
- 새소식은 행사 기간을 달력으로 확인할 필요가 있다.

## 4. 리뷰 데이터 흐름 통합

### 결정

홈 리뷰 인사이트와 UC2가 `GET /store-profiles/{id}/reviews/summary` 응답을 함께 사용한다.

### 이유

- 홈에는 리뷰가 보이지만 UC2에는 리뷰가 없다고 나오는 모순을 제거한다.
- `sourceReviewIds`에 실제 DB UUID를 전달할 수 있다.
- 전체 수와 Gemini에 전달하는 대표 리뷰 수를 분리할 수 있다.

### 현재 한계

리뷰 요약 문장과 키워드는 현재 결정적 데모 결과이며 별도 DS 분석 모델이 아니다.

## 5. PostgreSQL LXC 사용

### 결정

Compose에 DB 컨테이너를 추가하지 않고 Proxmox의 PostgreSQL LXC를 사용한다.

### 이유

- 팀 인프라의 기존 DB를 재사용한다.
- 개발 PC는 SSH 터널, 배포 VM은 내부 네트워크로 접속한다.
- Compose는 frontend와 backend 애플리케이션만 관리한다.

## 6. FastAPI BackgroundTasks 사용

### 결정

첫 MVP는 Celery·Redis 없이 BackgroundTasks와 PostgreSQL 상태를 사용한다.

### 이유

- 짧은 기간의 데모 범위에서 운영 복잡도를 줄인다.
- Job·Task 상태를 DB에 남겨 부분 성공과 재시도를 시연할 수 있다.

### 한계

- 프로세스 재시작에 강한 작업 큐가 아니다.
- MVP는 DB의 `nextRetryAt`까지 BackgroundTasks runner가 대기한 뒤 재시도한다.
- 다중 인스턴스·장기 운영에서는 별도 scheduler 또는 task queue가 더 적합하다.

## 7. Gemini와 결정적 Stub

### 결정

Gemini 호출을 Protocol 경계 뒤에 두고 API Key가 없으면 결정적 Stub을 사용한다.

### 이유

- 로컬·CI·데모 환경에서 외부 서비스 장애와 비용에 의존하지 않는다.
- 실제 모델 출력도 같은 Pydantic schema로 재검증할 수 있다.
- 현재 기본 모델 설정은 `gemini-3.6-flash`다.

## 8. 플랫폼 발행 Adapter

### 결정

Google·Naver·Kakao는 같은 `PlatformAdapter` Protocol을 사용한다.

### 현재 상태

`AcceptingAdapter`가 외부 호출 없이 성공을 반환한다. 이는 승인·상태·부분 성공·재시도 파이프라인을 검증하기 위한 시뮬레이션이며 실제 운영 API 연동 검증이 아니다.

## 9. 상태 조회 정책

### 결정

프론트는 2초 간격으로 최대 60초 Polling하고, 이후 다시 확인 버튼을 제공한다.

### 현재 격차

실제 코드는 100~500ms 간격으로 무기한 Polling한다. 설계 결정을 유지하고 코드를 수정한다.

## 10. API 단일 기준

### 결정

백엔드가 생성한 OpenAPI를 기계 판독 가능한 기준으로 사용한다.

### 후속 과제

- 프론트 TypeScript 타입을 OpenAPI에서 생성하거나 동일 스키마 검증을 자동화한다.
- `api-contract.md`는 제품 의미와 예시를 설명하고 필드 복제를 최소화한다.
