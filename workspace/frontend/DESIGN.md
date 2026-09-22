# MapKeeper Frontend Design Contract

## 1. Product intent

MapKeeper는 모바일 사용에 익숙하지 않은 소상공인도 음성·텍스트로 매장 정보를 관리할 수 있는 단일 열 모바일 웹앱이다. 한 화면에는 한 가지 결정만 보여주고, 상태와 다음 행동을 쉬운 한국어로 설명한다.

## 2. Color tokens

| Token | Value | Use |
|---|---:|---|
| `--color-brand` | `#2563eb` | 주요 행동·진행 상태 |
| `--color-brand-soft` | `#eff6ff` | 안내·선택 배경 |
| `--color-text` | `#191f28` | 제목·본문 핵심 |
| `--color-text-muted` | `#64748b` | 보조 설명 |
| `--color-surface` | `#ffffff` | 카드·모달 |
| `--color-canvas` | `#f8fafc` | 앱 배경 |
| `--color-border` | `#e2e8f0` | 카드·입력 경계 |
| `--color-success` | `#059669` | 완료 상태 |
| `--color-danger` | `#e11d48` | 실패·거절 상태 |

## 3. Typography

- 기본 글꼴: Pretendard, sans-serif
- 화면 제목: 24px / 700~800 / 1.4
- 카드 제목: 17px / 700~750 / 1.35
- 본문: 14~16px / 500~600 / 1.55~1.65
- 보조 문구: 12~13.5px / 500~700
- 한국어 문장은 `word-break: keep-all`, `overflow-wrap: break-word`, `text-wrap: pretty`를 우선한다.

## 4. Spacing and shape

- 4px 배수를 기본 간격으로 사용한다.
- 주요 화면 좌우 여백: 20~24px
- 카드 간격: 12~16px
- 카드 반경: 16~22px
- 바텀시트 상단 반경: 28px
- 주요 터치 영역: 최소 48px, 핵심 행동 버튼은 56px

## 5. Reusable primitives and states

- `HomeCard`: 기본·hover·pressed·focus 상태
- `MobileStepScreen`: 진행 단계·뒤로가기·본문·하단 행동
- `SyncStatusDashboard`: 대기·처리·지연·부분 성공·성공·실패·재확인 상태
- `PlatformResultCard`: 대기·처리·재시도·성공·실패 상태
- `BottomSheet`: rest·enter·expanded·dismiss 상태
- `PrimaryAction`: enabled·disabled·loading·focus 상태

## 6. Motion

- 상태 전환만 150~220ms ease-out으로 표현한다.
- 처리 중 아이콘의 회전 외 장식 애니메이션은 사용하지 않는다.
- `prefers-reduced-motion: reduce`에서는 회전과 전환을 제거한다.

## 7. Responsive behavior

- 앱 셸은 최대 480px이며 넓은 화면에서는 중앙 정렬한다.
- 검증 기준 viewport는 375px, 768px, 1280px이다.
- 콘텐츠가 길어져도 가로 스크롤·문장 한 글자 고아 줄·하단 버튼 가림이 없어야 한다.

## 8. Accessibility and accepted debt

- 상태 변화는 `role=status` 또는 `role=alert`로 전달한다.
- 색만으로 상태를 표현하지 않고 아이콘과 문구를 함께 제공한다.
- focus-visible 윤곽선과 4.5:1 본문 대비를 유지한다.
- 실제 Web Speech 인식 품질은 브라우저·기기 의존성이 있어 자동 테스트가 아닌 배포 수동 QA로 관리한다.
- 현재 CSS의 기존 raw color는 점진적으로 token화하며, 이번 변경에서는 새 raw color를 추가하지 않는다.

## 9. UC1 지도 화면 미리보기 (`MapPlacePreview`)

UC1 최종 결과의 반영 내역 바텀시트에서 Google 지도·네이버 지도·카카오맵 장소 상세 **화면**과 비슷한 지도 뷰포트로 변경 전·후를 보여준다. 외부 지도 embed나 캡처가 아니라 CSS·SVG로 다시 그린 재구성 화면이며, 원격 게시를 주장하지 않고 항상 `미리보기 · 실제 지도 화면과 다를 수 있습니다`를 함께 표시한다.

### 화면 구성

`MapViewport`(`.map-viewport`)가 한 장의 지도 앱 화면을 만든다.

1. **지도 표면** (`.map-viewport__surface` > `svg.map-surface`, `aria-hidden`): 땅·블록·공원·수면 면과 주요 도로(casing+fill 2겹)·이면 도로·대각선 도로, 그리고 중앙 마커 핀. 도로명·지명·좌표는 그리지 않는 추상 기하다.
2. **앱 크롬** (`.map-viewport__chrome`, `aria-hidden`): 떠 있는 검색 필드(뒤로·검색 아이콘 + 실제 매장명 + 플랫폼 로고 아바타)와 우하단 원형 컨트롤 2개(레이어·현재 위치).
3. **장소 시트** (`article.place-card`): 지도 위로 `margin-top:-20px` 겹쳐 올라오는 바텀시트. grabber → 장소명 → 요약 문구 → 행동 아이콘 행 → 섹션 탭 → 정보 행 순으로 위계를 만든다.

