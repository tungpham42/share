import { afterEach, describe, expect, it, vi } from 'vitest';
import { handler } from '../../netlify/functions/turn-credentials';

describe('turn-credentials handler', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns 500 when TURN env vars are missing', async () => {
    vi.stubEnv('METERED_USERNAME', '');
    vi.stubEnv('METERED_CREDENTIAL', '');

    const result = await handler();

    expect(result.statusCode).toBe(500);
    expect(JSON.parse(result.body).error).toMatch(/not configured/);
  });

  it('returns stun + turn ice servers built from env vars', async () => {
    vi.stubEnv('METERED_USERNAME', 'user123');
    vi.stubEnv('METERED_CREDENTIAL', 'secret');

    const result = await handler();

    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body)).toEqual({
      iceServers: [
        { urls: 'stun:stun.relay.metered.ca:80' },
        { urls: 'turn:global.relay.metered.ca:80', username: 'user123', credential: 'secret' },
        { urls: 'turn:global.relay.metered.ca:80?transport=tcp', username: 'user123', credential: 'secret' },
        { urls: 'turn:global.relay.metered.ca:443', username: 'user123', credential: 'secret' },
        { urls: 'turns:global.relay.metered.ca:443?transport=tcp', username: 'user123', credential: 'secret' },
      ],
    });
  });
});
