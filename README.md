# synvya-client-2

Synvya's merchant-facing web client for onboarding, profile management, and Square catalog publishing. The repo contains the Vite/React frontend, supporting Lambda functions, and deployment plumbing for Synvya's second-generation client site (`https://account.synvya.com`).

## Repository Layout
- `client/` – Vite + React application (TypeScript, Tailwind) and local dev tooling.
- `infra/` – AWS SAM template, Lambda sources, and zipped artifacts for console-based deployments.
- `internal/` – Deployment references (GitHub secrets, IAM policy history, NIP-99 notes).
- `docs/` – Documentation for reservation messaging protocol and AI integration.

## Key Features

### Nostr-Based Identity & Profiles
- Merchant keypair generation and secure storage (IndexedDB + AES-GCM encryption)
- NIP-07 window.nostr shim for signing events
- Kind 0 business profile publishing with business type tags
- NIP-96/NIP-98 media uploads via nostr.build

### Restaurant Reservations
- **4-Message Protocol**: Complete reservation negotiation flow
  - Kind 9901: Initial reservation request
  - Kind 9902: Reservation response (confirmed/declined/cancelled)
  - Kind 9903: Reservation modification request 
  - Kind 9904: Reservation modification response 
- **Message Exchange**: Encrypted NIP-59 gift-wrapped messages with NIP-17 Self CC pattern
- **AI Integration**: AI agents can discover and communicate with restaurants using standard Nostr protocols
- See [NIP-RR repository](https://github.com/Synvya/nip-rr) for the complete protocol specification

### Square Integration
- **OAuth flow** for connecting Square merchant accounts
- **Catalog sync** from Square's Catalog API (items, variations, categories, pricing)
- **Nostr marketplace event generation**:
  - Kind 30402: Product listings for individual menu items with pricing, descriptions, and images
  - Kind 30405: Product collections representing menu hierarchy (e.g., "Lunch Menu", "Appetizers Menu Section")
- **Menu hierarchy support**:
  - Only `MENU_CATEGORY` types create collections (not `REGULAR_CATEGORY`)
  - Top-level menus labeled as "Menu" (e.g., "Dinner Menu")
  - Sub-level menu groups labeled as "Menu Section" (e.g., "Entrees Menu Section")
  - Products reference both direct menu section and parent menu via `a` tags
- **Preview mode**: Test event generation without publishing to relays
- **Lambda endpoints**: `/square/catalog/:npub`, `/square/catalog/:npub/preview`, `/square/catalog/:npub/publish`
- Follows [Gamma Markets Spec](https://github.com/GammaMarkets/market-spec/blob/main/spec.md) for product listings and collections

## Local Development
- Node.js 20+
- From `client/`:
  ```bash
  npm install
  cp .env.example .env
  # Fill in the values described below
  npm run dev
  ```
- The dev server runs on `http://localhost:5173`.

### Required `.env` values for local testing
| Variable | Purpose |
| --- | --- |
| `VITE_UPLOAD_NSEC` | nostr.build upload secret for photo storage |
| `VITE_UPLOAD_PROXY_URL` | Base URL that exposes `/media/upload` (CloudFront routes to the Lambda proxy). |
| `VITE_API_BASE_URL` | Base URL for the API Gateway that fronts the Lambda functions. |
| `VITE_DEFAULT_RELAYS` | Comma-separated relay list for publishing profile events. |
| `VITE_SQUARE_ENV` | `sandbox` or `production` |
| `VITE_SQUARE_APPLICATION_ID` | sandbox-sq****-********************** |
| `VITE_SQUARE_REDIRECT_UR`I` | http://localhost:5173/square/callback |

## Build & Continuous Delivery
- Production builds are generated with `npm run build` from `client/` which creates `client/dist/`.
- `.github/workflows/deploy.yml` automates deployment on pushes to `main` or manual dispatch:
  - Install deps (`npm ci`), run the production build.
  - Assume IAM role `arn:aws:iam::122610503853:role/SynvyaClientGithubActions`.
  - `aws s3 sync dist/ s3://client2-synvya-com --delete`.
  - Optionally invalidate CloudFront distribution `E10XBQFR9NDURM`.
- GitHub repository secrets drive the workflow:

| Secret | Example Value |
| --- | --- |
| `AWS_REGION` | `us-east-1` |
| `AWS_ROLE_ARN` | `arn:aws:iam::123456789012:role/SynvyaClientGithubActions` |
| `CLOUDFRONT_DISTRIBUTION_ID` | `E1234567890ABC` |
| `VITE_UPLOAD_PROXY_URL` | `https://account.synvya.com` |
| `VITE_API_BASE_URL` | `https://abc123.execute-api.us-east-1.amazonaws.com` |
| `VITE_SQUARE_ENV` | `sandbox` |
| `VITE_SQUARE_APPLICATION_ID` | `sandbox-sq0idb-xxxxxxxxxxxxxxxxxxxx` |
| `VITE_SQUARE_REDIRECT_URI` | `https://account.synvya.com/square/callback` |

## AWS Infrastructure

### Static Frontend Hosting (manual console steps)
The static hosting stack was configured directly via the AWS console:
1. **S3 bucket** `client2-synvya-com`
   - Region: `us-east-1`.
   - Block Public Access disabled (serves via CloudFront), but bucket policy restricted to CloudFront Origin Access Control (OAC).
   - Versioning left disabled (deploy pipeline uses `--delete` sync).
2. **CloudFront distribution** pointing at the S3 bucket
   - Origin Access Control connected to the bucket.
   - Alternate domain name `account.synvya.com` with an ACM certificate in `us-east-1`.
   - Default root object `index.html`, error responses mapped for SPA routing (404 → 200).
   - Additional behavior: `/media/*` (and other API paths such as `/square/*`) forward to the API Gateway domain created below.
3. **Route 53** record – `account.synvya.com` ALIAS → CloudFront distribution.


### Backend API (current state)
The API Gateway, Lambda functions, and DynamoDB table were provisioned once (manually) and now run as managed infrastructure. 

- **Resources in service**
  - HTTP API Gateway forwarding `/media/*` to the upload proxy lambda and `/square/*` to the Square integration lambda.
  - DynamoDB table that stores Square OAuth connections.
  - Secrets Manager entries holding the upload and Nostr signing keys.

- **Updating Lambda code**
  - Follow the steps in [Working on the Square Integration lambda locally](#working-on-the-square-integration-lambda-locally) (or the analogous upload proxy instructions) to build a zip containing `square.js`, `media.js`, `package*.json`, and `node_modules` at the archive root.
  - Upload the zip through the Lambda console. No CloudFormation stack update is required for code-only changes.

- **Reprovisioning (only if the infrastructure must be rebuilt)**
  - `infra/template.yaml` captures the original SAM stack used to create the API, Lambda functions, and DynamoDB table. If the stack ever needs to be recreated from scratch, deploy that template via CloudFormation and supply fresh parameter values (`UploadSecretArn`, `AllowedOrigins`, `SquareEnvironment`, `SquareApplicationId`, `SquareClientSecret`, `SquareRedirectUri`, `NostrRelays`, `NostrNsec`).
  - After the stack is recreated, update `VITE_API_BASE_URL`, CloudFront behaviors, and any environment variables/secrets to point at the new resources.

### Secrets & Keys (manual)
1. **AWS Secrets Manager**
   - Created secret (e.g., `synvya-upload-nsec`) in `us-east-1`.
   - Secret value stored as JSON: `{ "synvya-nsec": "nsec1..." }` to match the Lambda default key.
   - Recorded the ARN for the SAM parameter `UploadSecretArn`.
2. **Nostr Signing Key**
   - Separate secret storing the backend signing `nsec` used by the Square Lambda (referenced via parameter `NostrNsec`).
3. **Square Developer Portal**
   - Created an application in the Square dashboard (production mode).
   - Added redirect URI `https://account.synvya.com/square/callback` and sandbox equivalent for testing.
   - Captured Application ID and Client Secret for both SAM template parameters and local `.env`.

### IAM & GitHub Integration (manual console steps)
1. Configured an IAM OIDC provider for `token.actions.githubusercontent.com` (if not already present).
2. Created role `SynvyaClientGithubActions` with trust policy limiting access to the `Synvya/synvya-client-2` repo.
3. Attached deployment policy allowing:
   - S3 sync to `client2-synvya-com`.
   - CloudFront invalidations on distribution `E10XBQFR9NDURM`.
   - CloudFormation/Lambda access for manual updates when required.
4. Stored the role ARN in GitHub secrets and validated `aws sts get-caller-identity` from a workflow run.

### Manual Lambda Maintenance
- **Lambda functions in production**
  - `synvya-upload-proxy` – the NIP-98 upload proxy invoked by `/media/upload`.
  - `synvya-square-integration` – handles Square OAuth, catalogue sync, and classified listing generation.
- Zipped artifacts `infra/lambda.zip` (upload proxy) and `infra/synvya-square-integration.zip` mirror the versions currently deployed. They can be re-uploaded via the Lambda console when an urgent hotfix is required without going through CloudFormation.

#### Working on the Square Integration lambda locally

1. **Install dependencies**
   ```bash
   cd infra/lambda
   npm install
   ```
2. **Manual packaging** – create the ZIP that Lambda expects. Files must live at the root (no `lambda/` folder):
   ```bash
   cd infra/lambda
   npm install --production
   zip -qr ../synvya-square-integration.zip \
     square.js media.js package.json package-lock.json node_modules
   ```
3. **Upload** – in the AWS console open `synvya-square-integration`, choose **Code → Upload from → .zip file**, and select `infra/synvya-square-integration.zip`.

4. **Environment variables** 


| Variable | Example Value | Notes |
| --- | --- | --- |
| `CORS_ALLOW_ORIGIN` | `https://account.synvya.com` | Must include the frontend origin so fetches succeed. |
| `NOSTR_RELAYS` | `wss://relay.damus.io,wss://nos.lol` | Relays queried for the merchant's kind‑0 profile. |
| `SQUARE_ENV` | `sandbox` | `sandbox` or `production`. |
| `SQUARE_APPLICATION_ID` | `sandbox-sq0idb-...` | Copied from Square developer portal. |
| `SQUARE_REDIRECT_URI` | `https://account.synvya.com/square/callback` | Must match the Square app configuration. |
| `SQUARE_CONNECTIONS_TABLE` | `SynvyaSquareConnections` | DynamoDB table name created by the SAM template. |
| `SQUARE_PRIMARY_KEY` | `npub` | DynamoDB partition key (defaults to `npub`). |
| `SQUARE_VERSION` | `2025-01-23` | Square API version header. |

## Operations Checklist
- **Local testing**: `npm run dev`, `npm run build`, `npm run preview`.
- **Deployment**: merge to `main` or trigger the “Deploy Frontend” GitHub Action.
- **Cache busting**: workflow triggers CloudFront invalidation; re-run if assets appear stale.

## Local Test On Branch Before PR 
```
# On the feature branch
npm test -- --run          # All tests pass
npm run build             # Build succeeds
git checkout main         # Switch to main
git pull                  # Get latest
git checkout feature-branch
git merge main            # Merge main into feature
npm test -- --run          # Test again after merge
```