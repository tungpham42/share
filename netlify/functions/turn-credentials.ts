// Serves STUN + TURN server config to the client. Metered's free "Global
// Relay" tier issues static long-term credentials (via their dashboard),
// so this just assembles the fixed server list from env vars rather than
// calling out to a credential-minting API.
export const handler = async () => {
  const username = process.env.METERED_USERNAME;
  const credential = process.env.METERED_CREDENTIAL;

  if (!username || !credential) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'TURN provider not configured (missing METERED_USERNAME / METERED_CREDENTIAL)',
      }),
    };
  }

  const iceServers = [
    { urls: 'stun:stun.relay.metered.ca:80' },
    { urls: 'turn:global.relay.metered.ca:80', username, credential },
    { urls: 'turn:global.relay.metered.ca:80?transport=tcp', username, credential },
    { urls: 'turn:global.relay.metered.ca:443', username, credential },
    { urls: 'turns:global.relay.metered.ca:443?transport=tcp', username, credential },
  ];

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify({ iceServers }),
  };
};
