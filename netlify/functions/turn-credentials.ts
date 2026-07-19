// Serves STUN + TURN server config to the client.
// Assembles the fixed server list from env vars rather than
// calling out to a credential-minting API.
export const handler = async () => {
  const username = process.env.COTURN_USERNAME;
  const credential = process.env.COTURN_CREDENTIAL;

  if (!username || !credential) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        error:
          "TURN provider not configured (missing COTURN_USERNAME / COTURN_CREDENTIAL)",
      }),
    };
  }

  // Updated to point to your new CentOS 9 VPS domain and standard ports
  const iceServers = [
    { urls: "stun:coturn.soft.io.vn:3478" },
    { urls: "turn:coturn.soft.io.vn:3478", username, credential },
    { urls: "turn:coturn.soft.io.vn:3478?transport=tcp", username, credential },
    { urls: "turn:coturn.soft.io.vn:5349", username, credential },
    {
      urls: "turns:coturn.soft.io.vn:5349?transport=tcp",
      username,
      credential,
    },
  ];

  return {
    statusCode: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    }, //[cite: 2]
    body: JSON.stringify({ iceServers }), //[cite: 2]
  };
};
