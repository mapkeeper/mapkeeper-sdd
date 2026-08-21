import { useEffect, useRef, useState } from 'react';
import {
  Bell,
  ChartBar,
  ClockCounterClockwise,
  Gear,
  House,
  Microphone,
  Sparkle,
  Storefront,
} from '@phosphor-icons/react';
import { SeoGenerationWizard } from '@/features/seo/SeoGenerationWizard';
import { StoreChangeWizard } from '@/features/store-change/StoreChangeWizard';
import { SyncStatusDashboard } from '@/components/SyncStatus/SyncStatus';
import type { PlatformResult } from '@/components/SyncStatus/SyncStatus';
import { getReviewSummary } from '@/services/reviewApi';
import { useTextToSpeech } from '@/hooks/useTextToSpeech';
import { useDialogDismiss } from '@/hooks/useDialogDismiss';
import type { GetReviewSummaryResponse } from '@/services/api.types';
import type { ProposalChange, ProposalField } from '@/types/domain';
import type {
  AppNotification,
  HistoryEntry,
  NotificationCategory,
  NotificationPrefs,
  PlatformConnection,
} from '@/types/appNav';
import { reviewSummaryFixture, sourceReviewFixtures } from '@/mocks/fixtures/storeFixtures';
import { DEMO_STORE } from '@/config/demoStore';
import googleLogo from '@/assets/platforms/google.svg';
import naverLogo from '@/assets/platforms/naver.svg';
import kakaoLogo from '@/assets/platforms/kakao.svg';
import './App.css';

type AppScreen = 'HOME' | 'STORE_CHANGE' | 'SEO' | 'STORE_SYNC' | 'HISTORY' | 'SETTINGS';

const iconComponents = {
  bell: Bell,
  mic: Microphone,
  chart: ChartBar,
  store: Storefront,
  sparkle: Sparkle,
  home: House,
  history: ClockCounterClockwise,
  settings: Gear,
};

function Icon({ name, className = 'h-6 w-6' }: { name: keyof typeof iconComponents; className?: string }) {
  const Component = iconComponents[name];
  return <Component className={className} weight="regular" aria-hidden="true" />;
}

const initialPlatformConnections: PlatformConnection[] = [
  { id: 'google', name: '구글', logo: googleLogo, status: 'connected' },
  { id: 'naver', name: '네이버', logo: naverLogo, status: 'connected' },
  { id: 'kakao', name: '카카오', logo: kakaoLogo, status: 'connected' },
];

const baseNotifications: AppNotification[] = [
  { id: 'n1', category: 'review', title: '리뷰 3건이 새로 등록됐어요', time: '10분 전', unread: true, target: 'REVIEW' },
  { id: 'n2', category: 'sync', title: '영업시간 변경이 3개 플랫폼에 모두 반영됐어요', time: '2시간 전', unread: true, target: 'HISTORY' },
  { id: 'n3', category: 'promo', title: '이번 주 홍보문구 초안이 도착했어요', time: '어제', unread: false, target: 'SEO' },
];

const seedHistoryEntries: HistoryEntry[] = [
  { id: 'h1', type: 'STORE_CHANGE', title: '매장 정보를 변경했어요', detail: '영업시간, 주차 정보 업데이트 · 3사 반영 완료', time: '3일 전' },
  { id: 'h2', type: 'SEO', title: 'AI 홍보문구를 3사에 반영했어요', detail: '구글·네이버·카카오 신규 소식 등록', time: '지난주' },
];

const proposalFieldLabels: Record<ProposalField, string> = {
  businessHours: '영업시간',
  temporaryClosure: '임시 휴무',
  representativeMenuName: '대표 메뉴',
  parkingInfo: '주차 정보',
};

const emptyReviewSummary: GetReviewSummaryResponse = {
  storeProfileId: '',
  summary: '아직 분석할 리뷰가 없어요.',
  keywords: [],
  reviewCount: 0,
  sourceReviews: [],
};

const initialReviewSummary: GetReviewSummaryResponse = import.meta.env.VITE_API_MOCKING === 'true'
  ? { storeProfileId: '', ...reviewSummaryFixture, sourceReviews: sourceReviewFixtures }
  : emptyReviewSummary;

