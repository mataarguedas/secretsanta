/**
 * Fetch wrapper for the same-origin API (CLAUDE.md §8).
 *
 * - `credentials: 'include'` and `X-Requested-With: fetch` on every request (CSRF, PRD §10).
 * - JSON in and out; FormData bodies pass through untouched (uploads).
 * - Non-2xx responses throw `ApiError(code, status)` built from the error envelope
 *   `{ "error": { "code", "message" } }`; the UI translates `errors.<code>`.
 * - On 401: `POST /auth/refresh` once and retry the request once. Concurrent 401s share a
 *   single refresh. If the refresh fails, `onUnauthenticated` runs.
 */

export const API_BASE = '/api/v1';
const REFRESH_PATH = '/auth/refresh';

/** Client-side codes, alongside the backend's registry (backend/app/core/errors.py). */
export const CLIENT_ERROR_CODES = ['NETWORK_ERROR', 'UNKNOWN_ERROR', 'UNAUTHENTICATED'] as const;

export class ApiError extends Error {
  override readonly name = 'ApiError';
  readonly code: string;
  readonly status: number;
  /** Extra fields from the envelope (e.g. validation `fields`). */
  readonly details: Record<string, unknown>;

  constructor(
    code: string,
    status: number,
    message?: string,
    details: Record<string, unknown> = {},
  ) {
    super(message ?? code);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface RequestOptions {
  body?: unknown;
  signal?: AbortSignal;
  headers?: Record<string, string>;
  /** Statuses (besides 2xx) whose body is returned instead of thrown, e.g. 503 from /health. */
  allowStatus?: readonly number[];
}

export interface ApiClientConfig {
  baseUrl?: string;
  fetch?: typeof fetch;
  /** Called once when a refresh fails (session is gone): e.g. redirect to `/?next=…`. */
  onUnauthenticated?: () => void;
}

export interface ApiClient {
  request: <T>(method: HttpMethod, path: string, options?: RequestOptions) => Promise<T>;
  get: <T>(path: string, options?: Omit<RequestOptions, 'body'>) => Promise<T>;
  post: <T>(path: string, body?: unknown, options?: RequestOptions) => Promise<T>;
  put: <T>(path: string, body?: unknown, options?: RequestOptions) => Promise<T>;
  patch: <T>(path: string, body?: unknown, options?: RequestOptions) => Promise<T>;
  delete: <T>(path: string, options?: RequestOptions) => Promise<T>;
  setOnUnauthenticated: (handler: (() => void) | undefined) => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

async function parseBody(response: Response): Promise<unknown> {
  if (response.status === 204 || response.status === 205) return undefined;
  const text = await response.text();
  if (!text) return undefined;
  const type = response.headers.get('Content-Type') ?? '';
  if (type.includes('json')) {
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return text;
    }
  }
  return text;
}

function toApiError(status: number, body: unknown): ApiError {
  if (isRecord(body) && isRecord(body.error) && typeof body.error.code === 'string') {
    const { code, message, ...details } = body.error;
    return new ApiError(code, status, typeof message === 'string' ? message : code, details);
  }
  return new ApiError('UNKNOWN_ERROR', status);
}

export function createApiClient(config: ApiClientConfig = {}): ApiClient {
  const baseUrl = config.baseUrl ?? API_BASE;
  const doFetch: typeof fetch = (...args) => (config.fetch ?? globalThis.fetch)(...args);
  let onUnauthenticated = config.onUnauthenticated;
  let refreshing: Promise<boolean> | null = null;

  async function send(
    method: HttpMethod,
    path: string,
    options: RequestOptions,
  ): Promise<Response> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'X-Requested-With': 'fetch',
      ...options.headers,
    };
    let body: BodyInit | undefined;
    if (options.body instanceof FormData) {
      body = options.body; // the browser sets the multipart boundary
    } else if (options.body !== undefined) {
      body = JSON.stringify(options.body);
      headers['Content-Type'] = 'application/json';
    }
    return doFetch(`${baseUrl}${path}`, {
      method,
      credentials: 'include',
      headers,
      body: body ?? null,
      signal: options.signal ?? null,
    });
  }

  /** One refresh at a time; every concurrent 401 awaits the same promise. */
  function refresh(): Promise<boolean> {
    refreshing ??= send('POST', REFRESH_PATH, {})
      .then((res) => res.ok)
      .catch(() => false)
      .finally(() => {
        refreshing = null;
      });
    return refreshing;
  }

  async function request<T>(
    method: HttpMethod,
    path: string,
    options: RequestOptions = {},
  ): Promise<T> {
    let response: Response;
    try {
      response = await send(method, path, options);
      if (response.status === 401 && path !== REFRESH_PATH) {
        if (await refresh()) {
          response = await send(method, path, options); // retried once, never again
          if (response.status === 401) onUnauthenticated?.();
        } else {
          onUnauthenticated?.();
          throw new ApiError('UNAUTHENTICATED', 401);
        }
      }
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (error instanceof DOMException && error.name === 'AbortError') throw error;
      throw new ApiError('NETWORK_ERROR', 0);
    }

    const body = await parseBody(response);
    if (response.ok || options.allowStatus?.includes(response.status)) return body as T;
    throw toApiError(response.status, body);
  }

  return {
    request,
    get: (path, options) => request('GET', path, options),
    post: (path, body, options) => request('POST', path, { ...options, body }),
    put: (path, body, options) => request('PUT', path, { ...options, body }),
    patch: (path, body, options) => request('PATCH', path, { ...options, body }),
    delete: (path, options) => request('DELETE', path, options),
    setOnUnauthenticated: (handler) => {
      onUnauthenticated = handler;
    },
  };
}

/** App-wide client. `AppProviders` binds `onUnauthenticated` to the session query. */
export const apiClient = createApiClient();
