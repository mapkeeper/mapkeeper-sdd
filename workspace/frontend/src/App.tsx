import { useState } from 'react';
import { SeoGenerationWizard } from '@/features/seo/SeoGenerationWizard';
import { StoreChangeWizard } from '@/features/store-change/StoreChangeWizard';
import { SyncStatusDashboard } from '@/components/SyncStatus/SyncStatus';
import type { PlatformResult } from '@/components/SyncStatus/SyncStatus';
import { MockScenarioPanel } from '@/mocks/MockScenarioPanel';
import { reviewSummaryFixture, sourceReviewFixtures } from '@/mocks/fixtures/storeFixtures';
import googleLogo from '@/assets/platforms/google.svg';
import naverLogo from '@/assets/platforms/naver.svg';
import kakaoLogo from '@/assets/platforms/kakao.svg';
import './App.css';

type AppScreen = 'HOME' | 'STORE_CHANGE' | 'SEO' | 'STORE_SYNC';

function Icon({ name, className = 'h-6 w-6' }: { name: 'bell' | 'mic' | 'store' | 'sparkle' | 'home' | 'info' | 'copy' | 'history' | 'settings'; className?: string }) {
  const paths = {
    bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/></>,
    mic: <><rect x="9" y="2" width="6" height="13" rx="3"/><path d="M5 10a7 7 0 0 0 14 0M12 17v5M8 22h8"/></>,
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
  { name: '구글', logo: googleLogo },
  { name: '네이버', logo: naverLogo },
  { name: '카카오', logo: kakaoLogo },
];

function Home({ onStore, onSeo }: { onStore(): void; onSeo(): void }) {
  return <main className="min-h-dvh bg-gray-50 pb-24 font-pretendard text-ink">
    <header className="flex items-center justify-between px-6 pb-5 pt-[calc(24px+env(safe-area-inset-top))]">
      <h1 className="!m-0 !text-[24px] !font-extrabold !text-[#184796]">MapKeeper</h1>
      <button type="button" aria-label="알림" className="grid h-12 w-12 place-items-center rounded-full bg-white text-gray-900 shadow-card"><Icon name="bell" /></button>
    </header>

    <div className="space-y-4 px-5">
      <section className="rounded-2xl bg-white p-5 shadow-card" aria-label="3사 연동 상태">
        <div className="mb-5 flex items-center gap-3">
          <span className="grid h-12 w-12 place-items-center rounded-xl bg-blue-50 text-blue-700"><Icon name="store" className="h-8 w-8" /></span>
          <div><h2 className="!m-0 !text-[20px] !font-bold">성경만두 요리전문점</h2><p className="m-0 text-[15px] font-medium text-gray-500">3사 연동 상태</p></div>
        </div>
        <div className="grid grid-cols-3 divide-x divide-gray-200">
          {platforms.map((platform) => <div key={platform.name} className="flex flex-col items-center gap-2">
            <img src={platform.logo} alt={`${platform.name} 로고`} className="h-9 w-9" />
            <span className="text-[15px] font-bold text-green-700">연결됨</span>
          </div>)}
        </div>
      </section>

      <button type="button" onClick={onStore} aria-label="매장정보 변경하기" className="group relative flex aspect-square w-full flex-col items-center justify-center overflow-hidden rounded-[28px] bg-gradient-to-br from-[#245fc9] to-[#123d91] px-6 text-white shadow-[0_14px_32px_rgba(31,87,189,.25)]">
        <span className="absolute inset-0 opacity-20 [background:radial-gradient(circle_at_50%_35%,white,transparent_35%)]" />
        <span className="relative mb-5 grid h-24 w-24 place-items-center rounded-full bg-white/95 text-[#2255ad] shadow-lg"><Icon name="mic" className="h-14 w-14" /></span>
        <strong className="relative text-[30px] leading-[1.35]">눌러서<br />매장 정보<br />변경하기</strong>
        <small className="relative mt-3 text-[17px] font-medium text-blue-100">음성으로 쉽고 빠르게!</small>
      </button>

      <button type="button" onClick={onSeo} className="flex min-h-[82px] w-full items-center gap-4 rounded-2xl bg-white px-5 text-left shadow-card" aria-label="AI 홍보 문구 만들기">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-blue-50 text-blue-600"><Icon name="sparkle" className="h-7 w-7" /></span>
        <span className="min-w-0 flex-1"><strong className="block text-[18px]">3사 맞춤 홍보문구 만들기</strong><small className="block text-[15px] font-medium text-gray-500">AI가 멋진 소개글을 만들어드려요</small></span>
        <span className="text-3xl font-light text-gray-400" aria-hidden="true">›</span>
      </button>
    </div>

    <nav className="fixed inset-x-0 bottom-0 z-20 mx-auto grid h-[78px] max-w-[480px] grid-cols-5 border-t border-gray-100 bg-white px-2 pb-[env(safe-area-inset-bottom)]" aria-label="하단 메뉴">
      {[['home','홈'],['store','매장 정보'],['sparkle','홍보문구'],['history','기록'],['settings','설정']].map(([icon,label], index) => <button key={label} type="button" className={`flex min-h-0 flex-col items-center justify-center gap-1 text-[12px] font-semibold ${index === 0 ? 'text-blue-600' : 'text-gray-500'}`}><Icon name={icon as 'home'} className="h-6 w-6" />{label}</button>)}
    </nav>
  </main>;
}

function SyncResult({ onHome, syncJobId, resultOverride }: { onHome(): void; syncJobId: string; resultOverride: PlatformResult[] | null }) {
  return <main className="flex min-h-dvh flex-col bg-gray-50 px-5 pb-[calc(16px+env(safe-area-inset-bottom))] pt-[calc(20px+env(safe-area-inset-top))] font-pretendard">
    <button type="button" aria-label="홈으로 나가기" onClick={onHome} className="ml-auto grid h-12 w-12 place-items-center rounded-full bg-white text-3xl shadow-card">×</button>
    <SyncStatusDashboard syncJobId={syncJobId} pollIntervalMs={100} resultOverride={resultOverride} />
    <button type="button" onClick={onHome} className="mt-auto h-14 w-full rounded-2xl bg-blue-600 text-[18px] font-bold text-white shadow-lg shadow-blue-200">홈으로 돌아가기</button>
  </main>;
}

export function App() {
  const [screen, setScreen] = useState<AppScreen>('HOME');
  const [syncJobId, setSyncJobId] = useState('');
  const [demoResults, setDemoResults] = useState<PlatformResult[] | null>(null);
  const mockMode = import.meta.env.VITE_API_MOCKING === 'true';
  const showDeveloperTools = import.meta.env.VITE_SHOW_DEVELOPER_TOOLS === 'true'
    || (import.meta.env.DEV && import.meta.env.VITE_SHOW_DEVELOPER_TOOLS !== 'false');
  const goHome = () => setScreen('HOME');
  return <div className="app-viewport"><div className="app-phone" data-testid="dashboard-container">
    {screen === 'HOME' && <Home onStore={() => setScreen('STORE_CHANGE')} onSeo={() => setScreen('SEO')} />}
    {screen === 'SEO' && <SeoGenerationWizard storeProfileId="store-123" sourceReviews={mockMode ? sourceReviewFixtures : []} {...(mockMode ? { reviewSummary: reviewSummaryFixture } : {})} onExit={goHome} syncResultOverride={demoResults} />}
    {screen === 'STORE_CHANGE' && <main className="standalone-flow"><button className="standalone-flow__close" type="button" aria-label="홈으로 나가기" onClick={goHome}>×</button><StoreChangeWizard storeProfileId="store-123" onSyncHandoff={({ syncJobId: nextId }) => { setSyncJobId(nextId); setScreen('STORE_SYNC'); }} /></main>}
    {screen === 'STORE_SYNC' && <SyncResult onHome={goHome} syncJobId={syncJobId} resultOverride={demoResults} />}
  </div>{showDeveloperTools && <footer className="developer-footer">
    <details>
      <summary><span aria-hidden="true">⚙️ </span>개발자용 모의 응답 설정</summary>
      <div className="developer-footer__controls" aria-label="동기화 결과 테스트 설정">
        <p>Step 2.5 동기화 결과를 즉시 전환합니다.</p>
        <div>
          <button type="button" onClick={() => setDemoResults([
            { id: 'google', name: '구글', status: 'SUCCESS' },
            { id: 'naver', name: '네이버', status: 'SUCCESS' },
            { id: 'kakao', name: '카카오', status: 'SUCCESS' },
          ])}>전체 성공 테스트</button>
          <button type="button" onClick={() => setDemoResults([
            { id: 'google', name: '구글', status: 'SUCCESS' },
            { id: 'naver', name: '네이버', status: 'SUCCESS' },
            { id: 'kakao', name: '카카오', status: 'FAIL', errorMessage: '접속 시간 초과' },
          ])}>일부 실패 테스트</button>
        </div>
        <button className="developer-footer__reset" type="button" onClick={() => setDemoResults(null)}>실제 응답 사용</button>
        {mockMode ? <MockScenarioPanel /> : null}
      </div>
    </details>
  </footer>}</div>;
}
