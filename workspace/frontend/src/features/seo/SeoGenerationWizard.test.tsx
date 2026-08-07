import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { reviewSummaryFixture, sourceReviewFixtures } from '@/mocks/fixtures/storeFixtures';
import { server } from '@/mocks/server';
import { SeoGenerationWizard } from '@/features/seo/SeoGenerationWizard';

const timestamp = '2026-08-03T00:00:00Z';
const generationId = '33333333-3333-4333-8333-333333333333';

function draftsFixture(revision: number, briefSuffix = '') {
  return [
    { draftId: `44444444-4444-4444-8444-44444444444${revision}`, platform: 'google', draftText: `구글 문구${briefSuffix}`, keywords: ['키워드'], contentRules: ['rule'] },
    { draftId: `55555555-5555-4555-8555-55555555555${revision}`, platform: 'naver', draftText: `네이버 문구${briefSuffix}`, keywords: ['키워드'], contentRules: ['rule'] },
    { draftId: `66666666-6666-4666-8666-66666666666${revision}`, platform: 'kakao', draftText: `카카오 문구${briefSuffix}`, keywords: ['키워드'], contentRules: ['rule'] },
  ];
}

async function goToCommonInput(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(screen.getByRole('button', { name: '다음 (문구 만들기)' }));
}

async function fillAndSubmitCommonInput(
  user: ReturnType<typeof userEvent.setup>,
  briefText: string,
  keywords: string[],
  submitLabel = '문구 만들기',
): Promise<void> {
  await user.type(screen.getByRole('textbox', { name: '공통 홍보 설명' }), briefText);
  for (const keyword of keywords) {
    await user.type(screen.getByRole('textbox', { name: '새 키워드' }), keyword);
    await user.click(screen.getByRole('button', { name: '추가' }));
  }
  await user.click(screen.getByRole('button', { name: submitLabel }));
}

function mockCreate(): void {
  server.use(http.post('*/api/v1/seo/generations', async () => HttpResponse.json({
    success: true, status: 'SUCCESS',
    data: { generationId, status: 'DRAFT', revision: 1, drafts: draftsFixture(1) },
    error: null, timestamp,
  }, { status: 201 })));
}