function Home({
  onStore,
  onSeo,
  onHistory,
  onSettings,
  onNotificationRead,
  reviewSummary,
  platformConnections,
  notifications,
}: {
  onStore(): void;
  onSeo(): void;
  onHistory(): void;
  onSettings(): void;
  onNotificationRead(id: string): void;
  reviewSummary: GetReviewSummaryResponse;
  platformConnections: PlatformConnection[];
  notifications: AppNotification[];
}) {
  const [isReviewSummaryOpen, setReviewSummaryOpen] = useState(false);
  const [isReviewSummaryExpanded, setReviewSummaryExpanded] = useState(false);
  const reviewDragStartRef = useRef<number | null>(null);
  const reviewDidDragRef = useRef(false);
  const [isNotificationOpen, setNotificationOpen] = useState(false);
  const hasUnreadNotifications = notifications.some((notification) => notification.unread);
  const reviewDialogRef = useRef<HTMLElement | null>(null);
  const notificationDialogRef = useRef<HTMLElement | null>(null);

  const closeReviewSummary = () => {
    setReviewSummaryOpen(false);
    setReviewSummaryExpanded(false);
  };

  useDialogDismiss(reviewDialogRef, isReviewSummaryOpen, closeReviewSummary);
  useDialogDismiss(notificationDialogRef, isNotificationOpen, () => setNotificationOpen(false));

  const openNotification = (notification: AppNotification) => {
    onNotificationRead(notification.id);
    setNotificationOpen(false);
    if (notification.target === 'REVIEW') setReviewSummaryOpen(true);
    else if (notification.target === 'SEO') onSeo();
    else onHistory();
  };

  return <main className="home">
    <header className="home__header">
      <div className="home__brand-row">
        <div className="home__brand"><span aria-hidden="true">M</span><h1>MapKeeper</h1></div>
        <div className="home__header-actions">
          <button
            type="button"
            aria-label="알림"
            aria-haspopup="dialog"
            aria-expanded={isNotificationOpen}
            className="home__notification"
            onClick={() => setNotificationOpen((open) => !open)}
          >
            <Icon name="bell" />
            {hasUnreadNotifications ? <span className="home__notification-badge" aria-hidden="true" /> : null}
          </button>
          <button type="button" className="home__profile" aria-label={`${DEMO_STORE.name} 설정 열기`} onClick={onSettings}><Icon name="store" /></button>
        </div>
      </div>
      <div className="home__welcome"><p>안녕하세요, 사장님</p><strong>오늘도 가게 관리를<br />쉽고 빠르게 시작해 볼까요?</strong></div>
    </header>

    <div className="home__sheet">
    <div className="home__content">
      <section className="connection-card" aria-label="3사 연동 상태">
        <div className="connection-card__heading">
          <h2>{DEMO_STORE.name}</h2>
          <span className="connection-card__badge">3사 연동 상태</span>
        </div>
        <div className="connection-card__platforms">
          {platformConnections.map((platform) => {
            const connected = platform.status === 'connected';
            return <div key={platform.id} role="group" className={`connection-card__platform connection-card__platform--${platform.status}`} aria-label={`${platform.name} ${connected ? '연결됨' : '확인 필요'}`}>
              <span className="connection-card__logo"><img src={platform.logo} alt={`${platform.name} 로고`} /></span>
              <strong>{platform.name}</strong>
              <span className="connection-card__status">
                <span className="connection-card__status-mark" aria-hidden="true">{connected ? '✓' : '!'}</span>
                <span className="connection-card__status-label">{connected ? '연결됨' : '확인 필요'}</span>
              </span>
            </div>;
          })}
        </div>
      </section>

      <div className="home__section-heading"><div><strong>가게 관리</strong><p>필요한 업무를 선택해 주세요</p></div></div>

      <button type="button" onClick={onStore} className="home-card" aria-label="음성으로 매장 정보 변경하기">
        <span className="home-card__copy">
          <small className="home-card__eyebrow">01 · 매장 정보</small>
          <strong>음성으로 매장 정보 변경하기</strong>
          <small>영업시간, 휴무일, 주차 정보 등을 말로 편하게 수정하세요</small>
        </span>
        <span className="home-card__icon home-card__icon--voice"><Icon name="mic" className="h-8 w-8" /></span>
        <span className="home-card__chevron" aria-hidden="true">›</span>
      </button>

      <button type="button" onClick={() => setReviewSummaryOpen(true)} className="home-card" aria-label="우리 가게 리뷰 분석 확인하기">
        <span className="home-card__copy">
          <small className="home-card__eyebrow">02 · 리뷰 인사이트 · {reviewSummary.reviewCount}건</small>
          <strong>우리 가게 리뷰 분석 확인하기</strong>
          <small>손님들의 최근 리뷰 요약과 핵심 키워드를 한눈에 확인하세요</small>
        </span>
        <span className="home-card__icon home-card__icon--review"><Icon name="chart" className="h-8 w-8" /></span>
        <span className="home-card__chevron" aria-hidden="true">›</span>
      </button>

      <button type="button" onClick={onSeo} className="home-card" aria-label="AI 가게 홍보 & 소문내기">
        <span className="home-card__copy">
          <small className="home-card__eyebrow">03 · 홍보 마케팅</small>
          <strong>AI 가게 홍보 &amp; 소문내기</strong>
          <small>맵지기 AI가 추천하는 맞춤 소식과 문구로 방문자를 늘려보세요</small>
        </span>
        <span className="home-card__icon home-card__icon--ai"><Icon name="sparkle" className="h-8 w-8" /></span>
        <span className="home-card__chevron" aria-hidden="true">›</span>
      </button>
    </div>
    </div>

    {isReviewSummaryOpen ? <div className="review-modal" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) closeReviewSummary();
    }}>
      <section ref={reviewDialogRef} className={isReviewSummaryExpanded ? 'review-modal__sheet is-expanded' : 'review-modal__sheet'} role="dialog" aria-modal="true" aria-labelledby="review-summary-title">
        <button className="review-modal__drag-zone" type="button" aria-label={isReviewSummaryExpanded ? '리뷰 분석 창 축소' : '리뷰 분석 창 전체 화면으로 확장'} aria-expanded={isReviewSummaryExpanded} onClick={() => {
          if (reviewDidDragRef.current) { reviewDidDragRef.current = false; return; }
          setReviewSummaryExpanded((current) => !current);
        }} onPointerDown={(event) => {
          reviewDragStartRef.current = event.clientY;
          reviewDidDragRef.current = false;
          event.currentTarget.setPointerCapture?.(event.pointerId);
        }} onPointerUp={(event) => {
          const startY = reviewDragStartRef.current;
          reviewDragStartRef.current = null;
          if (startY === null) return;
          const distance = event.clientY - startY;
          reviewDidDragRef.current = Math.abs(distance) > 10;
          if (distance < -40) setReviewSummaryExpanded(true);
          if (distance > 40) setReviewSummaryExpanded(false);
        }}><span className="review-modal__handle" aria-hidden="true" /></button>
        <header className="review-modal__header">
          <div><small>최근 리뷰 분석</small><h2 id="review-summary-title">손님들이 우리 가게를<br />이렇게 이야기하고 있어요</h2></div>
          <button type="button" onClick={closeReviewSummary} aria-label="리뷰 분석 닫기">×</button>
        </header>
        <div className="review-modal__count"><strong>{reviewSummary.reviewCount}</strong><span>건의 리뷰를 분석했어요</span></div>
        <p className="review-modal__summary">{reviewSummary.summary}</p>
        <div className="review-modal__keywords" role="group" aria-label="핵심 리뷰 키워드">
          {reviewSummary.keywords.map((keyword) => <span key={keyword}>#{keyword}</span>)}
        </div>
        <section className="review-platforms" aria-labelledby="platform-reactions-title">
          <h3 id="platform-reactions-title">플랫폼별 주요 반응</h3>
          {[{ name: '구글', logo: googleLogo, text: '외국인 손님도 메뉴 선택과 응대가 편해요.' }, { name: '네이버', logo: naverLogo, text: '만두전골 국물과 푸짐한 양을 많이 칭찬해요.' }, { name: '카카오', logo: kakaoLogo, text: '가족 식사와 재방문 장소로 많이 추천해요.' }].map((platform) => <article key={platform.name}>
            <span><img src={platform.logo} alt="" /><strong>{platform.name}</strong></span><p>{platform.text}</p>
          </article>)}
        </section>
        {isReviewSummaryExpanded ? <section className="review-modal__detail"><h3>맵지기 분석 포인트</h3><p>최근 3개월 동안 맛에 대한 긍정 반응이 꾸준히 유지됐고, 친절한 서비스 언급은 지난달보다 늘었어요. 홍보 문구에는 ‘깊은 국물’, ‘속이 꽉 찬 만두’, ‘가족 식사’를 함께 강조하면 좋아요.</p></section> : null}
        <button className="review-modal__cta" type="button" onClick={onSeo}>이 분석으로 AI 홍보문구 만들기 <span aria-hidden="true">→</span></button>
      </section>
    </div> : null}

    {isNotificationOpen ? <div className="notification-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) setNotificationOpen(false);
    }}>
      <section ref={notificationDialogRef} className="notification-panel" role="dialog" aria-modal="true" aria-label="알림 목록">
        <header className="notification-panel__header">
          <strong>알림</strong>
          <button type="button" onClick={() => setNotificationOpen(false)} aria-label="알림 닫기">×</button>
        </header>
        {notifications.length === 0 ? <p className="notification-panel__empty">새 알림이 없어요</p> : <ul className="notification-panel__list">
          {notifications.map((notification) => <li key={notification.id} className={notification.unread ? 'is-unread' : ''}>
            <button type="button" onClick={() => openNotification(notification)}>
              <span className="notification-panel__dot" aria-hidden="true" />
              <span className="notification-panel__body">
                <strong>{notification.unread ? <><span className="sr-only">읽지 않음. </span>{notification.title}</> : notification.title}</strong>
                <small>{notification.time}</small>
              </span>
              <span className="notification-panel__chevron" aria-hidden="true">›</span>
            </button>
          </li>)}
        </ul>}
      </section>
    </div> : null}

    <nav className="home-nav" aria-label="하단 메뉴">
      {[
        { icon: 'home' as const, label: '홈', onClick: () => window.scrollTo({ top: 0, behavior: 'smooth' }) },
        { icon: 'store' as const, label: '매장 정보', onClick: onStore },
        { icon: 'sparkle' as const, label: '홍보문구', onClick: onSeo },
        { icon: 'history' as const, label: '기록', onClick: onHistory },
        { icon: 'settings' as const, label: '설정', onClick: onSettings },
      ].map((item, index) => <button key={item.label} type="button" className={index === 0 ? 'is-active' : ''} aria-current={index === 0 ? 'page' : undefined} onClick={item.onClick}><Icon name={item.icon} />{item.label}</button>)}
    </nav>
  </main>;
}

