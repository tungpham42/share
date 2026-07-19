
# Task

I want to create a web application to stream my desktop screen to a web browser. The application should allow me to share my screen in real-time with others, and it should be accessible from any device with a web browser.

# Requirements

## Product

- 1-to-1 screen sharing (one host, one viewer at a time)
- Host shares entire screen, a window, or a browser tab (standard getDisplayMedia picker)
- Audio: system/tab audio included alongside video (no mic)
- Access: shareable link with a random room ID, no accounts/login
- No recording — live only
- Session is ephemeral: room dies when host stops sharing; viewer can rejoin the link while host is still sharing
- Host: desktop browsers only. Viewer: any device (desktop, tablet, phone)
- Viewer sees simple status messages for waiting / connecting / connection lost / session ended

## Architecture

- **Frontend**: React, deployed to Netlify. Host view (start share, get link) and viewer view (open link, watch video)
- **Signaling**: Supabase Realtime — browsers connect directly to Supabase channels to exchange WebRTC offer/answer/ICE candidates. No custom WebSocket server (Netlify Functions can't hold persistent connections)
- **Netlify Functions**: small server-side tasks only — room ID generation, minting TURN credentials
- **NAT traversal**: STUN (public) + Metered.ca "Global Relay" (free tier, 0.5-20 GB/month, static long-term credentials generated via their TURN Server dashboard page) as TURN fallback for internet-wide connections. ExpressTurn was tried first (much larger 1000GB free tier) but its TURN allocation consistently failed real-world tests — switched to Metered, verified working via both a raw STUN/TURN protocol test (successful Allocate) and this project's own test tooling
- **Media transport**: direct WebRTC peer connection (true P2P) once signaling completes — no media server needed at 1:1 scale

# Technologies

I want to use typescript to build the application, and I want to use React for the frontend. I also want to use Supabase for signaling and Netlify Functions for server-side tasks. I want to use a hosted TURN provider for NAT traversal.

# Todo

- [x] set up development environment (Vite + React + TypeScript app scaffolded, builds clean)
- [x] implement screen capture (getDisplayMedia with screen/window/tab picker + audio)
- [x] implement signaling via Supabase Realtime (room creation, offer/answer/ICE exchange)
- [x] implement Netlify Functions for room ID generation (client-side) + TURN credentials (Metered)
- [x] implement WebRTC peer connection (host + viewer)
- [x] build host UI (start share, shareable link, status)
- [x] build viewer UI (join via link, video playback, status messages)
- [x] handle session lifecycle (ephemeral expiry, viewer reconnect while host still sharing)
- [x] keep Supabase free-tier project from auto-pausing (daily Netlify scheduled function ping)
- [x] add unit tests for signaling/ICE/room-id logic
- [x] code review pass — fixed a rejoin bug, deduped WebRTC signaling code, cleaned up package.json
- [x] create a Supabase project, enable Realtime, set VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY
- [x] sign up for Metered TURN, set METERED_USERNAME/METERED_CREDENTIAL — verified working via a live protocol test (successful Allocate)
- [ ] end-to-end test with two browsers against real Supabase + TURN credentials
- [ ] test cross-device viewing (desktop, tablet, phone) and cross-browser (Chrome, Firefox, Safari)
- [ ] test NAT traversal fallback (force TURN path)
- [ ] deploy to Netlify

# Implementation notes

- Stack: Vite + React + TypeScript, `@supabase/supabase-js`, `react-router-dom`, Vitest.
- Files: `src/pages/Host.tsx` (share flow), `src/pages/Viewer.tsx` (watch flow), `src/lib/` (Supabase client, ICE server fetch w/ STUN fallback, room ID generator, shared WebRTC signaling helpers), `netlify/functions/turn-credentials.ts` (mints Metered TURN credentials server-side), `netlify/functions/keep-alive.ts` (daily Supabase ping, scheduled via `netlify.toml`). Function unit tests live in `tests/netlify/` (not inside `netlify/functions/` — Netlify's function bundler tries to deploy every file in that directory as a function).
- `npm run build` type-checks (tsc, includes `src` + `netlify`) and builds successfully. `npm run test` runs 22 Vitest unit tests covering room ID generation, ICE server fetch/fallback, both Netlify functions, and the shared WebRTC signaling helpers — all passing.
- Full WebRTC flow is still untested end-to-end in a real browser pair, since that needs a real Supabase project + TURN credentials (user account setup) and a connected browser automation tool, neither available in this environment. Verified instead: clean typecheck/build, dev server serves both routes, and the STUN-fallback path was confirmed live (hitting the TURN endpoint without `netlify dev` running returns non-JSON, which `fetchIceServers` correctly catches and falls back from).
- Code review found and fixed a real bug: once a viewer disconnected, the host never cleared its stale `RTCPeerConnection` reference, permanently blocking any future viewer from joining — violated the "viewer can rejoin while host is still sharing" requirement. Fixed, and extracted the duplicated ICE-relay/connection-state code from Host/Viewer into `src/lib/webrtcSignaling.ts`.
- Copy `.env.example` to `.env` and fill in Supabase + Metered credentials before running `npm run dev`. Without them the app still renders and shows a clear "missing configuration" status instead of crashing. No new env vars needed for keep-alive — it reuses `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY`.
- Fixed a black-screen bug in `Viewer.tsx`: browsers can block autoplay of video-with-audio without a user gesture, which left the peer connection reporting "connected" while the video stayed frozen/black. Now falls back to muted autoplay with an Unmute button.

