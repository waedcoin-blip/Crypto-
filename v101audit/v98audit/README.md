<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://ai.google.dev/static/site-assets/images/share-ais-513315318.png" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/94ed5409-32c8-478f-a275-1407932e0eea

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

## Helius LaserStream Reliability
The application uses Helius LaserStream (v0.8.4+) for high-speed, direct in-process gRPC streaming of on-chain transactions. 

Reliability features include:
- **Strict Connection States:** LaserStream only marks as `CONNECTED` upon receiving live chain data (slots, ping/pong, or transactions), preventing false positives if a subscription handle is returned but no data flows.
- **Activity-Stale Detection:** Connections without any server updates for 12 seconds are marked stale, triggering an automatic reconnect.
- **Loop Prevention:** Reconnection logic includes backoff to prevent tight reconnect loops during Helius network degradation or authentication failures.
- **Fail-Loud Diagnostics:** Errors during the stream (e.g. invalid API keys, insufficient plan tiers) immediately mark the transport as unhealthy instead of silently failing or dropping to synthetic fallbacks.
