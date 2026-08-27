import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { DEMO_SOURCE_REVIEW_ID } from '@/config/demoStore';
import { reviewSummaryFixture, sourceReviewFixtures } from '@/mocks/fixtures/storeFixtures';
import { server } from '@/mocks/server';
import { SeoGenerationWizard } from '@/features/seo/SeoGenerationWizard';
import { describeHolidayRange, matchKoreanHoliday } from '@/features/seo/holidays';

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
    // The copy is editable where it is read, and the hashtags shown beside it are
    // the ones the model returned for this platform.
    expect(screen.getByRole('textbox', { name: /구글에 올릴 문구/ })).toHaveValue('추천 소개글');
    expect(screen.getByText('#구글추천')).toBeInTheDocument();
  });

  test('문구 생성이 오래 걸리는 동안 대기 안내 문구를 보여준다', async () => {
    const user = userEvent.setup();
    server.use(http.post('*/api/v1/seo/generations', async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
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
    await reachInterview(user);
    await answerInterview(user, ['정성이 가득한 동네 맛집', '깊은 국물과 친절한 서비스', '만두전골']);
    await user.click(screen.getByRole('button', { name: '문구 추천받기' }));

    expect(screen.getByRole('button', { name: '추천 문구 만드는 중…' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('최대 1분 정도 걸릴 수 있어요.');
    expect(await screen.findByRole('heading', { name: '3사 전체 추천 문구를 확인해 주세요' })).toBeInTheDocument();
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

  test('내용 수정은 인터뷰로 돌아가 기존 답변을 유지하고, 답변 수정 후 재생성한다', async () => {
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

    await user.click(screen.getByRole('button', { name: '질문 다시 답하기' }));

    // Prior answers are kept, not wiped, so the owner edits only what changed.
    expect(await screen.findByText('정성이 가득한 동네 맛집')).toBeInTheDocument();
    expect(screen.getByText('깊은 국물과 친절한 서비스')).toBeInTheDocument();
    expect(screen.getByText('만두전골')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '질문 3 답변 수정' }));
    await user.clear(screen.getByRole('textbox', { name: '사장님 답변 입력' }));
    await user.type(screen.getByRole('textbox', { name: '사장님 답변 입력' }), '김치만두');
    await user.click(screen.getByRole('button', { name: '전송' }));
    await user.click(screen.getByRole('button', { name: '문구 추천받기' }));

    // Each platform keeps its own text, reachable from its own tab.
    expect(await screen.findByDisplayValue('수정된 구글 문구')).toBeInTheDocument();
    expect(screen.getByText('#재생성')).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: '네이버' }));
    expect(screen.getByRole('textbox', { name: /네이버에 올릴 문구/ })).toHaveValue('수정된 네이버 문구');
    expect(regenerateBody).toMatchObject({
      purpose: 'INTRODUCTION',
      briefText: '정성이 가득한 동네 맛집. 깊은 국물과 친절한 서비스. 김치만두.',
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
    // A follow-up is announced as one, not renumbered into "질문 4 / 4" after the
    // purpose screen promised three.
    expect(screen.getByRole('heading', { name: 'AI 인터뷰' }).parentElement).toHaveTextContent('추가 질문');
    await user.type(screen.getByRole('textbox', { name: '사장님 답변 입력' }), '8월 15일부터 16일까지예요');
    await user.click(screen.getByRole('button', { name: '전송' }));
    expect(await screen.findByRole('heading', { name: '소식 기간을 확인해 주세요' })).toBeInTheDocument();
    expect(screen.getByLabelText('시작일')).toHaveValue('2026-08-15');
    expect(screen.getByLabelText('종료일')).toHaveValue('2026-08-16');
    fireEvent.change(screen.getByLabelText('종료일'), { target: { value: '2026-08-17' } });
    await user.click(screen.getByRole('button', { name: '이 기간으로 문구 만들기' }));
    await user.click(screen.getByRole('button', { name: '문구 추천받기' }));
    expect(await screen.findByRole('heading', { name: '가게 소식 문구를 확인해 주세요' })).toBeInTheDocument();
    expect(screen.getByRole('article', { name: '가게 소식 요약' })).toBeInTheDocument();
    expect(screen.getByLabelText('반영한 요청 내용')).toHaveTextContent('이번 주말 할인 이벤트. 만두전골을 할인해요.');
    expect(screen.getByRole('button', { name: '이 소식을 3사에 게시' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '질문 다시 답하기' }));

    // The interview is shown again, but prior answers are kept rather than
    // wiped: no quick-start prompt for a fresh answer, and no input box
    // since every question is already answered.
    expect(await screen.findByText(/어떤 가게 소식을 알려드릴까요/)).toBeInTheDocument();
    expect(screen.getByText('이번 주말 할인 이벤트')).toBeInTheDocument();
    expect(screen.getByText('만두전골을 할인해요')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '신메뉴' })).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: '사장님 답변 입력' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '문구 추천받기' })).toBeInTheDocument();
    expect(requestBody).toMatchObject({
      purpose: 'NEWS',
      briefText: expect.stringContaining('행사 기간은 2026-08-15부터 2026-08-17까지입니다.'),
    });
    // The raw interview answer that stated the date is superseded by the
    // structured schedule sentence above, so it is not sent twice.
    expect((requestBody as { briefText: string }).briefText).not.toContain('8월 15일부터 16일까지예요');
  });

  test('소식 기간을 "기간 없이 게시"로 바꾸면 이전에 답한 날짜 문구가 함께 전송되지 않는다', async () => {
    const user = userEvent.setup();
    let requestBody: unknown;
    server.use(http.post('*/api/v1/seo/generations', async ({ request }) => {
      requestBody = await request.json();
      return HttpResponse.json({
        success: true,
        status: 'SUCCESS',
        data: {
          generationId: 'gen-news-002',
          status: 'DRAFT',
          revision: 1,
          drafts: [
            { draftId: 'draft-news-101', platform: 'google', draftText: '새소식', keywords: ['새소식'], contentRules: ['rule'] },
            { draftId: 'draft-news-102', platform: 'naver', draftText: '새소식', keywords: ['새소식'], contentRules: ['rule'] },
            { draftId: 'draft-news-103', platform: 'kakao', draftText: '새소식', keywords: ['새소식'], contentRules: ['rule'] },
          ],
        },
        error: null,
        timestamp: '2026-08-03T00:00:00Z',
      }, { status: 201 });
    }));
    render(<SeoGenerationWizard storeProfileId="store-123" sourceReviews={sourceReviewFixtures} reviewSummary={reviewSummaryFixture} />);
    await reachNewsInterview(user);

    await user.click(screen.getByRole('button', { name: '신메뉴' }));
    await user.click(screen.getByRole('button', { name: '전송' }));
    expect(await screen.findByText(/새 메뉴 이름과 가장 자랑하고 싶은 점을 알려주세요/)).toBeInTheDocument();
    await user.type(screen.getByRole('textbox', { name: '사장님 답변 입력' }), '새 메뉴가 나왔어요');
    await user.click(screen.getByRole('button', { name: '전송' }));
    expect(await screen.findByText(/신메뉴는 언제부터 언제까지 판매하나요/)).toBeInTheDocument();
    await user.type(screen.getByRole('textbox', { name: '사장님 답변 입력' }), '8월 15일부터 16일까지예요');
    await user.click(screen.getByRole('button', { name: '전송' }));
    expect(await screen.findByRole('heading', { name: '소식 기간을 확인해 주세요' })).toBeInTheDocument();

    // The owner reconsiders and opts out of a date after already stating one.
    await user.click(screen.getByRole('button', { name: '기간 없이 게시할게요' }));
    await user.click(screen.getByRole('button', { name: '기간 없이 문구 만들기' }));
    await user.click(screen.getByRole('button', { name: '문구 추천받기' }));

    expect(await screen.findByRole('heading', { name: '가게 소식 문구를 확인해 주세요' })).toBeInTheDocument();
    const briefText = (requestBody as { briefText: string }).briefText;
    expect(briefText).toContain('행사 기간은 없습니다.');
    expect(briefText).not.toContain('8월 15일부터 16일까지예요');
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

  test('운영시간 변경 소식을 게시하면 실제 영업시간(UC1)도 바꾸도록 안내한다', async () => {
    const user = userEvent.setup();
    const onStoreChangeRequested = vi.fn();
    server.use(
      http.post('*/api/v1/seo/generations', () => HttpResponse.json({
        success: true,
        status: 'SUCCESS',
        data: {
          generationId: 'gen-news-201',
          status: 'DRAFT',
          revision: 1,
          drafts: [
            { draftId: 'draft-201', platform: 'google', draftText: '영업시간 변경 안내', keywords: ['영업시간'], contentRules: ['rule'] },
            { draftId: 'draft-202', platform: 'naver', draftText: '영업시간 변경 안내', keywords: ['영업시간'], contentRules: ['rule'] },
            { draftId: 'draft-203', platform: 'kakao', draftText: '영업시간 변경 안내', keywords: ['영업시간'], contentRules: ['rule'] },
          ],
        },
        error: null,
        timestamp: '2026-08-03T00:00:00Z',
      }, { status: 201 })),
      http.post('*/api/v1/seo/generations/gen-news-201/approve', () => HttpResponse.json({
        success: true,
        status: 'PROCESSING',
        data: { generationId: 'gen-news-201', generationStatus: 'APPROVED', approvedPlatforms: ['google', 'naver', 'kakao'], syncJobId: 'job-hours', status: 'PENDING', statusUrl: '/api/v1/sync-jobs/job-hours' },
        error: null,
        timestamp: '2026-08-03T00:00:00Z',
      })),
    );
    render(<SeoGenerationWizard storeProfileId="store-123" sourceReviews={sourceReviewFixtures} reviewSummary={reviewSummaryFixture} onStoreChangeRequested={onStoreChangeRequested} />);
    await reachNewsInterview(user);

    await user.click(screen.getByRole('button', { name: '운영시간 변경' }));
    await user.click(screen.getByRole('button', { name: '전송' }));
    expect(await screen.findByText(/변경할 영업시간을 알려주세요/)).toBeInTheDocument();
    await user.type(screen.getByRole('textbox', { name: '사장님 답변 입력' }), '밤 11시까지로 늘려요');
    await user.click(screen.getByRole('button', { name: '전송' }));
    expect(await screen.findByText(/언제부터 적용되나요/)).toBeInTheDocument();
    await user.type(screen.getByRole('textbox', { name: '사장님 답변 입력' }), '없어요');
    await user.click(screen.getByRole('button', { name: '전송' }));
    await user.click(screen.getByRole('button', { name: '기간 없이 문구 만들기' }));
    await user.click(screen.getByRole('button', { name: '문구 추천받기' }));
    expect(await screen.findByRole('heading', { name: '가게 소식 문구를 확인해 주세요' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '이 소식을 3사에 게시' }));

    expect(await screen.findByRole('heading', { name: '3사에 반영되었습니다!' })).toBeInTheDocument();
    const bridgeButton = screen.getByRole('button', { name: '실제 영업시간도 바꾸기' });
    await user.click(bridgeButton);
    expect(onStoreChangeRequested).toHaveBeenCalledOnce();
  });

  test('운영시간과 무관한 소식에는 실제 영업시간 안내가 뜨지 않는다', async () => {
    const user = userEvent.setup();
    server.use(
      http.post('*/api/v1/seo/generations', () => HttpResponse.json({
        success: true,
        status: 'SUCCESS',
        data: {
          generationId: 'gen-news-301',
          status: 'DRAFT',
          revision: 1,
          drafts: [
            { draftId: 'draft-301', platform: 'google', draftText: '신메뉴 안내', keywords: ['신메뉴'], contentRules: ['rule'] },
            { draftId: 'draft-302', platform: 'naver', draftText: '신메뉴 안내', keywords: ['신메뉴'], contentRules: ['rule'] },
            { draftId: 'draft-303', platform: 'kakao', draftText: '신메뉴 안내', keywords: ['신메뉴'], contentRules: ['rule'] },
          ],
        },
        error: null,
        timestamp: '2026-08-03T00:00:00Z',
      }, { status: 201 })),
      http.post('*/api/v1/seo/generations/gen-news-301/approve', () => HttpResponse.json({
        success: true,
        status: 'PROCESSING',
        data: { generationId: 'gen-news-301', generationStatus: 'APPROVED', approvedPlatforms: ['google', 'naver', 'kakao'], syncJobId: 'job-menu', status: 'PENDING', statusUrl: '/api/v1/sync-jobs/job-menu' },
        error: null,
        timestamp: '2026-08-03T00:00:00Z',
      })),
    );
    render(<SeoGenerationWizard storeProfileId="store-123" sourceReviews={sourceReviewFixtures} reviewSummary={reviewSummaryFixture} />);
    await reachNewsInterview(user);

    await user.click(screen.getByRole('button', { name: '신메뉴' }));
    await user.click(screen.getByRole('button', { name: '전송' }));
    expect(await screen.findByText(/새 메뉴 이름과 가장 자랑하고 싶은 점을 알려주세요/)).toBeInTheDocument();
    await user.type(screen.getByRole('textbox', { name: '사장님 답변 입력' }), '고기만두가 나왔어요');
    await user.click(screen.getByRole('button', { name: '전송' }));
    expect(await screen.findByText(/신메뉴는 언제부터 언제까지 판매하나요/)).toBeInTheDocument();
    await user.type(screen.getByRole('textbox', { name: '사장님 답변 입력' }), '없어요');
    await user.click(screen.getByRole('button', { name: '전송' }));
    await user.click(screen.getByRole('button', { name: '기간 없이 문구 만들기' }));
    await user.click(screen.getByRole('button', { name: '문구 추천받기' }));
    expect(await screen.findByRole('heading', { name: '가게 소식 문구를 확인해 주세요' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '이 소식을 3사에 게시' }));

    expect(await screen.findByRole('heading', { name: '3사에 반영되었습니다!' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '실제 영업시간도 바꾸기' })).not.toBeInTheDocument();
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
    // Nothing analysed means nothing to show. Filling the gap with defaults put
    // "#맛있는메뉴 #친절함 #다시찾는집" beside "총 0건" and into the copy itself.
    expect(screen.queryByLabelText('주요 리뷰 키워드')).not.toBeInTheDocument();
    expect(screen.getByText(/리뷰가 쌓인 뒤에 알려드릴게요/)).toBeInTheDocument();
  });

  test('리뷰가 0건이면 키워드를 지어내지 않고 생성 요청에도 넣지 않는다', async () => {
    const user = userEvent.setup();
    let requestBody: unknown;
    server.use(http.post('*/api/v1/seo/generations', async ({ request }) => {
      requestBody = await request.json();
      return HttpResponse.json({
        success: true, status: 'SUCCESS',
        data: {
          generationId: 'gen-001', status: 'DRAFT', revision: 1,
          drafts: [
            { draftId: 'draft-001', platform: 'google', draftText: '구글 문구', keywords: ['만두전골'], contentRules: ['rule'] },
            { draftId: 'draft-002', platform: 'naver', draftText: '네이버 문구', keywords: ['만두전골'], contentRules: ['rule'] },
            { draftId: 'draft-003', platform: 'kakao', draftText: '카카오 문구', keywords: ['만두전골'], contentRules: ['rule'] },
          ],
        }, error: null, timestamp: '2026-08-27T00:00:00Z',
      }, { status: 201 });
    }));
    render(
      <SeoGenerationWizard
        storeProfileId="store-123"
        sourceReviews={[]}
        reviewSummary={{ summary: '아직 분석할 리뷰가 없어요.', keywords: [], reviewCount: 0 }}
      />,
    );

    expect(screen.getByText('총 0건 분석')).toBeInTheDocument();
    expect(screen.queryByLabelText('주요 리뷰 키워드')).not.toBeInTheDocument();

    await reachInterview(user);
    await answerInterview(user, ['정성이 가득한 동네 맛집', '깊은 국물과 친절한 서비스', '만두전골']);
    await user.click(screen.getByRole('button', { name: '문구 추천받기' }));
    expect(await screen.findByRole('heading', { name: '3사 전체 추천 문구를 확인해 주세요' })).toBeInTheDocument();

    // Nothing was analysed, so nothing about customer reaction is asserted to
    // the model either.
    expect(requestBody).toMatchObject({ seedKeywords: [] });
  });

  test('플랫폼 탭마다 서로 다른 문구를 보여준다', async () => {
    const user = userEvent.setup();
    server.use(http.post('*/api/v1/seo/generations', () => HttpResponse.json({
      success: true, status: 'SUCCESS',
      data: {
        generationId: 'gen-001', status: 'DRAFT', revision: 1,
        drafts: [
          { draftId: 'draft-001', platform: 'google', draftText: '구글용 사실 중심 문구', keywords: ['구글'], contentRules: ['사실 중심'] },
          { draftId: 'draft-002', platform: 'naver', draftText: '네이버용 검색어 포함 문구', keywords: ['네이버'], contentRules: ['검색어 포함'] },
          { draftId: 'draft-003', platform: 'kakao', draftText: '카카오용 짧은 문구', keywords: ['카카오'], contentRules: ['짧게'] },
        ],
      }, error: null, timestamp: '2026-08-27T00:00:00Z',
    }, { status: 201 })));
    render(<SeoGenerationWizard storeProfileId="store-123" sourceReviews={sourceReviewFixtures} reviewSummary={reviewSummaryFixture} />);
    await reachRecommendation(user);

    expect(screen.getByRole('textbox', { name: /구글에 올릴 문구/ })).toHaveValue('구글용 사실 중심 문구');
    await user.click(screen.getByRole('tab', { name: '네이버' }));
    expect(screen.getByRole('textbox', { name: /네이버에 올릴 문구/ })).toHaveValue('네이버용 검색어 포함 문구');
    await user.click(screen.getByRole('tab', { name: '카카오' }));
    expect(screen.getByRole('textbox', { name: /카카오에 올릴 문구/ })).toHaveValue('카카오용 짧은 문구');
  });

  test('결과 화면에서 고친 문구와 해시태그가 승인 전에 저장된다', async () => {
    const user = userEvent.setup();
    let editBody: unknown;
    let approveCalls = 0;
    server.use(
      http.post('*/api/v1/seo/generations', () => HttpResponse.json({
        success: true, status: 'SUCCESS',
        data: {
          generationId: 'gen-001', status: 'DRAFT', revision: 1,
          drafts: [
            { draftId: 'draft-001', platform: 'google', draftText: '구글 문구', keywords: ['구글'], contentRules: ['rule'] },
            { draftId: 'draft-002', platform: 'naver', draftText: '네이버 문구', keywords: ['네이버'], contentRules: ['rule'] },
            { draftId: 'draft-003', platform: 'kakao', draftText: '카카오 문구', keywords: ['카카오'], contentRules: ['rule'] },
          ],
        }, error: null, timestamp: '2026-08-27T00:00:00Z',
      }, { status: 201 })),
      http.patch('*/api/v1/seo/generations/gen-001/drafts', async ({ request }) => {
        editBody = await request.json();
        return HttpResponse.json({
          success: true, status: 'SUCCESS',
          data: {
            generationId: 'gen-001', status: 'DRAFT', revision: 2,
            drafts: [
              { draftId: 'draft-001', platform: 'google', draftText: '사장님이 고친 구글 문구', keywords: ['구글', '만두전골'], contentRules: ['rule'] },
              { draftId: 'draft-002', platform: 'naver', draftText: '네이버 문구', keywords: ['네이버'], contentRules: ['rule'] },
              { draftId: 'draft-003', platform: 'kakao', draftText: '카카오 문구', keywords: ['카카오'], contentRules: ['rule'] },
            ],
          }, error: null, timestamp: '2026-08-27T00:00:00Z',
        });
      }),
      http.post('*/api/v1/seo/generations/gen-001/approve', () => {
        approveCalls += 1;
        return HttpResponse.json({
          success: true, status: 'PROCESSING',
          data: {
            generationId: 'gen-001',
            generationStatus: 'APPROVED',
            approvedPlatforms: ['google', 'naver', 'kakao'],
            syncJobId: 'job-001',
            status: 'PENDING',
            statusUrl: '/api/v1/sync-jobs/job-001',
          }, error: null, timestamp: '2026-08-27T00:00:00Z',
        });
      }),
    );
    render(<SeoGenerationWizard storeProfileId="store-123" sourceReviews={sourceReviewFixtures} reviewSummary={reviewSummaryFixture} />);
    await reachRecommendation(user);

    const copy = screen.getByRole('textbox', { name: /구글에 올릴 문구/ });
    await user.clear(copy);
    await user.type(copy, '사장님이 고친 구글 문구');
    await user.type(screen.getByLabelText('해시태그 추가'), '만두전골');
    await user.click(screen.getByRole('button', { name: '추가' }));
    await user.click(screen.getByRole('button', { name: '3사 전체 승인' }));

    // Approval publishes what the server stored, so the edit has to be written
    // down first or the owner's correction never gets published.
    await waitFor(() => expect(approveCalls).toBe(1));
    expect(editBody).toMatchObject({
      drafts: expect.arrayContaining([
        { platform: 'google', draftText: '사장님이 고친 구글 문구', keywords: ['구글', '만두전골'] },
      ]),
    });
  });

  test('고치지 않고 승인하면 저장 호출 없이 바로 승인한다', async () => {
    const user = userEvent.setup();
    let editCalls = 0;
    server.use(
      http.patch('*/api/v1/seo/generations/gen-001/drafts', () => {
        editCalls += 1;
        return HttpResponse.json({ success: false, status: 'FAILED', data: null, error: null, timestamp: '' }, { status: 500 });
      }),
    );
    render(<SeoGenerationWizard storeProfileId="store-123" sourceReviews={sourceReviewFixtures} reviewSummary={reviewSummaryFixture} />);
    await reachRecommendation(user);
    await user.click(screen.getByRole('button', { name: '3사 전체 승인' }));

    expect(await screen.findByRole('heading', { name: '3사에 반영되었습니다!' })).toBeInTheDocument();
    expect(editCalls).toBe(0);
  });

  test('게시 기간 날짜를 지우면 플랫폼 노출에 미치는 영향을 알려준다', async () => {
    const user = userEvent.setup();
    render(<SeoGenerationWizard storeProfileId="store-123" sourceReviews={sourceReviewFixtures} reviewSummary={reviewSummaryFixture} />);
    await reachNewsInterview(user);
    await user.type(screen.getByRole('textbox', { name: '사장님 답변 입력' }), '할인 행사를 알려드리고 싶어요');
    await user.click(screen.getByRole('button', { name: '전송' }));
    expect(await screen.findByText(/어떤 메뉴를 얼마나 할인하나요/)).toBeInTheDocument();
    await user.type(screen.getByRole('textbox', { name: '사장님 답변 입력' }), '만두전골을 20% 할인해요');
    await user.click(screen.getByRole('button', { name: '전송' }));
    expect(await screen.findByText(/할인 행사는 언제부터 언제까지인가요/)).toBeInTheDocument();
    await user.type(screen.getByRole('textbox', { name: '사장님 답변 입력' }), '9월 1일부터 9월 3일까지예요');
    await user.click(screen.getByRole('button', { name: '전송' }));
    await user.click(await screen.findByRole('button', { name: '이 기간으로 문구 만들기' }));
    await user.click(screen.getByRole('button', { name: '문구 추천받기' }));
    expect(await screen.findByRole('heading', { name: '가게 소식 문구를 확인해 주세요' })).toBeInTheDocument();

    const copy = screen.getByRole('textbox', { name: /구글에 올릴 문구/ });
    await user.clear(copy);
    await user.type(copy, '만두전골 할인합니다');

    expect(screen.getByText(/카카오맵·네이버는 안내가 정확하고 구체적일수록 잘 노출돼요/)).toBeInTheDocument();
  });

  test('추석 연휴 소식은 날짜를 다시 묻지 않고 이름과 함께 확인만 받는다', async () => {
    const user = userEvent.setup();
    render(<SeoGenerationWizard storeProfileId="store-123" sourceReviews={sourceReviewFixtures} reviewSummary={reviewSummaryFixture} />);
    await reachNewsInterview(user);

    await user.type(screen.getByRole('textbox', { name: '사장님 답변 입력' }), '추석 연휴 정상 영업합니다');
    await user.click(screen.getByRole('button', { name: '전송' }));

    // The holiday decides which questions come next: whether the store is open,
    // then its hours — not "어떤 혜택이 있는지", which invites an offer that does
    // not exist.
    expect(await screen.findByText(/연휴에 정상 영업하시나요/)).toBeInTheDocument();
    await user.type(screen.getByRole('textbox', { name: '사장님 답변 입력' }), '연휴 내내 정상 영업해요');
    await user.click(screen.getByRole('button', { name: '전송' }));
    expect(await screen.findByText(/연휴 동안 영업시간은 어떻게 되나요/)).toBeInTheDocument();
    await user.type(screen.getByRole('textbox', { name: '사장님 답변 입력' }), '평소와 같아요');
    await user.click(screen.getByRole('button', { name: '전송' }));

    // The owner already said which days they meant, so the app reads them back
    // by name instead of asking them to look 9월 24일~26일 up. Which 추석 that is
    // depends on when this runs, so the expectation is taken from the table
    // rather than pinned to one year.
    const chuseok = matchKoreanHoliday('추석 연휴');
    expect(chuseok).not.toBeNull();
    expect(await screen.findByText(`${chuseok?.name}인 ${describeHolidayRange(chuseok!)}가 맞나요?`)).toBeInTheDocument();
    expect(screen.getByLabelText('시작일')).toHaveValue(chuseok?.start);
    expect(screen.getByLabelText('종료일')).toHaveValue(chuseok?.end);
    expect(screen.getByRole('button', { name: '맞아요, 이 기간으로 만들기' })).toBeInTheDocument();
  });
});
