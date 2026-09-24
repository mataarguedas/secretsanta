import { describe, expect, it, vi } from 'vitest';

import { ApiError, createApiClient } from './apiClient';

type Handler = (url: string, init: RequestInit) => Response | Promise<Response>;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function setup(handler: Handler) {
  // The client always calls fetch(url: string, init).
  const fetchMock = vi.fn((url: string, init?: RequestInit) =>
    Promise.resolve(handler(url, init ?? {})),
  );
  const onUnauthenticated = vi.fn();
  const client = createApiClient({
    fetch: fetchMock as unknown as typeof fetch,
    onUnauthenticated,
  });
  const calls = () => fetchMock.mock.calls.map(([url, init]) => `${init?.method ?? ''} ${url}`);
  return { client, fetchMock, onUnauthenticated, calls };
}

function headersOf(init: RequestInit | undefined): Record<string, string> {
  return init?.headers as Record<string, string>;
}

describe('apiClient', () => {
  it('sends credentials and X-Requested-With on every request, JSON in and out', async () => {
    const { client, fetchMock } = setup(() => json(200, { id: 1 }));
    await expect(client.post('/events', { name: 'Oficina' })).resolves.toEqual({ id: 1 });

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('/api/v1/events');
    expect(init?.method).toBe('POST');
    expect(init?.credentials).toBe('include');
    expect(headersOf(init)['X-Requested-With']).toBe('fetch');
    expect(headersOf(init)['Content-Type']).toBe('application/json');
    expect(init?.body).toBe('{"name":"Oficina"}');

    await client.get('/me');
    const getInit = fetchMock.mock.calls[1]?.[1];
    expect(getInit?.credentials).toBe('include');
    expect(headersOf(getInit)['X-Requested-With']).toBe('fetch');
    expect(headersOf(getInit)['Content-Type']).toBeUndefined();
  });

  it('passes FormData through without a JSON content type', async () => {
    const { client, fetchMock } = setup(() => json(201, {}));
    const form = new FormData();
    form.append('file', new Blob(['x']), 'a.jpg');
    await client.post('/wishlist/items/1/photos', form);
    const init = fetchMock.mock.calls[0]?.[1];
    expect(init?.body).toBe(form);
    expect(headersOf(init)['Content-Type']).toBeUndefined();
  });

  it('returns undefined for 204', async () => {
    const { client } = setup(() => new Response(null, { status: 204 }));
    await expect(client.delete('/messages/1')).resolves.toBeUndefined();
  });

  it('throws ApiError(code, status) from the error envelope', async () => {
    const { client } = setup(() =>
      json(409, { error: { code: 'EVENT_ALREADY_DRAWN', message: 'Already drawn.' } }),
    );
    const error = await client.post('/events/1/leave').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ code: 'EVENT_ALREADY_DRAWN', status: 409 });
  });

  it('keeps extra envelope fields as details', async () => {
    const { client } = setup(() =>
      json(422, { error: { code: 'VALIDATION_ERROR', message: 'x', fields: { name: 'short' } } }),
    );
    await expect(client.post('/events', {})).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: { fields: { name: 'short' } },
    });
  });

  it('maps a non-envelope error to UNKNOWN_ERROR and a failed fetch to NETWORK_ERROR', async () => {
    const html = setup(() => new Response('<h1>Bad gateway</h1>', { status: 502 }));
    await expect(html.client.get('/x')).rejects.toMatchObject({
      code: 'UNKNOWN_ERROR',
      status: 502,
    });

    const offline = setup(() => {
      throw new TypeError('Failed to fetch');
    });
    await expect(offline.client.get('/x')).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
      status: 0,
    });
  });

  it('rethrows aborts untouched', async () => {
    const { client } = setup(() => {
      throw new DOMException('aborted', 'AbortError');
    });
    await expect(client.get('/x')).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('returns the body for allowStatus instead of throwing', async () => {
    const { client } = setup(() => json(503, { status: 'error', db: 'ok', redis: 'error' }));
    await expect(client.get('/health', { allowStatus: [503] })).resolves.toMatchObject({
      redis: 'error',
    });
  });

  it('on 401: refreshes once, then retries the request once', async () => {
    let meCalls = 0;
    const { client, calls, onUnauthenticated } = setup((url) => {
      if (url.endsWith('/auth/refresh')) return new Response(null, { status: 204 });
      meCalls += 1;
      return meCalls === 1
        ? json(401, { error: { code: 'UNAUTHENTICATED' } })
        : json(200, { ok: 1 });
    });
    await expect(client.get('/me')).resolves.toEqual({ ok: 1 });
    expect(calls()).toEqual(['GET /api/v1/me', 'POST /api/v1/auth/refresh', 'GET /api/v1/me']);
    expect(onUnauthenticated).not.toHaveBeenCalled();
  });

  it('the refresh request itself carries the CSRF header', async () => {
    let first = true;
    const { client, fetchMock } = setup((url) => {
      if (url.endsWith('/auth/refresh')) return new Response(null, { status: 204 });
      if (first) {
        first = false;
        return json(401, {});
      }
      return json(200, {});
    });
    await client.get('/me');
    const refreshInit = fetchMock.mock.calls[1]?.[1];
    expect(refreshInit?.method).toBe('POST');
    expect(refreshInit?.credentials).toBe('include');
    expect(headersOf(refreshInit)['X-Requested-With']).toBe('fetch');
  });

  it('concurrent 401s share a single refresh', async () => {
    let refreshed = false;
    let refreshCalls = 0;
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { client } = setup(async (url) => {
      if (url.endsWith('/auth/refresh')) {
        refreshCalls += 1;
        await gate;
        refreshed = true;
        return new Response(null, { status: 204 });
      }
      return refreshed ? json(200, { url }) : json(401, {});
    });
    const pending = Promise.all([client.get('/a'), client.get('/b'), client.get('/c')]);
    await vi.waitFor(() => {
      expect(refreshCalls).toBe(1);
    });
    release();
    await expect(pending).resolves.toHaveLength(3);
    expect(refreshCalls).toBe(1);
  });

  it('when the refresh fails: onUnauthenticated, UNAUTHENTICATED, no retry', async () => {
    const { client, calls, onUnauthenticated } = setup((url) =>
      url.endsWith('/auth/refresh') ? json(401, {}) : json(401, {}),
    );
    await expect(client.get('/me')).rejects.toMatchObject({ code: 'UNAUTHENTICATED', status: 401 });
    expect(onUnauthenticated).toHaveBeenCalledOnce();
    expect(calls()).toEqual(['GET /api/v1/me', 'POST /api/v1/auth/refresh']);
  });

  it('retries only once even if the retry is 401 again', async () => {
    const { client, calls, onUnauthenticated } = setup((url) =>
      url.endsWith('/auth/refresh')
        ? new Response(null, { status: 204 })
        : json(401, { error: { code: 'UNAUTHENTICATED', message: 'x' } }),
    );
    await expect(client.get('/me')).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    expect(calls()).toEqual(['GET /api/v1/me', 'POST /api/v1/auth/refresh', 'GET /api/v1/me']);
    expect(onUnauthenticated).toHaveBeenCalledOnce();
  });

  it('a refresh failing on the network also counts as signed out', async () => {
    const { client, onUnauthenticated } = setup((url) => {
      if (url.endsWith('/auth/refresh')) throw new TypeError('offline');
      return json(401, {});
    });
    await expect(client.get('/me')).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    expect(onUnauthenticated).toHaveBeenCalledOnce();
  });

  it('setOnUnauthenticated replaces the hook', async () => {
    const { client, onUnauthenticated } = setup(() => json(401, {}));
    const replacement = vi.fn();
    client.setOnUnauthenticated(replacement);
    await client.get('/me').catch(() => undefined);
    expect(replacement).toHaveBeenCalledOnce();
    expect(onUnauthenticated).not.toHaveBeenCalled();
  });
});

