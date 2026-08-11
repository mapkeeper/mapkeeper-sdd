import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { reviewSummaryFixture, sourceReviewFixtures } from '@/mocks/fixtures/storeFixtures';
import { server } from '@/mocks/server';
import { SeoGenerationWizard } from '@/features/seo/SeoGenerationWizard';

async function reachInterview(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(screen.getByRole('button', { name: '다음 (문구 만들기)' }));
  await user.click(screen.getByRole('radio', { name: /매장 대표 소개글/ }));
  await user.click(screen.getByRole('button', { name: '선택 완료' }));
}

async function reachRecommendation(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await reachInterview(user);
  const answers = ['정성이 가득한 동네 맛집', '깊은 국물과 친절한 서비스', '만두전골'];
  const nextQuestions = ['가장 내세우고 싶은 특징이 있나요?', '대표 메뉴가 무엇인가요?'];
  for (const [index, answer] of answers.entries()) {
    await user.type(screen.getByRole('textbox', { name: '사장님 답변 입력' }), answer);
    await user.click(screen.getByRole('button', { name: '전송' }));
    if (index < nextQuestions.length) {
      expect(await screen.findByText(nextQuestions[index] as string, {}, { timeout: 1_500 })).toBeInTheDocument();
    }
  }
  await user.click(screen.getByRole('button', { name: '문구 추천받기' }));
  expect(await screen.findByRole('heading', { name: '3사 전체 추천 문구를 확인해 주세요' })).toBeInTheDocument();
}