### 플랫폼 시각 기준

| 플랫폼 | 장소 상세 기준 요소 | 강조 방식 |
|---|---|---|
| Google 지도 | 밝은 베이지 지도·흰 도로·빨간 핀, 흰 검색 필드, 큰 저굵기 장소명, 파란 원형 행동(경로·저장·공유), 파란 밑줄 탭(개요·메뉴·정보) | 파란 밑줄·연파랑 변경 행 |
| 네이버 지도 | 초록 기운 지도·초록 핀, 굵은 장소명, 둥근 사각 행동(저장·길찾기·공유), 초록 밑줄 탭(홈·메뉴·정보) | 초록 밑줄·연초록 변경 행 |
| 카카오맵 | 따뜻한 회백 지도, 노란 grabber, 장소명, 사각 행동 버튼(길찾기·공유), 검정 밑줄 탭(정보·메뉴) | 노란 강조·연노랑 변경 행 |

지도 표면·검색 크롬·행동·탭은 모두 시각 참고용 장식이며 `aria-hidden`으로 숨긴다. 사진·리뷰·별점·주소·좌표는 만들어 표시하지 않는다. 매장명은 실제 값이 props로 있을 때만 쓰고 없으면 `내 매장`으로 표시하며, 검색 필드도 같은 값만 되비춘다. 시트 요약 문구는 실제 변경 개수에서 계산한다(After `이번에 업데이트된 정보 N개`, Before `변경 전 정보`). 정보 행은 실제 `storeChanges`에 있는 필드(`businessHours`·`temporaryClosure`·`representativeMenuName`·`parkingInfo`)만 그린다.

### 플랫폼 token

| Token | Google | Naver | Kakao | Use |
|---|---:|---:|---:|---|
| `--map-accent` | `#1a73e8` | `#03c75a` | `#fee500` | 탭 밑줄·행동 칩 경계·상단 띠 (장식 전용) |
| `--map-accent-text` | `#1a73e8` | `#00843d` | `#191919` | 강조 텍스트, 흰 배경 4.5:1 이상 |
| `--map-changed-bg` | `#e8f0fe` | `#e9f9ef` | `#fff9cc` | After 변경 행 배경 |
| `--map-title` | `#202124` | `#1e1e23` | `#191919` | 장소명 |
| `--map-muted` | `#5f6368` | `#6b6b72` | `#666666` | 보조 문구·아이콘 |
| `--map-divider` | `#dadce0` | `#ebebeb` | `#e5e5e5` | 탭·정보 행 구분선 |
| `--map-land` | `#f1efe9` | `#f3f5f2` | `#f4f3ef` | 지도 바탕 (장식 전용) |
| `--map-block` | `#e6e3dd` | `#e5e9e4` | `#e8e6e0` | 건물 블록 |
| `--map-road` / `--map-road-edge` | `#ffffff` / `#dcd8d1` | `#ffffff` / `#dde2da` | `#ffffff` / `#dfdcd4` | 도로 면 / 도로 테두리 |
| `--map-road-major` | `#fdf3d3` | `#fdf6dc` | `#fdf3cf` | 주요 도로 면 |
| `--map-park` | `#c8e6c0` | `#cfe8c4` | `#cfe6c2` | 공원 면 |
| `--map-water` | `#a9ceec` | `#b3d4f0` | `#b7d7f2` | 수면 |
| `--map-pin` | `#ea4335` | `#00843d` | `#f24147` | 지도 마커 핀 |

### 상태 규칙

- 플랫폼 선택은 `tablist`이며 좌우 화살표·Home·End로 이동한다. Before/After는 `aria-pressed` 토글 버튼이다.
- After에서는 `SUCCESS` 플랫폼만 변경값과 `변경됨` 표시를 보여준다. 실패·대기·처리·재시도 플랫폼은 변경 전 값과 미반영 안내를 보여주며 반영된 것처럼 표시하지 않는다.
- 바텀시트는 Escape로 닫고, 열릴 때 닫기 버튼에 초점을 두며 Tab 초점을 시트 안에 유지하고, 닫으면 연 요소로 초점을 되돌린다.
- 375px viewport에서 탭·지도 뷰포트·시트·토글이 가로 스크롤 없이 들어가야 한다. 지도 표면 높이는 186px(420px 이상에서 212px)이고 SVG는 `xMidYMid slice`로 채운다.