function SyncResult({ onHome, syncJobId, resultOverride, storeChanges, voiceGuidance = false }: { onHome(): void; syncJobId: string; resultOverride: PlatformResult[] | null; storeChanges: ProposalChange[]; voiceGuidance?: boolean }) {
  const tts = useTextToSpeech(voiceGuidance);
  const hasAnnouncedRef = useRef(false);
  useEffect(() => {
    if (!voiceGuidance || hasAnnouncedRef.current) return;
    hasAnnouncedRef.current = true;
    tts.speak('구글, 네이버, 카카오에 매장 정보 반영을 시작했어요.');
  }, [voiceGuidance, tts]);
  return <main className="flex h-dvh flex-col overflow-hidden bg-gray-50 px-5 pb-[calc(16px+env(safe-area-inset-bottom))] pt-[calc(20px+env(safe-area-inset-top))] font-pretendard">
    <button type="button" aria-label="홈으로 나가기" onClick={onHome} className="ml-auto grid h-12 w-12 place-items-center rounded-full bg-white text-3xl shadow-card">×</button>
    <div className="min-h-0 flex-1 overflow-y-auto pb-4">
      <SyncStatusDashboard syncJobId={syncJobId} resultOverride={resultOverride} viewMode="store-change" storeChanges={storeChanges} />
    </div>
    <button type="button" onClick={onHome} className="mt-4 min-h-14 w-full shrink-0 rounded-[18px] bg-blue-600 text-[17px] font-bold text-white shadow-md active:scale-[.985]">확인 (홈으로 이동)</button>
  </main>;
}