describe('apiClient.upload', () => {
  /** Uploads go through XMLHttpRequest; the fake replays them through global fetch. */
  async function uploadSetup(handler: Handler) {
    const { FakeXhr } = await import('@/test/render');
    const ctx = setup(handler);
    vi.stubGlobal('XMLHttpRequest', FakeXhr);
    vi.stubGlobal('fetch', ctx.fetchMock);
    return ctx;
  }

  const form = () => {
    const data = new FormData();
    data.append('file', new File(['x'], 'a.jpg', { type: 'image/jpeg' }));
    return data;
  };

  it('posts the FormData with the CSRF header and reports progress', async () => {
    const { client, fetchMock } = await uploadSetup(() => json(200, { id: 'e1' }));
    const progress: number[] = [];
    const body = form();

    await expect(
      client.upload('/events/e1/cover', body, { onProgress: (f) => progress.push(f) }),
    ).resolves.toEqual({ id: 'e1' });

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('/api/v1/events/e1/cover');
    expect(init?.method).toBe('POST');
    expect(init?.body).toBe(body);
    expect(init?.credentials).toBe('include');
    expect(headersOf(init)['X-Requested-With']).toBe('fetch');
    expect(headersOf(init)['Content-Type']).toBeUndefined(); // the browser sets the boundary
    expect(progress).toEqual([0.5, 1]);
  });

  it('throws the translated error code (e.g. an unsupported image)', async () => {
    const { client } = await uploadSetup(() =>
      json(415, { error: { code: 'UNSUPPORTED_IMAGE', message: 'no' } }),
    );
    await expect(client.upload('/events/e1/cover', form())).rejects.toMatchObject({
      code: 'UNSUPPORTED_IMAGE',
      status: 415,
    });
  });

  it('refreshes the session on 401 and uploads again once', async () => {
    let attempts = 0;
    const { client, calls } = await uploadSetup((url) => {
      if (url.endsWith('/auth/refresh')) return new Response(null, { status: 204 });
      attempts += 1;
      return attempts === 1
        ? json(401, { error: { code: 'AUTH_REQUIRED', message: '' } })
        : json(200, { ok: true });
    });
    await expect(client.upload('/events/e1/cover', form())).resolves.toEqual({ ok: true });
    expect(calls()).toEqual([
      'POST /api/v1/events/e1/cover',
      'POST /api/v1/auth/refresh',
      'POST /api/v1/events/e1/cover',
    ]);
  });

  it('a network failure is NETWORK_ERROR', async () => {
    const { client } = await uploadSetup(() => {
      throw new TypeError('offline');
    });
    await expect(client.upload('/events/e1/cover', form())).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
    });
  });
});