describe('SeoGenerationWizard mobile flow', () => {
  test('2.1~2.4는 한 번에 한 화면만 보이며 헤더 뒤로가기와 진행률이 동작한다', async () => {
    const user = userEvent.setup();
    render(<SeoGenerationWizard storeProfileId="store-123" sourceReviews={sourceReviewFixtures} reviewSummary={reviewSummaryFixture} />);
    expect(screen.getByRole('heading', { name: '사장님! 손님들 리뷰를 분석해 보았어요' })).toBeInTheDocument();
    expect(screen.getByText('총 128건 분석')).toBeInTheDocument();
    expect(screen.getByText('#속이알찬')).toBeInTheDocument();
    expect(screen.getByLabelText('SEO 작성 진행률')).toHaveAttribute('value', '1');

    await user.click(screen.getByRole('button', { name: '다음 (문구 만들기)' }));
    expect(screen.getByRole('heading', { name: '어떤 문구를 작성할까요?' })).toBeInTheDocument();
    expect(screen.queryByText('총 128건 분석')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '이전 단계로' }));
    expect(screen.getByText('총 128건 분석')).toBeInTheDocument();
  });

  test('목적과 인터뷰 답변은 로컬에 두고 마스킹 리뷰 ID로 세 플랫폼 초안을 생성한다', async () => {
    const user = userEvent.setup();
    let requestBody: unknown;
    server.use(http.post('*/api/v1/seo/generations', async ({ request }) => {
      requestBody = await request.json();
      return HttpResponse.json({
        success: true, status: 'SUCCESS',
        data: {
          generationId: 'gen-001',
          drafts: [
            { draftId: 'draft-001', platform: 'google', draftText: '추천 소개글', contentRules: ['rule'], status: 'DRAFT' },
            { draftId: 'draft-002', platform: 'naver', draftText: '네이버 문구', contentRules: ['rule'], status: 'DRAFT' },
            { draftId: 'draft-003', platform: 'kakao', draftText: '카카오 문구', contentRules: ['rule'], status: 'DRAFT' },
          ],
        }, error: null, timestamp: '2026-08-03T00:00:00Z',
      }, { status: 201 });
    }));
    render(<SeoGenerationWizard storeProfileId="store-123" sourceReviews={sourceReviewFixtures} reviewSummary={reviewSummaryFixture} />);
    await reachRecommendation(user);

    expect(requestBody).toEqual({
      storeProfileId: 'store-123',
      briefText: '정성이 가득한 동네 맛집 깊은 국물과 친절한 서비스 만두전골',
      seedKeywords: ['속이알찬', '친절함', '주차편함'],
      sourceReviewIds: ['review-001'],
    });
    expect(screen.getByText('추천 소개글')).toBeInTheDocument();
    expect(screen.getByText('#속이알찬')).toBeInTheDocument();
  });

  test('업로드 버튼 클릭만 한 번의 전체 승인과 SyncJob handoff를 실행한다', async () => {
    const user = userEvent.setup();
    const approvalRequests: Array<{ key: string | null; body: string }> = [];
    server.use(
      http.post('*/api/v1/seo/generations/gen-001/approve', async ({ request }) => {
        approvalRequests.push({ key: request.headers.get('Idempotency-Key'), body: await request.text() });
        return HttpResponse.json({ success: true, status: 'PROCESSING', data: { generationId: 'gen-001', generationStatus: 'APPROVED', approvedPlatforms: ['google', 'naver', 'kakao'], syncJobId: 'job-001', status: 'PENDING', statusUrl: '/api/v1/sync-jobs/job-001' }, error: null, timestamp: '2026-08-03T00:00:00Z' });
      }),
    );
    const onSyncHandoff = vi.fn();
    render(<SeoGenerationWizard storeProfileId="store-123" sourceReviews={sourceReviewFixtures} reviewSummary={reviewSummaryFixture} onSyncHandoff={onSyncHandoff} />);
    await reachRecommendation(user);

    await user.keyboard('{Enter}');
    expect(approvalRequests).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: '3사 전체 승인' }));
    await waitFor(() => expect(onSyncHandoff).toHaveBeenCalledWith({ syncJobId: 'job-001', statusUrl: '/api/v1/sync-jobs/job-001' }));
    expect(approvalRequests).toHaveLength(1);
    expect(approvalRequests[0]?.key).toBeTruthy();
    expect(approvalRequests[0]?.body).toBe('');
    expect(screen.getByRole('heading', { name: '3사에 반영되었습니다!' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '확인 (홈으로 이동)' })).toBeInTheDocument();
  });

  test('답변 누락을 막고 취소와 닫기는 승인 없이 홈 callback을 호출한다', async () => {
    const user = userEvent.setup();
    const onExit = vi.fn();
    render(<SeoGenerationWizard storeProfileId="store-123" sourceReviews={sourceReviewFixtures} reviewSummary={reviewSummaryFixture} onExit={onExit} />);
    await reachInterview(user);
    expect(screen.getByText('사장님의 가게를 한 줄로 표현해주세요.')).toBeInTheDocument();
    expect(screen.queryByText('가장 내세우고 싶은 특징이 있나요?')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '문구 추천받기' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '이전 단계로' }));
    await user.click(screen.getByRole('button', { name: '이전 단계로' }));
    await user.click(screen.getByRole('button', { name: '홈으로 나가기' }));
    expect(onExit).toHaveBeenCalledOnce();
  });

  test('답변을 보낼 때 사용자 말풍선과 타이핑 상태를 거쳐 질문을 하나씩 공개한다', async () => {
    const user = userEvent.setup();
    render(<SeoGenerationWizard storeProfileId="store-123" sourceReviews={sourceReviewFixtures} reviewSummary={reviewSummaryFixture} />);
    await reachInterview(user);

    expect(screen.getByText('사장님의 가게를 한 줄로 표현해주세요.')).toBeInTheDocument();
    expect(screen.queryByText('가장 내세우고 싶은 특징이 있나요?')).not.toBeInTheDocument();

    await user.type(screen.getByRole('textbox', { name: '사장님 답변 입력' }), '동네의 따뜻한 만두집');
    await user.click(screen.getByRole('button', { name: '전송' }));
    expect(screen.getByText('동네의 따뜻한 만두집')).toHaveClass('chat-bubble--owner');
    expect(screen.getByRole('status')).toHaveTextContent('AI가 답변을 작성하고 있습니다.');
    expect(screen.queryByText('가장 내세우고 싶은 특징이 있나요?')).not.toBeInTheDocument();

    expect(await screen.findByText('가장 내세우고 싶은 특징이 있나요?', {}, { timeout: 1_500 })).toBeInTheDocument();
    await user.type(screen.getByRole('textbox', { name: '사장님 답변 입력' }), '깊은 국물과 친절함');
    await user.click(screen.getByRole('button', { name: '전송' }));
    expect(await screen.findByText('대표 메뉴가 무엇인가요?', {}, { timeout: 1_500 })).toBeInTheDocument();
    await user.type(screen.getByRole('textbox', { name: '사장님 답변 입력' }), '만두전골');
    await user.click(screen.getByRole('button', { name: '전송' }));

    expect(screen.queryByRole('textbox', { name: '사장님 답변 입력' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '문구 추천받기' })).toBeEnabled();
  });

  test('리뷰 요약 API/Mock 상태를 Props로 받아 요약, 키워드, 건수를 동적으로 표시한다', () => {
    const { rerender } = render(
      <SeoGenerationWizard
        storeProfileId="store-123"
        sourceReviews={sourceReviewFixtures}
        reviewSummary={{ summary: '단골 손님의 재방문 칭찬이 많아요.', keywords: ['재방문', '푸짐함'], reviewCount: 47 }}
      />,
    );

    expect(screen.getByText('단골 손님의 재방문 칭찬이 많아요.')).toBeInTheDocument();
    expect(screen.getByText('#재방문')).toBeInTheDocument();
    expect(screen.getByText('#푸짐함')).toBeInTheDocument();
    expect(screen.getByText('총 47건 분석')).toBeInTheDocument();

    rerender(
      <SeoGenerationWizard
        storeProfileId="store-123"
        sourceReviews={sourceReviewFixtures}
        reviewSummary={{ summary: '새 리뷰 분석 결과예요.', keywords: ['친절'], reviewCount: 9 }}
      />,
    );
    expect(screen.getByText('새 리뷰 분석 결과예요.')).toBeInTheDocument();
    expect(screen.getByText('#친절')).toBeInTheDocument();
    expect(screen.getByText('총 9건 분석')).toBeInTheDocument();

    rerender(
      <SeoGenerationWizard
        storeProfileId="store-123"
        sourceReviews={sourceReviewFixtures}
        reviewSummary={{ summary: '키워드가 비어 있는 분석 결과예요.', keywords: [], reviewCount: 3 }}
      />,
    );
    expect(screen.getByText('#맛있는메뉴')).toBeInTheDocument();
  });
});