function ToggleSwitch({ checked, onChange, label }: { checked: boolean; onChange(): void; label: string }) {
  return <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={label}
    onClick={onChange}
    style={{ minHeight: 28 }}
    className={`relative h-7 w-12 flex-none rounded-full transition-colors ${checked ? 'bg-blue-600' : 'bg-slate-200'}`}
  >
    {/* left-0 anchors the thumb to the track. Without it the thumb keeps its
        static position, which a button centres, and the travel below then
        starts from the middle and carries the thumb outside the track. */}
    <span
      aria-hidden="true"
      className={`absolute left-0 top-0.5 h-6 w-6 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-[22px]' : 'translate-x-0.5'}`}
    />
  </button>;
}

const historyTypeIcon = { STORE_CHANGE: Storefront, SEO: Sparkle } as const;

function HistoryScreen({ entries, onHome }: { entries: HistoryEntry[]; onHome(): void }) {
  return <main className="flex h-dvh flex-col overflow-hidden bg-gray-50 px-5 pb-[calc(16px+env(safe-area-inset-bottom))] pt-[calc(20px+env(safe-area-inset-top))] font-pretendard">
    <div className="flex items-center justify-between">
      <h1 className="app-screen__title">기록</h1>
      <button type="button" aria-label="홈으로 나가기" onClick={onHome} className="grid h-12 w-12 place-items-center rounded-full bg-white text-3xl shadow-card">×</button>
    </div>
    <p className="mt-1 text-sm text-slate-500">매장 정보 변경과 홍보문구 반영 이력을 확인하세요</p>
    <div className="mt-4 min-h-0 flex-1 overflow-y-auto pb-4">
      {entries.length === 0 ? <div className="grid h-full place-items-center text-center text-sm text-slate-400">아직 기록이 없어요</div> : <ul className="grid gap-3">
        {entries.map((entry) => {
          const EntryIcon = historyTypeIcon[entry.type];
          return <li key={entry.id} className="flex items-start gap-3 rounded-2xl bg-white p-4 shadow-card">
            <span className="grid h-10 w-10 flex-none place-items-center rounded-xl bg-blue-50 text-blue-600"><EntryIcon className="h-5 w-5" weight="regular" aria-hidden="true" /></span>
            <span className="min-w-0 flex-1">
              <strong className="block text-[15px] font-bold text-ink">{entry.title}</strong>
              <span className="mt-0.5 block text-[13px] text-slate-500">{entry.detail}</span>
            </span>
            <span className="flex-none text-[11px] font-medium text-slate-400">{entry.time}</span>
          </li>;
        })}
      </ul>}
    </div>
  </main>;
}

