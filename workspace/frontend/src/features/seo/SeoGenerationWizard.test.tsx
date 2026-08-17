import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { DEMO_SOURCE_REVIEW_ID } from '@/config/demoStore';
import { reviewSummaryFixture, sourceReviewFixtures } from '@/mocks/fixtures/storeFixtures';
import { server } from '@/mocks/server';
import { SeoGenerationWizard } from '@/features/seo/SeoGenerationWizard';

async function reachInterview(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(screen.getByRole('button', { name: '다음 (문구 만들기)' }));
  await user.click(screen.getByRole('radio', { name: /매장 대표 소개글/ }));
  await user.click(screen.getByRole('button', { name: '선택 완료' }));
}

async function reachNewsInterview(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(screen.getByRole('button', { name: '다음 (문구 만들기)' }));
  await user.click(screen.getByRole('radio', { name: /오늘의 가게 소식/ }));
  await user.click(screen.getByRole('button', { name: '선택 완료' }));
}

async function reachRecommendation(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await reachInterview(user);
  await answerInterview(user, ['정성이 가득한 동네 맛집', '깊은 국물과 친절한 서비스', '만두전골']);
  await user.click(screen.getByRole('button', { name: '문구 추천받기' }));
  expect(await screen.findByRole('heading', { name: '3사 전체 추천 문구를 확인해 주세요' })).toBeInTheDocument();
}

async function answerInterview(
  user: ReturnType<typeof userEvent.setup>,
  answers: readonly [string, string, string],
): Promise<void> {
  const nextQuestions = ['가장 내세우고 싶은 특징이 있나요?', '대표 메뉴가 무엇인가요?'];
  for (const [index, answer] of answers.entries()) {
    await user.type(screen.getByRole('textbox', { name: '사장님 답변 입력' }), answer);
    await user.click(screen.getByRole('button', { name: '전송' }));
    if (index < nextQuestions.length) {
      expect(await screen.findByText(nextQuestions[index] as string, {}, { timeout: 1_500 })).toBeInTheDocument();
    }
  }
}

