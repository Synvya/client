# DineDirect

A frontend-only onboarding tool for DineDirect merchants. It generates a Nostr identity in the browser, stores the `nsec` securely, and publishes business profile (kind 0) events to configured relays. Media uploads use nostr.build with NIP-98 auth during local development.

## Getting Started

1. Install dependencies:
   ```bash
   npm install
   ```
2. Copy `.env.example` to `.env` and set `VITE_UPLOAD_NSEC` to a nostr-build upload secret (`nsec1...`). You can also override `VITE_DEFAULT_RELAYS` if needed.
3. Run the dev server:
   ```bash
   npm run dev
   ```
4. Open the app at [http://localhost:5173](http://localhost:5173).

When the app loads it will generate a merchant keypair, encrypt the `nsec` using an AES-GCM device key in IndexedDB, and walk you through backing it up.

## Key Features

- **Nostr identity:** Client-side key generation with secure IndexedDB storage and a NIP-07 `window.nostr` shim.
- **Business profiles:** Guided form that builds kind-0 profile events with required DineDirect tags and publishes them to selected relays.
- **Media uploads:** Local/dev uploads go directly to nostr.build using a signing secret from `.env`.
- **Relay management:** Configure and persist relays locally for testing before deployment.

## Available Scripts

- `npm run dev` — start Vite in development mode.
- `npm run build` — type-check and build the production bundle.
- `npm run preview` — preview the production build locally.

## Next Steps

- Wire up the Lambda-based upload proxy for production (see `infra/` plan in `.cursorrules`).
- Configure S3 + CloudFront for static hosting once the frontend is ready to deploy.