const notificationPrefItems: { key: NotificationCategory; label: string; description: string }[] = [
  { key: 'review', label: '리뷰 알림', description: '새 리뷰가 등록되면 알려드려요' },
  { key: 'sync', label: '동기화 알림', description: '매장 정보 반영 결과를 알려드려요' },
  { key: 'promo', label: '홍보문구 알림', description: 'AI가 만든 홍보문구 초안을 알려드려요' },
];

function SettingsScreen({
  onHome,
  onStoreChange,
  platformConnections,
  onTogglePlatform,
  notificationPrefs,
  onToggleNotificationPref,
  autoApproveStoreChange,
  onToggleAutoApprove,
  voiceGuidance,
  onToggleVoiceGuidance,
  largeText,
  onToggleLargeText,
}: {
  onHome(): void;
  onStoreChange(): void;
  platformConnections: PlatformConnection[];
  onTogglePlatform(id: PlatformConnection['id']): void;
  notificationPrefs: NotificationPrefs;
  onToggleNotificationPref(key: NotificationCategory): void;
  autoApproveStoreChange: boolean;
  onToggleAutoApprove(): void;
  voiceGuidance: boolean;
  onToggleVoiceGuidance(): void;
  largeText: boolean;
  onToggleLargeText(): void;
}) {
  const [isHelpOpen, setHelpOpen] = useState(false);
  const [isContactOpen, setContactOpen] = useState(false);
  const helpDialogRef = useRef<HTMLElement | null>(null);
  const contactDialogRef = useRef<HTMLElement | null>(null);

  useDialogDismiss(helpDialogRef, isHelpOpen, () => setHelpOpen(false));
  useDialogDismiss(contactDialogRef, isContactOpen, () => setContactOpen(false));

  return <main className="flex h-dvh flex-col overflow-hidden bg-gray-50 px-5 pb-[calc(16px+env(safe-area-inset-bottom))] pt-[calc(20px+env(safe-area-inset-top))] font-pretendard">
    <div className="flex items-center justify-between">
      <h1 className="app-screen__title">설정</h1>
      <button type="button" aria-label="홈으로 나가기" onClick={onHome} className="grid h-12 w-12 place-items-center rounded-full bg-white text-3xl shadow-card">×</button>
    </div>

    <div className="mt-4 min-h-0 flex-1 overflow-y-auto pb-4">
      <section className="rounded-2xl bg-white p-4 shadow-card">
        <h2 className="app-screen__section-label">매장 정보</h2>
        <p className="mt-2 text-[17px] font-bold text-ink">{DEMO_STORE.name}</p>
        <dl className="mt-3 grid gap-1.5 text-[13px] text-slate-500">
          <div className="flex gap-2"><dt className="w-16 flex-none text-slate-400">주소</dt><dd>{DEMO_STORE.publicAddress}</dd></div>
          <div className="flex gap-2"><dt className="w-16 flex-none text-slate-400">영업시간</dt><dd>{DEMO_STORE.businessHours}</dd></div>
          <div className="flex gap-2"><dt className="w-16 flex-none text-slate-400">대표 메뉴</dt><dd>{DEMO_STORE.representativeMenuName}</dd></div>
          <div className="flex gap-2"><dt className="w-16 flex-none text-slate-400">주차 정보</dt><dd>{DEMO_STORE.parkingInfo}</dd></div>
        </dl>
        <button type="button" onClick={onStoreChange} style={{ minHeight: 44 }} className="mt-4 w-full rounded-xl bg-blue-50 text-[14px] font-bold text-blue-600">음성으로 매장 정보 수정하기</button>
      </section>

      <section className="mt-4 rounded-2xl bg-white p-4 shadow-card">
        <h2 className="app-screen__section-label">AI 자동화</h2>
        <div className="mt-3 flex items-center gap-3">
          <span className="min-w-0 flex-1">
            <strong className="block text-[14px] font-bold text-ink">AI 제안 자동 승인</strong>
            <span className="block text-[12px] text-slate-500">음성으로 요청한 매장 정보 변경을 확인 없이 바로 3사에 반영해요</span>
          </span>
          <ToggleSwitch checked={autoApproveStoreChange} onChange={onToggleAutoApprove} label="AI 제안 자동 승인" />
        </div>
        {autoApproveStoreChange ? <p className="mt-3 rounded-xl bg-amber-50 p-3 text-[12px] leading-relaxed text-amber-700">
          변경 요청을 인식하는 즉시 승인 절차 없이 반영돼요. 매장 정보 변경 화면에서 언제든 "잠깐, 제가 직접 확인할게요"로 이번 건만 직접 확인할 수 있어요.
        </p> : null}
      </section>

      <section className="mt-4 rounded-2xl bg-white p-4 shadow-card">
        <h2 className="app-screen__section-label">음성 안내</h2>
        <div className="mt-3 flex items-center gap-3">
          <span className="min-w-0 flex-1">
            <strong className="block text-[14px] font-bold text-ink">말로 안내 듣기</strong>
            <span className="block text-[12px] text-slate-500">매장 정보 변경 화면에서 AI가 다음 단계와 변경 내용을 소리 내어 읽어줘요</span>
          </span>
          <ToggleSwitch checked={voiceGuidance} onChange={onToggleVoiceGuidance} label="말로 안내 듣기" />
        </div>
      </section>

      <section className="mt-4 rounded-2xl bg-white p-4 shadow-card">
        <h2 className="app-screen__section-label">접근성</h2>
        <div className="mt-3 flex items-center gap-3">
          <span className="min-w-0 flex-1">
            <strong className="block text-[14px] font-bold text-ink">글자 크게 보기</strong>
            <span className="block text-[12px] text-slate-500">화면 전체 글자와 버튼을 더 크게 보여줘요</span>
          </span>
          <ToggleSwitch checked={largeText} onChange={onToggleLargeText} label="글자 크게 보기" />
        </div>
      </section>

      <section className="mt-4 rounded-2xl bg-white p-4 shadow-card">
        <h2 className="app-screen__section-label">3사 연동 관리</h2>
        <ul className="mt-3 grid gap-2">
          {platformConnections.map((platform) => {
            const connected = platform.status === 'connected';
            return <li key={platform.id} className="flex items-center gap-3 rounded-xl border border-slate-100 p-3">
              <img src={platform.logo} alt="" className="h-8 w-8 flex-none rounded-lg" />
              <span className="min-w-0 flex-1">
                <strong className="block text-[14px] font-bold text-ink">{platform.name}</strong>
                <span className={connected ? 'text-[12px] font-semibold text-emerald-600' : 'text-[12px] font-semibold text-rose-500'}>{connected ? '연결됨' : '연동 해제됨'}</span>
              </span>
              <button
                type="button"
                onClick={() => onTogglePlatform(platform.id)}
                style={{ minHeight: 34 }}
                className={connected ? 'flex-none rounded-full border border-slate-200 px-3 py-1.5 text-[12px] font-bold text-slate-500' : 'flex-none rounded-full bg-blue-600 px-3 py-1.5 text-[12px] font-bold text-white'}
              >
                {connected ? '연동 해제' : '다시 연동'}
              </button>
            </li>;
          })}
        </ul>
      </section>

      <section className="mt-4 rounded-2xl bg-white p-4 shadow-card">
        <h2 className="app-screen__section-label">알림 설정</h2>
        <ul className="mt-3 grid gap-3">
          {notificationPrefItems.map((item) => <li key={item.key} className="flex items-center gap-3">
            <span className="min-w-0 flex-1">
              <strong className="block text-[14px] font-bold text-ink">{item.label}</strong>
              <span className="block text-[12px] text-slate-500">{item.description}</span>
            </span>
            <ToggleSwitch checked={notificationPrefs[item.key]} onChange={() => onToggleNotificationPref(item.key)} label={item.label} />
          </li>)}
        </ul>
      </section>

      <section className="mt-4 rounded-2xl bg-white p-4 shadow-card">
        <h2 className="app-screen__section-label">고객 지원</h2>
        <ul className="mt-3 grid gap-2">
          <li>
            <button type="button" onClick={() => setHelpOpen(true)} style={{ minHeight: 48 }} className="flex w-full items-center justify-between rounded-xl border border-slate-100 px-3.5 text-left text-[14px] font-bold text-ink">
              도움말 다시보기
              <span aria-hidden="true" className="text-slate-300">›</span>
            </button>
          </li>
          <li>
            <button type="button" onClick={() => setContactOpen(true)} style={{ minHeight: 48 }} className="flex w-full items-center justify-between rounded-xl border border-slate-100 px-3.5 text-left text-[14px] font-bold text-ink">
              문의하기
              <span aria-hidden="true" className="text-slate-300">›</span>
            </button>
          </li>
        </ul>
      </section>

      <p className="mt-6 text-center text-[12px] text-slate-400">MapKeeper AI · 버전 1.0.0 (데모)</p>
    </div>

    {isHelpOpen ? <div className="review-modal" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) setHelpOpen(false);
    }}>
      <section ref={helpDialogRef} className="review-modal__sheet review-modal__sheet--simple" role="dialog" aria-modal="true" aria-labelledby="help-modal-title">
        <header className="review-modal__header">
          <div><small>이용 가이드</small><h2 id="help-modal-title">MapKeeper,<br />이렇게 사용해 보세요</h2></div>
          <button type="button" onClick={() => setHelpOpen(false)} aria-label="도움말 닫기">×</button>
        </header>
        <div className="settings-help__list">
          {[
            { emoji: '🎙️', title: '음성으로 매장 정보 변경', body: '영업시간, 휴무일, 대표 메뉴, 주차 정보를 말로 알려주면 AI가 변경안을 만들고, 승인하면 구글·네이버·카카오에 한 번에 반영해요.' },
            { emoji: '📊', title: '리뷰 인사이트', body: '손님들이 남긴 리뷰를 AI가 요약해서 핵심 키워드와 플랫폼별 반응을 한눈에 보여줘요.' },
            { emoji: '✨', title: 'AI 홍보 & 소문내기', body: '리뷰 분석을 바탕으로 AI가 홍보문구를 만들어 3사에 바로 등록해 줘요.' },
            { emoji: '⚙️', title: '설정', body: '3사 연동 상태, 알림 종류, AI 자동 승인 여부를 여기서 관리할 수 있어요.' },
          ].map((item) => <article key={item.title}>
            <span aria-hidden="true">{item.emoji}</span>
            <div><strong>{item.title}</strong><p>{item.body}</p></div>
          </article>)}
        </div>
      </section>
    </div> : null}

    {isContactOpen ? <div className="review-modal" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) setContactOpen(false);
    }}>
      <section ref={contactDialogRef} className="review-modal__sheet review-modal__sheet--simple" role="dialog" aria-modal="true" aria-labelledby="contact-modal-title">
        <header className="review-modal__header">
          <div><small>고객 지원</small><h2 id="contact-modal-title">무엇을 도와드릴까요?</h2></div>
          <button type="button" onClick={() => setContactOpen(false)} aria-label="문의하기 닫기">×</button>
        </header>
        <div className="settings-contact__list">
          <a className="settings-contact__item" href="mailto:support@mapkeeper.example?subject=MapKeeper%20문의">
            <span aria-hidden="true">✉️</span>
            <span><strong>이메일로 문의하기</strong><small>support@mapkeeper.example</small></span>
          </a>
          <div className="settings-contact__item">
            <span aria-hidden="true">💬</span>
            <span><strong>카카오톡 채널 상담</strong><small>평일 09:00–18:00 (주말·공휴일 휴무)</small></span>
          </div>
          <div className="settings-contact__item">
            <span aria-hidden="true">📞</span>
            <span><strong>전화 문의</strong><small>1588-0000</small></span>
          </div>
        </div>
      </section>
    </div> : null}
  </main>;
}

