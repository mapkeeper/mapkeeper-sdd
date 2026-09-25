import { http, HttpResponse } from 'msw';
import { server } from '@/mocks/server';
import { apiRequest } from '@/services/api';

const { getIdToken } = vi.hoisted(() => ({
  getIdToken: vi.fn(async () => 'firebase-id-token'),
}));

vi.mock('@/lib/firebase', () => ({
  firebaseAuth: {
    currentUser: { getIdToken },
  },
}));

describe('API Firebase authentication boundary', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    getIdToken.mockClear();
  });

  test('real API mode sends the current Firebase ID token as a bearer header', async () => {
    vi.stubEnv('VITE_API_MOCKING', 'false');
    let authorization: string | null = null;
    server.use(
      http.get('/api/v1/auth-check', ({ request }) => {
        authorization = request.headers.get('Authorization');
        return HttpResponse.json({
          success: true,
          status: 'SUCCESS',
          data: { ok: true },
          error: null,
          timestamp: '2026-09-25T00:00:00Z',
        });
      }),
    );

    await apiRequest<{ ok: boolean }>('/api/v1/auth-check');

    expect(authorization).toBe('Bearer firebase-id-token');
    expect(getIdToken).toHaveBeenCalledOnce();
  });
});
