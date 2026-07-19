import { afterEach, describe, expect, it, vi } from 'vitest';
import { handler } from '../../netlify/functions/keep-alive';

describe('keep-alive handler', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('returns 500 when Supabase env vars are missing', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', '');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', '');

    const result = await handler();

    expect(result.statusCode).toBe(500);
  });

  it('pings the Supabase REST root and returns 200', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-key');
    const fetchMock = vi.fn().mockResolvedValue({ status: 200 });
    vi.stubGlobal('fetch', fetchMock);

    const result = await handler();

    expect(result.statusCode).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith('https://example.supabase.co/rest/v1/', {
      headers: { apikey: 'anon-key' },
    });
  });

  it('returns 500 when the ping throws', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-key');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));

    const result = await handler();

    expect(result.statusCode).toBe(500);
  });
});
