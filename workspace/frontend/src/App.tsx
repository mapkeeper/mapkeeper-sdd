import { useEffect, useRef, useState } from 'react';
import { SeoGenerationWizard } from '@/features/seo/SeoGenerationWizard';
import { StoreChangeWizard } from '@/features/store-change/StoreChangeWizard';
import { SyncStatusDashboard } from '@/components/SyncStatus/SyncStatus';
import type { PlatformResult } from '@/components/SyncStatus/SyncStatus';
import { getReviewSummary } from '@/services/reviewApi';
import type { GetReviewSummaryResponse } from '@/services/api.types';
import type { ProposalChange } from '@/types/domain';
import { reviewSummaryFixture, sourceReviewFixtures } from '@/mocks/fixtures/storeFixtures';
import { DEMO_STORE } from '@/config/demoStore';
import googleLogo from '@/assets/platforms/google.svg';
import naverLogo from '@/assets/platforms/naver.svg';
import kakaoLogo from '@/assets/platforms/kakao.svg';
import './App.css';

type AppScreen = 'HOME' | 'STORE_CHANGE' | 'SEO' | 'STORE_SYNC';

function Icon({ name, className = 'h-6 w-6' }: { name: 'bell' | 'mic' | 'chart' | 'store' | 'sparkle' | 'home' | 'info' | 'copy' | 'history' | 'settings'; className?: string }) {
  const paths = {
    bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/></>,
    mic: <><rect x="9" y="2" width="6" height="13" rx="3"/><path d="M5 10a7 7 0 0 0 14 0M12 17v5M8 22h8"/></>,
    chart: <><path d="M4 19V9M10 19V5M16 19v-7M22 19H2"/><path d="m4 7 6-4 6 6 5-4"/></>,
    store: <><path d="M3 10h18l-2-6H5l-2 6Z"/><path d="M5 10v10h14V10M9 20v-6h6v6M3 10c0 2 3 3 4.5 0 1.5 3 4.5 3 6 0 1.5 3 4.5 3 7.5 0"/></>,
    sparkle: <><path d="m12 3 1.3 3.7L17 8l-3.7 1.3L12 13l-1.3-3.7L7 8l3.7-1.3L12 3ZM5 14l.8 2.2L8 17l-2.2.8L5 20l-.8-2.2L2 17l2.2-.8L5 14ZM19 13l.7 1.8 1.8.7-1.8.7L19 18l-.7-1.8-1.8-.7 1.8-.7L19 13Z"/></>,
    home: <><path d="m3 11 9-8 9 8"/><path d="M5 10v10h14V10M9 20v-6h6v6"/></>,
    info: <><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/></>,
    copy: <><rect x="8" y="8" width="11" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h2"/></>,
    history: <><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/></>,
    settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H3v-4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3A1.7 1.7 0 0 0 10 3V3h4v.1a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z"/></>,
  };
  return <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

const platforms = [
  { name: '구글', logo: googleLogo, status: 'connected' },
  { name: '네이버', logo: naverLogo, status: 'connected' },
  { name: '카카오', logo: kakaoLogo, status: 'connected' },
];

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

function Home({ onStore, onSeo, reviewSummary }: { onStore(): void; onSeo(): void; reviewSummary: GetReviewSummaryResponse }) {
  const [isReviewSummaryOpen, setReviewSummaryOpen] = useState(false);
  const [isReviewSummaryExpanded, setReviewSummaryExpanded] = useState(false);
  const reviewDragStartRef = useRef<number | null>(null);
  const reviewDidDragRef = useRef(false);

  const closeReviewSummary = () => {
    setReviewSummaryOpen(false);
    setReviewSummaryExpanded(false);
  };

  return <main className="home">
    <header className="home__header">
      <div className="home__brand-row">
        <div className="home__brand"><span aria-hidden="true">M</span><h1>MapKeeper</h1></div>
        <div className="home__header-actions">
          <button type="button" aria-label="알림" className="home__notification"><Icon name="bell" /></button>
          <span className="home__profile" role="img" aria-label={`${DEMO_STORE.name} 프로필`}><Icon name="store" /></span>
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
          {platforms.map((platform) => {
            const connected = platform.status === 'connected';
            return <div key={platform.name} role="group" className={`connection-card__platform connection-card__platform--${platform.status}`} aria-label={`${platform.name} ${connected ? '연결됨' : '확인 필요'}`}>
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
          <small className="home-card__eyebrow">02 · 리뷰 인사이트</small>
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
      <section className={isReviewSummaryExpanded ? 'review-modal__sheet is-expanded' : 'review-modal__sheet'} role="dialog" aria-modal="true" aria-labelledby="review-summary-title">
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

    <nav className="home-nav" aria-label="하단 메뉴">
      {[['home','홈'],['store','매장 정보'],['sparkle','홍보문구'],['history','기록'],['settings','설정']].map(([icon,label], index) => <button key={label} type="button" className={index === 0 ? 'is-active' : ''}><Icon name={icon as 'home'} />{label}</button>)}
    </nav>
  </main>;
}

function SyncResult({ onHome, syncJobId, resultOverride, storeChanges }: { onHome(): void; syncJobId: string; resultOverride: PlatformResult[] | null; storeChanges: ProposalChange[] }) {
  return <main className="flex min-h-dvh flex-col bg-gray-50 px-5 pb-[calc(16px+env(safe-area-inset-bottom))] pt-[calc(20px+env(safe-area-inset-top))] font-pretendard">
    <button type="button" aria-label="홈으로 나가기" onClick={onHome} className="ml-auto grid h-12 w-12 place-items-center rounded-full bg-white text-3xl shadow-card">×</button>
    <SyncStatusDashboard syncJobId={syncJobId} pollIntervalMs={100} resultOverride={resultOverride} viewMode="store-change" storeChanges={storeChanges} />
    <button type="button" onClick={onHome} className="sticky bottom-[calc(16px+env(safe-area-inset-bottom))] mt-auto h-14 w-full rounded-[18px] bg-blue-600 text-[17px] font-bold text-white shadow-md active:scale-[.985]">확인 (홈으로 이동)</button>
  </main>;
}

export function App() {
  const [screen, setScreen] = useState<AppScreen>('HOME');
  const [syncJobId, setSyncJobId] = useState('');
  const [storeChanges, setStoreChanges] = useState<ProposalChange[]>([]);
  const storeProfileId = import.meta.env.VITE_STORE_PROFILE_ID ?? DEMO_STORE.id;
  const [reviewSummary, setReviewSummary] = useState<GetReviewSummaryResponse>(initialReviewSummary);
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
  return <div className="app-viewport"><div className="app-phone" data-testid="dashboard-container">
    {screen === 'HOME' && <Home reviewSummary={reviewSummary} onStore={() => setScreen('STORE_CHANGE')} onSeo={() => setScreen('SEO')} />}
    {screen === 'SEO' && <SeoGenerationWizard storeProfileId={storeProfileId} sourceReviews={reviewSummary.sourceReviews} reviewSummary={reviewSummary} onExit={goHome} />}
    {screen === 'STORE_CHANGE' && <main className="standalone-flow"><button className="standalone-flow__close" type="button" aria-label="홈으로 나가기" onClick={goHome}>‹</button><StoreChangeWizard storeProfileId={storeProfileId} onSyncHandoff={({ syncJobId: nextId, changes }) => { setSyncJobId(nextId); setStoreChanges(changes); setScreen('STORE_SYNC'); }} /></main>}
    {screen === 'STORE_SYNC' && <SyncResult onHome={goHome} syncJobId={syncJobId} resultOverride={null} storeChanges={storeChanges} />}
  </div></div>;
}