export function App() {
  const [screen, setScreen] = useState<AppScreen>('HOME');
  const [syncJobId, setSyncJobId] = useState('');
  const [storeChanges, setStoreChanges] = useState<ProposalChange[]>([]);
  const storeProfileId = import.meta.env.VITE_STORE_PROFILE_ID ?? DEMO_STORE.id;
  const [reviewSummary, setReviewSummary] = useState<GetReviewSummaryResponse>(initialReviewSummary);
  const [platformConnections, setPlatformConnections] = useState<PlatformConnection[]>(initialPlatformConnections);
  const [notificationPrefs, setNotificationPrefs] = useState<NotificationPrefs>({ review: true, sync: true, promo: true });
  const [historyEntries, setHistoryEntries] = useState<HistoryEntry[]>(seedHistoryEntries);
  const [autoApproveStoreChange, setAutoApproveStoreChange] = useState(false);
  const [voiceGuidance, setVoiceGuidance] = useState(false);
  const [readNotificationIds, setReadNotificationIds] = useState<string[]>([]);
  const [largeText, setLargeText] = useState(false);
  useEffect(() => {
    let active = true;
    void getReviewSummary(storeProfileId).then((result) => {
      if (active) setReviewSummary(result.data);
    }).catch(() => {
      if (active) setReviewSummary({ ...emptyReviewSummary, storeProfileId });
    });
    return () => { active = false; };
  }, [storeProfileId]);
  const goHome = () => setScreen('HOME');
  const visibleNotifications = baseNotifications
    .filter((notification) => notificationPrefs[notification.category])
    .map((notification) => readNotificationIds.includes(notification.id)
      ? { ...notification, unread: false }
      : notification);
  const markNotificationRead = (id: string) => setReadNotificationIds((prev) => prev.includes(id) ? prev : [...prev, id]);
  const togglePlatformConnection = (id: PlatformConnection['id']) => setPlatformConnections((prev) => prev.map((platform) => platform.id === id ? { ...platform, status: platform.status === 'connected' ? 'attention' : 'connected' } : platform));
  const toggleNotificationPref = (key: NotificationCategory) => setNotificationPrefs((prev) => ({ ...prev, [key]: !prev[key] }));
  const addHistoryEntry = (entry: Omit<HistoryEntry, 'id' | 'time'>) => setHistoryEntries((prev) => [{ ...entry, id: `h${Date.now()}`, time: '방금 전' }, ...prev]);
  return <div className={largeText ? 'app-viewport app-viewport--large-text' : 'app-viewport'}><div className="app-phone" data-testid="dashboard-container">
    {screen === 'HOME' && <Home
      reviewSummary={reviewSummary}
      platformConnections={platformConnections}
      notifications={visibleNotifications}
      onStore={() => setScreen('STORE_CHANGE')}
      onSeo={() => setScreen('SEO')}
      onHistory={() => setScreen('HISTORY')}
      onSettings={() => setScreen('SETTINGS')}
      onNotificationRead={markNotificationRead}
    />}
    {screen === 'SEO' && <SeoGenerationWizard
      storeProfileId={storeProfileId}
      sourceReviews={reviewSummary.sourceReviews}
      reviewSummary={reviewSummary}
      onExit={goHome}
      onStoreChangeRequested={() => setScreen('STORE_CHANGE')}
      onSyncHandoff={() => addHistoryEntry({ type: 'SEO', title: 'AI 홍보문구를 3사에 반영했어요', detail: '구글·네이버·카카오 홍보문구 동기화 완료' })}
    />}
    {screen === 'STORE_CHANGE' && <StoreChangeWizard
      storeProfileId={storeProfileId}
      onExit={goHome}
      autoApprove={autoApproveStoreChange}
      voiceGuidance={voiceGuidance}
      onSyncHandoff={({ syncJobId: nextId, changes }) => {
        setSyncJobId(nextId);
        setStoreChanges(changes ?? []);
        const changedFieldLabels = (changes ?? []).map((change) => proposalFieldLabels[change.field]).join(', ');
        addHistoryEntry({
          type: 'STORE_CHANGE',
          title: '매장 정보를 변경했어요',
          detail: changedFieldLabels ? `${changedFieldLabels} 업데이트 · 3사 반영 완료` : '3사 반영 완료',
        });
        setScreen('STORE_SYNC');
      }}
    />}
    {screen === 'STORE_SYNC' && <SyncResult onHome={goHome} syncJobId={syncJobId} resultOverride={null} storeChanges={storeChanges} voiceGuidance={voiceGuidance} />}
    {screen === 'HISTORY' && <HistoryScreen entries={historyEntries} onHome={goHome} />}
    {screen === 'SETTINGS' && <SettingsScreen
      onHome={goHome}
      onStoreChange={() => setScreen('STORE_CHANGE')}
      platformConnections={platformConnections}
      onTogglePlatform={togglePlatformConnection}
      notificationPrefs={notificationPrefs}
      onToggleNotificationPref={toggleNotificationPref}
      autoApproveStoreChange={autoApproveStoreChange}
      onToggleAutoApprove={() => setAutoApproveStoreChange((prev) => !prev)}
      voiceGuidance={voiceGuidance}
      onToggleVoiceGuidance={() => setVoiceGuidance((prev) => !prev)}
      largeText={largeText}
      onToggleLargeText={() => setLargeText((prev) => !prev)}
    />}
  </div></div>;
}
