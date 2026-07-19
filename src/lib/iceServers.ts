const STUN_ONLY_FALLBACK: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];

// Fetches STUN + TURN servers minted by the Netlify function. Falls back to a
// public STUN-only server if the function isn't deployed/configured yet, so
// local development and same-network connections still work without TURN.
export async function fetchIceServers(): Promise<RTCIceServer[]> {
  try {
    const res = await fetch('/.netlify/functions/turn-credentials');
    if (!res.ok) throw new Error(`turn-credentials returned ${res.status}`);
    const data = await res.json();
    if (Array.isArray(data.iceServers) && data.iceServers.length > 0) {
      return data.iceServers as RTCIceServer[];
    }
    throw new Error('turn-credentials returned an empty list');
  } catch (err) {
    console.warn('Falling back to STUN-only ICE servers:', (err as Error).message);
    return STUN_ONLY_FALLBACK;
  }
}
