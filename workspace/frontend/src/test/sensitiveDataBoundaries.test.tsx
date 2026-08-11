import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { SeoGenerationWizard } from '@/features/seo/SeoGenerationWizard';
import { sourceReviewFixtures } from '@/mocks/fixtures/storeFixtures';
import { server } from '@/mocks/server';
import { safeDiagnostic } from '@/services/safeDiagnostics';
import { createStoreChangeProposal } from '@/services/storeChangeApi';

describe('민감정보 경계', () => {
  test('UC1은 인식 텍스트만 보내며 오디오, 시크릿, 인증값을 전송하지 않는다', async () => {
    let requestBody: unknown;
    let requestUrl = '';
    server.use(http.post('/api/v1/store-change-proposals', async ({ request }) => {
      requestBody = await request.json();
      requestUrl = request.url;
      return HttpResponse.json({
        success: true,
        status: 'SUCCESS',
        data: { proposalId: 'prop-001', recognizedTextMasked: '***', changes: [], status: 'DRAFT' },
        error: null,
        timestamp: '2026-08-03T00:00:00Z',
      });
    }));
    await createStoreChangeProposal({ storeProfileId: 'store-123', recognizedText: '영업시간 변경', locale: 'ko-KR' });

    expect(requestBody).toEqual({ storeProfileId: 'store-123', recognizedText: '영업시간 변경', locale: 'ko-KR' });
    expect(JSON.stringify(requestBody)).not.toMatch(/audio|blob|authorization|token|secret|apiKey/i);
    expect(requestUrl).not.toContain('영업시간');
    expect(JSON.stringify(localStorage)).not.toContain('영업시간 변경');
  });

  test('UC2는 리뷰 본문 대신 마스킹 리뷰 ID만 보내고 서버 오류에 원문을 렌더링하지 않는다', async () => {
    const user = userEvent.setup();
    const sensitiveReview = sourceReviewFixtures[0]?.bodyMasked ?? '';
    let body: unknown;
    server.use(http.post('/api/v1/seo/generations', async ({ request }) => {
      body = await request.json();
      return HttpResponse.json({
        success: false,
        status: 'FAILED',
        data: null,
        error: { code: 'VALIDATION_ERROR', message: `처리 실패: ${sensitiveReview}` },
        timestamp: '2026-08-03T00:00:00Z',
      }, { status: 422 });
    }));
    render(<SeoGenerationWizard storeProfileId="store-123" sourceReviews={sourceReviewFixtures} />);
    await user.click(screen.getByRole('button', { name: '다음 (문구 만들기)' }));
    await user.click(screen.getByRole('radio', { name: /매장 대표 소개글/ }));
    await user.click(screen.getByRole('button', { name: '선택 완료' }));
    for (const answer of ['따뜻한 가게', '친절함', '만두전골']) {
      await user.type(screen.getByRole('textbox', { name: '사장님 답변 입력' }), answer);
      await user.click(screen.getByRole('button', { name: '전송' }));
      if (answer !== '만두전골') await new Promise((resolve) => window.setTimeout(resolve, 550));
    }
    await user.click(screen.getByRole('button', { name: '문구 추천받기' }));

    expect(body).toEqual({
      storeProfileId: 'store-123',
      briefText: '따뜻한 가게 친절함 만두전골',
      seedKeywords: ['맛있는메뉴', '친절함', '다시찾는집'],
      sourceReviewIds: ['review-001'],
    });
    expect(JSON.stringify(body)).not.toContain(sensitiveReview);
    expect(await screen.findByRole('alert')).not.toHaveTextContent(sensitiveReview);
    expect(window.location.href).not.toContain('review-001');
    expect(JSON.stringify(localStorage)).not.toContain(sensitiveReview);
  });

  test('개발 진단은 텍스트, PII, authorization, idempotency key를 마스킹한다', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    safeDiagnostic('security-check', {
      recognizedText: '원문 음성 텍스트',
      bodyMasked: '리뷰 본문',
      phone: '010-1234-5678',
      authorization: 'Bearer secret-token',
      idempotencyKey: 'private-key',
    });
    const output = JSON.stringify(info.mock.calls);
    expect(output).not.toMatch(/원문 음성|리뷰 본문|010-1234|secret-token|private-key/);
    expect(output).toContain('[REDACTED]');
  });
});
