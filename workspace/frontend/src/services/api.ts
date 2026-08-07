import type { z } from 'zod';
import { apiEnvelopeShapeSchema, type ApiError, type ParsedApiResult } from '@/services/contracts/common';

export class ApiClientError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly requestId: string | null,
    readonly causeBody: ApiError | null = null,
  ) {
    super(message);
    this.name = 'ApiClientError';
  }
}

interface ApiRequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
}

function resolveBaseUrl(): string {
  // MSW's browser worker owns same-origin /api requests in mock mode. Ignoring an
  // accidentally configured backend URL here prevents mock traffic escaping to it.
  return import.meta.env.VITE_API_MOCKING === 'true'
    ? ''
    : (import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, '') ?? '');
}

interface RawResponseResult {
  payload: unknown;
  status: number;
  requestId: string | null;
}

async function fetchJson(path: string, options: ApiRequestOptions): Promise<RawResponseResult> {
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
  return { payload, status: response.status, requestId };
}

/**
 * Strict, schema-validated request path. The full envelope (including unknown-key
 * rejection and the SUCCESS|PROCESSING|FAILED-only top-level status) and `data` are
 * parsed through the given Zod schema, so a malformed or unexpected response never
 * reaches the caller as trusted data.
 */
export async function apiRequestParsed<S extends z.ZodTypeAny>(
  path: string,
  dataSchema: S,
  options: ApiRequestOptions = {},
): Promise<ParsedApiResult<z.infer<S>>> {
  const { payload: rawEnvelope, status, requestId } = await fetchJson(path, options);
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
