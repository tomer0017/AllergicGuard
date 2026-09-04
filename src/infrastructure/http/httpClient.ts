/**
 * Minimal, dependency-free HTTP layer.
 *
 * Responsibilities: timeout via AbortController, JSON parsing, runtime schema
 * validation, and normalization of every possible failure into an AppError.
 * It never throws: callers always receive a discriminated result.
 */

import type { ZodType } from 'zod';

import { createAppError, type AppError } from '../../domain/errors/appError.ts';

export type HttpResult<T> =
  | { readonly ok: true; readonly data: T; readonly httpStatus: number; readonly durationMs: number }
  | { readonly ok: false; readonly error: AppError; readonly httpStatus?: number; readonly durationMs: number };

export interface HttpRequestOptions<T> {
  readonly url: string;
  readonly schema: ZodType<T>;
  readonly timeoutMs: number;
  readonly headers?: Record<string, string>;
  readonly providerId?: string;
  /** Retries only on network errors and 5xx/429. Never on 4xx. Never infinite. */
  readonly retryAttempts?: number;
  readonly signal?: AbortSignal;
  readonly fetchImpl?: typeof fetch;
}

const MAX_RETRY_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 250;

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}

/** Fetches JSON and validates it against a schema. Never throws. */
export async function fetchJson<T>(options: HttpRequestOptions<T>): Promise<HttpResult<T>> {
  const attempts = Math.min(Math.max(options.retryAttempts ?? 0, 0), MAX_RETRY_ATTEMPTS) + 1;
  const startedAt = Date.now();
  let lastResult: HttpResult<T> | undefined;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const result = await performRequest(options, startedAt);
    if (result.ok) return result;
    lastResult = result;

    const retryable =
      result.error.code === 'NETWORK_ERROR' ||
      result.error.code === 'PROVIDER_RATE_LIMIT' ||
      (result.httpStatus !== undefined && isRetryableStatus(result.httpStatus));

    if (!retryable || attempt === attempts - 1) break;
    await delay(RETRY_BASE_DELAY_MS * (attempt + 1), options.signal);
  }

  return (
    lastResult ?? {
      ok: false,
      error: createAppError('UNKNOWN_ERROR', 'HTTP layer produced no result', {
        providerId: options.providerId,
      }),
      durationMs: Date.now() - startedAt,
    }
  );
}

async function performRequest<T>(
  options: HttpRequestOptions<T>,
  startedAt: number,
): Promise<HttpResult<T>> {
  const { url, schema, timeoutMs, headers, providerId, signal } = options;
  const doFetch = options.fetchImpl ?? globalThis.fetch;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort('timeout'), timeoutMs);
  const externalAbort = () => controller.abort('cancelled');
  signal?.addEventListener('abort', externalAbort, { once: true });

  const elapsed = () => Date.now() - startedAt;

  try {
    const response = await doFetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json', ...headers },
      signal: controller.signal,
    });

    if (!response.ok) {
      const code =
        response.status === 429
          ? 'PROVIDER_RATE_LIMIT'
          : response.status === 404
            ? 'PRODUCT_NOT_FOUND'
            : 'PROVIDER_HTTP_ERROR';
      return {
        ok: false,
        error: createAppError(code, `HTTP ${response.status} from ${url}`, { providerId }),
        httpStatus: response.status,
        durationMs: elapsed(),
      };
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch (cause) {
      return {
        ok: false,
        error: createAppError('PROVIDER_INVALID_RESPONSE', 'Response body is not valid JSON', {
          providerId,
          cause,
        }),
        httpStatus: response.status,
        durationMs: elapsed(),
      };
    }

    const parsed = schema.safeParse(payload);
    if (!parsed.success) {
      return {
        ok: false,
        error: createAppError(
          'PROVIDER_INVALID_RESPONSE',
          `Response failed schema validation: ${parsed.error.issues
            .slice(0, 5)
            .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
            .join('; ')}`,
          { providerId, cause: parsed.error },
        ),
        httpStatus: response.status,
        durationMs: elapsed(),
      };
    }

    return { ok: true, data: parsed.data, httpStatus: response.status, durationMs: elapsed() };
  } catch (cause) {
    const aborted = controller.signal.aborted;
    const isTimeout = aborted && controller.signal.reason === 'timeout';
    return {
      ok: false,
      error: isTimeout
        ? createAppError('PROVIDER_TIMEOUT', `Request to ${url} timed out after ${timeoutMs}ms`, {
            providerId,
            cause,
          })
        : createAppError('NETWORK_ERROR', `Network request to ${url} failed`, { providerId, cause }),
      durationMs: elapsed(),
    };
  } finally {
    clearTimeout(timeoutId);
    signal?.removeEventListener('abort', externalAbort);
  }
}
