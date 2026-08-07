import type { z } from 'zod';
import type { ApiEnvelope, ApiErrorBody, ApiResult } from '@/services/api.types';
import { apiEnvelopeShapeSchema, type ApiError, type ParsedApiResult } from '@/services/contracts/common';

export class ApiClientError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly requestId: string | null,
    readonly causeBody: ApiErrorBody | ApiError | null = null,
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

function resolveBaseUrl(): string {
  // MSW's browser worker owns same-origin /api requests in mock mode. Ignoring an
  // accidentally configured backend URL here prevents mock traffic escaping to it.
  return import.meta.env.VITE_API_MOCKING === 'true'
    ? ''
    : (import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, '') ?? '');
}

interface RawEnvelopeResult {
  envelope: ApiEnvelope<unknown>;
  status: number;
  requestId: string | null;
}

async function fetchEnvelope(path: string, options: ApiRequestOptions): Promise<RawEnvelopeResult> {
  const headers = new Headers(options.headers);
  headers.set('Accept', 'application/json');
  if (options.body !== undefined) headers.set('Content-Type', 'application/json');

  let response: Response;
  try {
    const { body, ...fetchOptions } = options;
    const requestOptions: RequestInit = { ...fetchOptions, headers };
    if (body !== undefined) requestOptions.body = JSON.stringify(body);
    response = await fetch(`${resolveBaseUrl()}${path}`, requestOptions);
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
  return { envelope: payload, status: response.status, requestId };
}

export async function apiRequest<T>(path: string, options: ApiRequestOptions = {}): Promise<ApiResult<T>> {
  const { envelope: payload, status, requestId } = await fetchEnvelope(path, options);
  if (status < 200 || status >= 300 || !payload.success || payload.data === null) {
    throw new ApiClientError(
      payload.error?.message ?? '요청을 처리하지 못했습니다.',
      status,
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

/**
 * Strict, schema-validated request path. Unlike {@link apiRequest}, the full envelope
 * (including unknown-key rejection and the SUCCESS|PROCESSING|FAILED-only top-level
 * status) and `data` are parsed through the given Zod schema, so a malformed or
 * unexpected response never reaches the caller as trusted data.
 */
export async function apiRequestParsed<S extends z.ZodTypeAny>(
  path: string,
  dataSchema: S,
  options: ApiRequestOptions = {},
): Promise<ParsedApiResult<z.infer<S>>> {
  const { envelope: rawEnvelope, status, requestId } = await fetchEnvelope(path, options);
  const parsedShape = apiEnvelopeShapeSchema.safeParse(rawEnvelope);
  if (!parsedShape.success) {
    throw new ApiClientError('서버 응답이 계약과 일치하지 않습니다.', status, requestId);
  }
  const envelope = parsedShape.data;
  if (status < 200 || status >= 300 || !envelope.success || envelope.data === null) {
    throw new ApiClientError(
      envelope.error?.message ?? '요청을 처리하지 못했습니다.',
      status,
      requestId,
      envelope.error,
    );
  }
  const parsedData = dataSchema.safeParse(envelope.data);
  if (!parsedData.success) {
    throw new ApiClientError('서버 응답이 계약과 일치하지 않습니다.', status, requestId);
  }
  return {
    data: parsedData.data,
    status: envelope.status,
    timestamp: envelope.timestamp,
    requestId,
    warning: envelope.error,
  };
}