describe('SeoGenerationWizard mobile flow', () => {
  test('2.1~2.4는 한 번에 한 화면만 보이며 헤더 뒤로가기와 진행률이 동작한다', async () => {
    const user = userEvent.setup();
    render(<SeoGenerationWizard storeProfileId="store-123" sourceReviews={sourceReviewFixtures} reviewSummary={reviewSummaryFixture} />);
    expect(screen.getByRole('heading', { name: '사장님! 손님들 리뷰를 분석해 보았어요' })).toBeInTheDocument();
    expect(screen.getByText('총 128건 분석')).toBeInTheDocument();
    expect(screen.getByText('#속이알참')).toBeInTheDocument();
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
          status: 'DRAFT',
          revision: 1,
          drafts: [
            { draftId: 'draft-001', platform: 'google', draftText: '추천 소개글', keywords: ['구글추천'], contentRules: ['rule'] },
            { draftId: 'draft-002', platform: 'naver', draftText: '네이버 문구', keywords: ['네이버추천'], contentRules: ['rule'] },
            { draftId: 'draft-003', platform: 'kakao', draftText: '카카오 문구', keywords: ['카카오추천'], contentRules: ['rule'] },
          ],
        }, error: null, timestamp: '2026-08-03T00:00:00Z',
      }, { status: 201 });
    }));
    render(<SeoGenerationWizard storeProfileId="store-123" sourceReviews={sourceReviewFixtures} reviewSummary={reviewSummaryFixture} />);
    await reachRecommendation(user);

    expect(requestBody).toEqual({
      storeProfileId: 'store-123',
      purpose: 'INTRODUCTION',
      briefText: '정성이 가득한 동네 맛집. 깊은 국물과 친절한 서비스. 만두전골.',
      seedKeywords: ['속이알참', '친절함', '주차편함'],
      sourceReviewIds: [DEMO_SOURCE_REVIEW_ID],
    });
    expect(screen.getByText('추천 소개글')).toBeInTheDocument();
    expect(screen.getByText('#속이알참')).toBeInTheDocument();
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

  test('내용 수정은 기존 Generation을 재생성하고 반영하지 않기는 전체 거절을 기록한다', async () => {
    const user = userEvent.setup();
    let regenerateBody: unknown;
    let rejectCalls = 0;
    server.use(
      http.post('*/api/v1/seo/generations/gen-001/regenerate', async ({ request }) => {
        regenerateBody = await request.json();
        return HttpResponse.json({
          success: true,
          status: 'SUCCESS',
          data: {
            generationId: 'gen-001',
            status: 'DRAFT',
            revision: 2,
            drafts: [
              { draftId: 'draft-r1', platform: 'google', draftText: '수정된 구글 문구', keywords: ['재생성'], contentRules: ['rule'] },
              { draftId: 'draft-r2', platform: 'naver', draftText: '수정된 네이버 문구', keywords: ['재생성'], contentRules: ['rule'] },
              { draftId: 'draft-r3', platform: 'kakao', draftText: '수정된 카카오 문구', keywords: ['재생성'], contentRules: ['rule'] },
            ],
          },
          error: null,
          timestamp: '2026-08-03T00:00:00Z',
        });
      }),
      http.post('*/api/v1/seo/generations/gen-001/reject', async ({ request }) => {
        rejectCalls += 1;
        expect(await request.text()).toBe('');
        return HttpResponse.json({
          success: true,
          status: 'SUCCESS',
          data: {
            generationId: 'gen-001',
            status: 'REJECTED',
            revision: 2,
            drafts: [
              { draftId: 'draft-r1', platform: 'google', draftText: '수정된 구글 문구', keywords: ['재생성'], contentRules: ['rule'] },
              { draftId: 'draft-r2', platform: 'naver', draftText: '수정된 네이버 문구', keywords: ['재생성'], contentRules: ['rule'] },
              { draftId: 'draft-r3', platform: 'kakao', draftText: '수정된 카카오 문구', keywords: ['재생성'], contentRules: ['rule'] },
            ],
          },
          error: null,
          timestamp: '2026-08-03T00:00:00Z',
        });
      }),
    );
    render(<SeoGenerationWizard storeProfileId="store-123" sourceReviews={sourceReviewFixtures} reviewSummary={reviewSummaryFixture} />);
    await reachRecommendation(user);

    await user.click(screen.getByRole('button', { name: '내용 수정' }));
    await answerInterview(user, ['수정한 동네 맛집 소개', '새로운 특징', '김치만두']);
    await user.click(screen.getByRole('button', { name: '문구 추천받기' }));

    expect(await screen.findByText('수정된 구글 문구')).toBeInTheDocument();
    expect(screen.getAllByText('#재생성')).toHaveLength(3);
    expect(regenerateBody).toMatchObject({
      purpose: 'INTRODUCTION',
      briefText: '수정한 동네 맛집 소개. 새로운 특징. 김치만두.',
    });

    await user.click(screen.getByRole('button', { name: '이번에는 반영하지 않기' }));

    expect(await screen.findByRole('heading', { name: '문구를 반영하지 않았습니다' })).toBeInTheDocument();
    expect(rejectCalls).toBe(1);
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

  test('대표 소개글 인터뷰도 빠른 시작 버튼으로 첫 답변 예시를 채운다', async () => {
    const user = userEvent.setup();
    render(<SeoGenerationWizard storeProfileId="store-123" sourceReviews={sourceReviewFixtures} reviewSummary={reviewSummaryFixture} />);
    await reachInterview(user);

    await user.click(screen.getByRole('button', { name: '대표 메뉴 소개' }));

    expect(screen.getByRole('textbox', { name: '사장님 답변 입력' })).toHaveValue('대표 메뉴는 고기만두예요.');
  });

  test('완료한 답변도 수정하면 이후 질문부터 다시 답할 수 있다', async () => {
    const user = userEvent.setup();
    render(<SeoGenerationWizard storeProfileId="store-123" sourceReviews={sourceReviewFixtures} reviewSummary={reviewSummaryFixture} />);
    await reachInterview(user);
    const answers = ['정성이 가득한 동네 맛집', '깊은 국물과 친절한 서비스', '만두전골'];
    for (const [index, answer] of answers.entries()) {
      await user.type(screen.getByRole('textbox', { name: '사장님 답변 입력' }), answer);
      await user.click(screen.getByRole('button', { name: '전송' }));
      if (index < answers.length - 1) {
        const nextQuestion = index === 0 ? '가장 내세우고 싶은 특징이 있나요?' : '대표 메뉴가 무엇인가요?';
        expect(await screen.findByText(nextQuestion, {}, { timeout: 1_500 })).toBeInTheDocument();
      }
    }

    await user.click(screen.getByRole('button', { name: '질문 1 답변 수정' }));
    expect(screen.getByRole('textbox', { name: '사장님 답변 입력' })).toHaveValue(answers[0]);
    await user.clear(screen.getByRole('textbox', { name: '사장님 답변 입력' }));
    await user.type(screen.getByRole('textbox', { name: '사장님 답변 입력' }), '새롭게 정리한 동네 맛집 소개');
    await user.click(screen.getByRole('button', { name: '전송' }));

    expect(await screen.findByText('가장 내세우고 싶은 특징이 있나요?', {}, { timeout: 1_500 })).toBeInTheDocument();
    expect(screen.getByText('새롭게 정리한 동네 맛집 소개')).toBeInTheDocument();
    expect(screen.queryByText('깊은 국물과 친절한 서비스')).not.toBeInTheDocument();
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

  test('새소식 목적은 전용 질문을 사용하고 날짜 정보가 모호하면 한 번만 추가 질문한다', async () => {
    const user = userEvent.setup();
    let requestBody: unknown;
    server.use(http.post('*/api/v1/seo/generations', async ({ request }) => {
      requestBody = await request.json();
      return HttpResponse.json({
        success: true,
        status: 'SUCCESS',
        data: {
          generationId: 'gen-news-001',
          status: 'DRAFT',
          revision: 1,
          drafts: [
            { draftId: 'draft-news-001', platform: 'google', draftText: '새소식', keywords: ['새소식'], contentRules: ['rule'] },
            { draftId: 'draft-news-002', platform: 'naver', draftText: '새소식', keywords: ['새소식'], contentRules: ['rule'] },
            { draftId: 'draft-news-003', platform: 'kakao', draftText: '새소식', keywords: ['새소식'], contentRules: ['rule'] },
          ],
        },
        error: null,
        timestamp: '2026-08-03T00:00:00Z',
      }, { status: 201 });
    }));
    render(<SeoGenerationWizard storeProfileId="store-123" sourceReviews={sourceReviewFixtures} reviewSummary={reviewSummaryFixture} />);
    await reachNewsInterview(user);

    expect(screen.getByText(/어떤 가게 소식을 알려드릴까요/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '신메뉴' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '할인 행사' }));
    expect(screen.getByRole('textbox', { name: '사장님 답변 입력' })).toHaveValue('할인 행사를 알려드리고 싶어요.');
    await user.clear(screen.getByRole('textbox', { name: '사장님 답변 입력' }));
    await user.type(screen.getByRole('textbox', { name: '사장님 답변 입력' }), '이번 주말 할인 이벤트');
    await user.click(screen.getByRole('button', { name: '전송' }));
    expect(await screen.findByText(/어떤 메뉴를 얼마나 할인하나요/)).toBeInTheDocument();
    await user.type(screen.getByRole('textbox', { name: '사장님 답변 입력' }), '만두전골을 할인해요');
    await user.click(screen.getByRole('button', { name: '전송' }));
    expect(await screen.findByText(/할인 행사는 언제부터 언제까지인가요/)).toBeInTheDocument();
    await user.type(screen.getByRole('textbox', { name: '사장님 답변 입력' }), '곧 진행할 예정이에요');
    await user.click(screen.getByRole('button', { name: '전송' }));
    expect(await screen.findByText(/정확한 시작일과 종료일을 알려주세요/)).toBeInTheDocument();
    expect(screen.getByText('질문 4 / 4')).toBeInTheDocument();
    await user.type(screen.getByRole('textbox', { name: '사장님 답변 입력' }), '8월 15일부터 16일까지예요');
    await user.click(screen.getByRole('button', { name: '전송' }));
    expect(await screen.findByRole('heading', { name: '소식 기간을 확인해 주세요' })).toBeInTheDocument();
    expect(screen.getByLabelText('시작일')).toHaveValue('2026-08-15');
    expect(screen.getByLabelText('종료일')).toHaveValue('2026-08-16');
    fireEvent.change(screen.getByLabelText('종료일'), { target: { value: '2026-08-17' } });
    await user.click(screen.getByRole('button', { name: '이 기간으로 문구 만들기' }));
    await user.click(screen.getByRole('button', { name: '문구 추천받기' }));
    expect(await screen.findByRole('heading', { name: '가게 소식 문구를 확인해 주세요' })).toBeInTheDocument();
    expect(screen.getByRole('article', { name: '가게 소식 미리보기' })).toBeInTheDocument();
    expect(screen.getByLabelText('반영한 요청 내용')).toHaveTextContent('이번 주말 할인 이벤트. 만두전골을 할인해요.');
    expect(screen.getByRole('button', { name: '이 소식을 3사에 게시' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '내용 수정' }));
    expect(await screen.findByText(/어떤 가게 소식을 알려드릴까요/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '신메뉴' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: '사장님 답변 입력' })).toHaveValue('');
    expect(requestBody).toMatchObject({
      purpose: 'NEWS',
      briefText: expect.stringContaining('행사 기간은 2026-08-15부터 2026-08-17까지입니다.'),
    });
  });

  test('임시 휴무는 쉬는 날짜를 한 번만 묻고 다음 질문은 휴무 사유로 이어진다', async () => {
    const user = userEvent.setup();
    render(<SeoGenerationWizard storeProfileId="store-123" sourceReviews={sourceReviewFixtures} reviewSummary={reviewSummaryFixture} />);
    await reachNewsInterview(user);

    await user.click(screen.getByRole('button', { name: '임시 휴무' }));
    await user.click(screen.getByRole('button', { name: '전송' }));
    expect(await screen.findByText(/쉬는 날짜를 알려주세요/)).toBeInTheDocument();
    await user.type(screen.getByRole('textbox', { name: '사장님 답변 입력' }), '8월 20일에 쉬어요');
    await user.click(screen.getByRole('button', { name: '전송' }));

    expect(await screen.findByText(/휴무 사유나 손님께 함께 전하고 싶은 안내가 있나요/)).toBeInTheDocument();
    expect(screen.queryByText(/휴무일은 언제인가요/)).not.toBeInTheDocument();
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
