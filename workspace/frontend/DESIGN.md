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
