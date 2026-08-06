# Mapkeeper AI Frontend

5060 소상공인을 위한 매장정보 변경(UC1), 5단계 모바일 로컬 SEO 문구 생성(UC2), Google/Naver/Kakao 동기화 현황을 제공하는 React/Vite 프론트엔드입니다.

## 요구 환경

- Node.js 20 LTS
- npm
- 음성 기능 사용 시 Web Speech API를 지원하는 브라우저
- 실제 마이크 사용 시 HTTPS 또는 `localhost`, 브라우저 마이크 권한

음성은 브라우저에서 텍스트로 변환됩니다. 서버에는 `storeProfileId`, `recognizedText`, `locale`만 전송하며 원본 오디오를 전송하거나 저장하지 않습니다.

## 설치 및 실행

```bash
cd frontend
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

## 실제 백엔드로 전환

```dotenv
VITE_API_BASE_URL=http://localhost:8000
VITE_API_MOCKING=false
VITE_MOCK_SCENARIO=default
```

같은 origin에서 Vite `/api` proxy를 사용하려면 `VITE_API_BASE_URL`을 비워 둡니다. 백엔드는 `specs/001-local-seo-generation/contracts/api-contract.md`의 공통 envelope와 endpoint를 준수해야 합니다. 컴포넌트는 mock 모듈이나 시나리오에 따라 API 동작을 분기하지 않습니다.

## 검증 명령

```bash
npm run lint
npm run typecheck
npm run test:run
npm run build
```

특정 테스트만 실행하려면 다음과 같이 경로를 전달합니다.

```bash
npm run test:run -- src/test/mvpFlows.test.tsx
```

## 브라우저 음성 확인

1. HTTPS 또는 `localhost`로 접속합니다.
2. “음성 인식 시작”을 누르고 마이크 권한을 허용합니다.
3. “영업시간을 밤 10시까지로 바꿔줘”처럼 허용된 매장정보 변경을 말합니다.
4. 인식 실패 또는 권한 거부 시 큰 직접 입력 UI가 즉시 표시되는지 확인합니다.
5. 음성이나 Enter 키만으로 승인되지 않고, 최종 “승인” 버튼 클릭 후에만 동기화가 시작되는지 확인합니다.

지원되지 않는 브라우저에서도 직접 입력 fallback으로 UC1을 계속 사용할 수 있습니다.

## UC2 모바일 단계 흐름

UC2는 한 화면에 한 단계만 표시합니다.

1. 리뷰 AI 요약, 키워드, 분석 건수 확인
2. 대표 소개글 또는 가게 소식 목적 선택
3. 세 가지 AI 인터뷰 질문에 답변
4. 추천 소개글과 해시태그 수정 후 명시적 업로드
5. Google/Naver/Kakao 반영 상태 및 재시도 확인

목적과 인터뷰 답변은 브라우저 세션에서만 사용합니다. 기존 API에는 마스킹 리뷰 ID, 수정된 draft text, 승인할 draft ID만 전달합니다.
