import type { ZodType } from 'zod';
import type { ApiEnvelope, ApiErrorBody, ApiResult } from '@/services/api.types';
import { apiEnvelopeSchema } from '@/services/contracts/common';

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

interface FetchedEnvelope {
  envelope: ApiEnvelope<unknown>;
  httpStatus: number;
  requestId: string | null;
}

async function fetchEnvelope(path: string, options: ApiRequestOptions): Promise<FetchedEnvelope> {
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
  const parsedEnvelope = apiEnvelopeSchema.safeParse(payload);
  if (!parsedEnvelope.success) {
    throw new ApiClientError('공통 응답 규격과 일치하지 않습니다.', response.status, requestId);
  }
  const envelope = parsedEnvelope.data;
  if (!response.ok || !envelope.success || envelope.data === null) {
    throw new ApiClientError(
      envelope.error?.message ?? '요청을 처리하지 못했습니다.',
      response.status,
      requestId,
      envelope.error,
    );
  }
  return { envelope, httpStatus: response.status, requestId };
}

export async function apiRequest<T>(path: string, options: ApiRequestOptions = {}): Promise<ApiResult<T>> {
  const { envelope, requestId } = await fetchEnvelope(path, options);
  return {
    data: envelope.data as T,
    status: envelope.status,
    timestamp: envelope.timestamp,
    requestId,
    warning: envelope.error,
  };
}

export async function apiRequestParsed<T>(
  path: string,
  dataSchema: ZodType<T>,
  options: ApiRequestOptions = {},
): Promise<ApiResult<T>> {
  const { envelope, httpStatus, requestId } = await fetchEnvelope(path, options);
  const parsedData = dataSchema.safeParse(envelope.data);
  if (!parsedData.success) {
    throw new ApiClientError('서버 응답이 API 계약과 일치하지 않습니다.', httpStatus, requestId);
  }
  return {
    data: parsedData.data,
    status: envelope.status,
    timestamp: envelope.timestamp,
    requestId,
    warning: envelope.error,
  };
}
