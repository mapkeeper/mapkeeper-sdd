import type { ApiEnvelope, ApiErrorBody, ApiResult } from '@/services/api.types';

export class ApiClientError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly requestId: string | null,
    readonly causeBody: ApiErrorBody | null = null,
  ) {
    super(message);
    this.name = 'ApiClientError';
  }
}

interface ApiRequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isEnvelope(value: unknown): value is ApiEnvelope<unknown> {
  return (
    isRecord(value) &&
    typeof value.success === 'boolean' &&
    typeof value.status === 'string' &&
    'data' in value &&
    'error' in value &&
    typeof value.timestamp === 'string'
  );
}

export async function apiRequest<T>(path: string, options: ApiRequestOptions = {}): Promise<ApiResult<T>> {
  // MSW's browser worker owns same-origin /api requests in mock mode. Ignoring an
  // accidentally configured backend URL here prevents mock traffic escaping to it.
  const baseUrl = import.meta.env.VITE_API_MOCKING === 'true'
    ? ''
    : (import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, '') ?? '');
  const headers = new Headers(options.headers);
  headers.set('Accept', 'application/json');
  if (options.body !== undefined) headers.set('Content-Type', 'application/json');

  let response: Response;
  try {
    const { body, ...fetchOptions } = options;
    const requestOptions: RequestInit = { ...fetchOptions, headers };
    if (body !== undefined) requestOptions.body = JSON.stringify(body);
    response = await fetch(`${baseUrl}${path}`, requestOptions);
  } catch (error: unknown) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiClientError('서버에 연결할 수 없습니다.', 0, null);
  }

  const requestId = response.headers.get('X-Request-ID');
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new ApiClientError('서버 응답 형식이 올바르지 않습니다.', response.status, requestId);
  }
  if (!isEnvelope(payload)) {
    throw new ApiClientError('공통 응답 규격과 일치하지 않습니다.', response.status, requestId);
  }
  if (!response.ok || !payload.success || payload.data === null) {
    throw new ApiClientError(
      payload.error?.message ?? '요청을 처리하지 못했습니다.',
      response.status,
      requestId,
      payload.error,
    );
  }
  return {
    data: payload.data as T,
    status: payload.status,
    timestamp: payload.timestamp,
    requestId,
    warning: payload.error,
  };
}