describe('SeoGenerationWizard mobile flow', () => {
  test('SUMMARY는 헤더 뒤로가기와 진행률을 제공하며 다음 단계로 이동한다', async () => {
    const user = userEvent.setup();
    render(<SeoGenerationWizard storeProfileId="11111111-1111-4111-8111-111111111111" sourceReviews={sourceReviewFixtures} reviewSummary={reviewSummaryFixture} />);
    expect(screen.getByRole('heading', { name: '사장님! 손님들 리뷰를 분석해 보았어요' })).toBeInTheDocument();
    expect(screen.getByText('총 128건 분석')).toBeInTheDocument();
    expect(screen.getByLabelText('SEO 작성 진행률')).toHaveAttribute('value', '1');

    await goToCommonInput(user);
    expect(screen.getByRole('heading', { name: '어떤 매장인지 알려주세요' })).toBeInTheDocument();
    expect(screen.queryByText('총 128건 분석')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '이전 단계로' }));
    expect(screen.getByText('총 128건 분석')).toBeInTheDocument();
  });

  test('공통 설명과 키워드로 Generation을 생성하면 세 플랫폼 결과를 읽기 전용으로 보여준다', async () => {
    const user = userEvent.setup();
    let requestBody: unknown;
    server.use(http.post('*/api/v1/seo/generations', async ({ request }) => {
      requestBody = await request.json();
      return HttpResponse.json({
        success: true, status: 'SUCCESS',
        data: { generationId, status: 'DRAFT', revision: 1, drafts: draftsFixture(1) },
        error: null, timestamp,
      }, { status: 201 });
    }));
    render(<SeoGenerationWizard storeProfileId="11111111-1111-4111-8111-111111111111" sourceReviews={sourceReviewFixtures} reviewSummary={reviewSummaryFixture} />);
    await goToCommonInput(user);
    await fillAndSubmitCommonInput(user, '만두전골의 깊은 국물 맛을 강조하고 싶어요.', ['만두전골', '가족외식']);

    expect(await screen.findByRole('heading', { name: 'Google·Naver·Kakao 문구를 확인해 주세요' })).toBeInTheDocument();
    expect(requestBody).toEqual({
      storeProfileId: '11111111-1111-4111-8111-111111111111',
      briefText: '만두전골의 깊은 국물 맛을 강조하고 싶어요.',
      seedKeywords: ['만두전골', '가족외식'],
      sourceReviewIds: ['55555555-5555-4555-8555-555555555555'],
    });
    expect(screen.getByRole('heading', { name: 'Google' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Naver' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Kakao' })).toBeInTheDocument();
    expect(screen.getByText('구글 문구')).toBeInTheDocument();
    // read-only: no selection/edit controls anywhere on the result screen
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  test('빈 설명, 빈/중복 키워드는 제출 버튼을 비활성 상태로 유지한다', async () => {
    const user = userEvent.setup();
    render(<SeoGenerationWizard storeProfileId="11111111-1111-4111-8111-111111111111" sourceReviews={sourceReviewFixtures} reviewSummary={reviewSummaryFixture} />);
    await goToCommonInput(user);

    expect(screen.getByRole('button', { name: '문구 만들기' })).toBeDisabled();

    await user.type(screen.getByRole('textbox', { name: '새 키워드' }), '만두전골');
    await user.click(screen.getByRole('button', { name: '추가' }));
    await user.type(screen.getByRole('textbox', { name: '새 키워드' }), '만두전골');
    await user.click(screen.getByRole('button', { name: '추가' }));
    expect(screen.getAllByText('#만두전골')).toHaveLength(1);
    expect(screen.getByRole('button', { name: '문구 만들기' })).toBeDisabled();

    await user.type(screen.getByRole('textbox', { name: '공통 홍보 설명' }), '설명');
    expect(screen.getByRole('button', { name: '문구 만들기' })).toBeEnabled();
  });

  test('서버 422 응답은 안내 메시지를 보여주고 다음 단계로 이동하지 않는다', async () => {
    const user = userEvent.setup();
    server.use(http.post('*/api/v1/seo/generations', () => HttpResponse.json({
      success: false, status: 'FAILED', data: null,
      error: { code: 'VALIDATION_ERROR', message: '입력을 확인해 주세요.' },
      timestamp,
    }, { status: 422 })));
    render(<SeoGenerationWizard storeProfileId="11111111-1111-4111-8111-111111111111" sourceReviews={sourceReviewFixtures} reviewSummary={reviewSummaryFixture} />);
    await goToCommonInput(user);
    await fillAndSubmitCommonInput(user, '설명', ['키워드']);

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Google·Naver·Kakao 문구를 확인해 주세요' })).not.toBeInTheDocument();
  });

  test('네트워크 오류는 안내 메시지를 보여주고 요청을 재시도할 수 있게 둔다', async () => {
    const user = userEvent.setup();
    server.use(http.post('*/api/v1/seo/generations', () => HttpResponse.error()));
    render(<SeoGenerationWizard storeProfileId="11111111-1111-4111-8111-111111111111" sourceReviews={sourceReviewFixtures} reviewSummary={reviewSummaryFixture} />);
    await goToCommonInput(user);
    await fillAndSubmitCommonInput(user, '설명', ['키워드']);

    expect(await screen.findByRole('alert')).toHaveTextContent('서버에 연결할 수 없습니다');
    expect(screen.getByRole('button', { name: '문구 만들기' })).toBeEnabled();
  });

  test('재생성은 storeProfileId 없이 공통 입력만 다시 보내고 세 결과와 revision을 교체한다', async () => {
    const user = userEvent.setup();
    mockCreate();
    render(<SeoGenerationWizard storeProfileId="11111111-1111-4111-8111-111111111111" sourceReviews={sourceReviewFixtures} reviewSummary={reviewSummaryFixture} />);
    await goToCommonInput(user);
    await fillAndSubmitCommonInput(user, '만두전골의 깊은 국물 맛을 강조하고 싶어요.', ['만두전골']);
    await screen.findByRole('heading', { name: 'Google·Naver·Kakao 문구를 확인해 주세요' });

    let regenerateBody: unknown;
    server.use(http.post(`*/api/v1/seo/generations/${generationId}/regenerate`, async ({ request }) => {
      regenerateBody = await request.json();
      return HttpResponse.json({
        success: true, status: 'SUCCESS',
        data: { generationId, status: 'DRAFT', revision: 2, drafts: draftsFixture(2, ' (수정)') },
        error: null, timestamp,
      });
    }));

    await user.click(screen.getByRole('button', { name: '다시 만들기' }));
    expect(screen.getByRole('heading', { name: '설명을 수정하고 다시 만들어요' })).toBeInTheDocument();
    await user.type(screen.getByRole('textbox', { name: '공통 홍보 설명' }), ' 추가로 강조');
    await user.click(screen.getByRole('button', { name: '다시 만들기' }));

    expect(await screen.findByText('구글 문구 (수정)')).toBeInTheDocument();
    expect(regenerateBody).not.toHaveProperty('storeProfileId');
    expect(regenerateBody).toMatchObject({ seedKeywords: ['만두전골'] });
  });

  test('반려는 별도 케이스로 REJECTED 상태를 표시하고 규정을 다시 만들기로 안내한다', async () => {
    const user = userEvent.setup();
    mockCreate();
    render(<SeoGenerationWizard storeProfileId="11111111-1111-4111-8111-111111111111" sourceReviews={sourceReviewFixtures} reviewSummary={reviewSummaryFixture} />);
    await goToCommonInput(user);
    await fillAndSubmitCommonInput(user, '설명', ['키워드']);
    await screen.findByRole('heading', { name: 'Google·Naver·Kakao 문구를 확인해 주세요' });

    server.use(http.post(`*/api/v1/seo/generations/${generationId}/reject`, () => HttpResponse.json({
      success: true, status: 'SUCCESS',
      data: { generationId, status: 'REJECTED', revision: 1, drafts: draftsFixture(1) },
      error: null, timestamp,
    })));

    await user.click(screen.getByRole('button', { name: '이 문구 반려하기' }));
    expect(await screen.findByText('이 문구는 반려되었어요. 새로 만들어 주세요.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '승인 (3사에 반영)' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '새로 만들기' }));
    expect(screen.getByRole('heading', { name: '어떤 매장인지 알려주세요' })).toBeInTheDocument();
  });

  test('승인 버튼만 approve를 호출하며 Body 없이 Idempotency-Key를 보내고 SyncJob으로 이동한다', async () => {
    const user = userEvent.setup();
    mockCreate();
    const approvalRequests: Array<{ key: string | null; body: string }> = [];
    server.use(http.post(`*/api/v1/seo/generations/${generationId}/approve`, async ({ request }) => {
      approvalRequests.push({ key: request.headers.get('Idempotency-Key'), body: await request.text() });
      return HttpResponse.json({
        success: true, status: 'PROCESSING',
        data: {
          generationId, generationStatus: 'APPROVED', approvedPlatforms: ['google', 'naver', 'kakao'],
          syncJobId: '66666666-6666-4666-8666-666666666666', status: 'PENDING',
          statusUrl: '/api/v1/sync-jobs/66666666-6666-4666-8666-666666666666',
        },
        error: null, timestamp,
      });
    }));
    const onSyncHandoff = vi.fn();
    render(<SeoGenerationWizard storeProfileId="11111111-1111-4111-8111-111111111111" sourceReviews={sourceReviewFixtures} reviewSummary={reviewSummaryFixture} onSyncHandoff={onSyncHandoff} />);
    await goToCommonInput(user);
    await fillAndSubmitCommonInput(user, '설명', ['키워드']);
    await screen.findByRole('heading', { name: 'Google·Naver·Kakao 문구를 확인해 주세요' });

    await user.click(screen.getByRole('button', { name: '승인 (3사에 반영)' }));
    await waitFor(() => expect(onSyncHandoff).toHaveBeenCalledWith({ syncJobId: '66666666-6666-4666-8666-666666666666', statusUrl: '/api/v1/sync-jobs/66666666-6666-4666-8666-666666666666' }));
    expect(approvalRequests).toHaveLength(1);
    expect(approvalRequests[0]?.key).toBeTruthy();
    expect(approvalRequests[0]?.body).toBe('');
    expect(screen.getByRole('heading', { name: '3사에 반영되었습니다!' })).toBeInTheDocument();
  });

  test('승인 버튼 연타는 한 번만 요청한다', async () => {
    const user = userEvent.setup();
    mockCreate();
    let approvalCount = 0;
    server.use(http.post(`*/api/v1/seo/generations/${generationId}/approve`, async () => {
      approvalCount += 1;
      await new Promise((resolve) => setTimeout(resolve, 30));
      return HttpResponse.json({
        success: true, status: 'PROCESSING',
        data: {
          generationId, generationStatus: 'APPROVED', approvedPlatforms: ['google', 'naver', 'kakao'],
          syncJobId: '66666666-6666-4666-8666-666666666666', status: 'PENDING',
          statusUrl: '/api/v1/sync-jobs/66666666-6666-4666-8666-666666666666',
        },
        error: null, timestamp,
      });
    }));
    render(<SeoGenerationWizard storeProfileId="11111111-1111-4111-8111-111111111111" sourceReviews={sourceReviewFixtures} reviewSummary={reviewSummaryFixture} />);
    await goToCommonInput(user);
    await fillAndSubmitCommonInput(user, '설명', ['키워드']);
    await screen.findByRole('heading', { name: 'Google·Naver·Kakao 문구를 확인해 주세요' });

    const approveButton = screen.getByRole('button', { name: '승인 (3사에 반영)' });
    await user.click(approveButton);
    await user.click(approveButton);
    await waitFor(() => expect(screen.getByRole('heading', { name: '3사에 반영되었습니다!' })).toBeInTheDocument());
    expect(approvalCount).toBe(1);
  });

  test('닫기는 승인 없이 홈 callback을 호출한다', async () => {
    const user = userEvent.setup();
    const onExit = vi.fn();
    render(<SeoGenerationWizard storeProfileId="11111111-1111-4111-8111-111111111111" sourceReviews={sourceReviewFixtures} reviewSummary={reviewSummaryFixture} onExit={onExit} />);
    await user.click(screen.getByRole('button', { name: '홈으로 나가기' }));
    expect(onExit).toHaveBeenCalledOnce();
  });

  test('리뷰 요약 API/Mock 상태를 Props로 받아 요약, 키워드, 건수를 동적으로 표시한다', () => {
    const { rerender } = render(
      <SeoGenerationWizard
        storeProfileId="11111111-1111-4111-8111-111111111111"
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
        storeProfileId="11111111-1111-4111-8111-111111111111"
        sourceReviews={sourceReviewFixtures}
        reviewSummary={{ summary: '키워드가 비어 있는 분석 결과예요.', keywords: [], reviewCount: 3 }}
      />,
    );
    expect(screen.getByText('#맛있는메뉴')).toBeInTheDocument();
  });
});
