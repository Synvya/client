# AI Readiness Report — v1.0

Deterministic, percentage-based readiness report for food establishment owners showing how well their business aligns with best practices for AI visibility — the actions that make AI assistants like ChatGPT, Claude, Gemini, and Perplexity more likely to find, understand, and recommend their business.

## 1. Problem Statement

Food establishments need well-structured data for AI assistants to consider them when diners search by name, cuisine, dish, or dietary preference.

Most food establishments have websites without structured data, serve menus as PDFs that AI cannot read, and have inconsistent information across platforms like Google Business Profile, Yelp, DoorDash, and Uber Eats. AI assistants cross-reference multiple sources and penalize inconsistencies — a restaurant with mismatched hours or prices loses AI trust across ALL its data.

Pages with Schema.org markup are cited 3.1x more frequently in AI Overviews. JSON-LD has 89.4% market share as the structured data format AI engines prefer. The biggest gap for restaurants is machine-readable menu data: AI cannot parse PDF menus.

## 2. Goals and Non-Goals

### 2.1 Goals

- Reuse the business identification logic from the existing `synvya-visibility-report` Lambda to find the business via Google Business Profile
- Define a deterministic benchmark of best practices for AI visibility, organized into four weighted categories
- Run a readiness assessment that returns a compliance percentage (0–100%) against the benchmark
- Generate prioritized recommendations (quick wins in Synvya vs. external actions) based on which checks fail
- Store the report as a NIP-17 encrypted Nostr event so external observers cannot determine the business is a Synvya customer

### 2.2 Non-Goals

- Does NOT run prompts against AI assistants to measure actual results — that is the separate AI Visibility Score feature
- Does NOT check Yelp, DoorDash, or Uber Eats programmatically (no public APIs) — surfaced as recommendations only
- Does NOT assess review volume or ratings — those belong in the AI Visibility Score

## 3. Prerequisites

### 3.1 Google Place ID in Profile (Legacy Code Improvement)

The Profile tab supports finding a business on Google Maps via `searchGooglePlaces` (`client/src/services/googleMaps.ts`) and the `googlemaps.js` Lambda. The Google Place ID is stored in the `kind 0` event with the tag `["i", "google_place_id", "<place-id>"]`.

**Requirement**: The AI Readiness Report requires a Google Place ID. If the business profile does not have one, the Dashboard must prompt the user to complete Google Maps verification in the Profile tab. The "Refresh Report" button is disabled with a tooltip explaining the requirement.

**Current state**: Already implemented in `BusinessProfileForm.tsx` — Google Maps search, candidate selection, and Place ID storage are functional. Only the Dashboard gating logic is new.

### 3.2 Discovery Page Content Completeness (Legacy Code Improvement)

The Synvya discovery page must contain all business information from the Profile tab as structured data. The discovery page generation (`client/src/lib/siteExport/`) and the Schema.org JSON-LD builder (`client/src/lib/schemaOrg.ts`) must include:

- Business name
- Address (street, city, state, zip)
- Phone number
- Website URL
- Opening hours (OpeningHoursSpecification)
- Cuisine type
- Business description

**Requirement**: Any field present in the business profile (`kind:0` event) must appear in the discovery page HTML and Schema.org JSON-LD. Without this, the Website & Schema.org checks (W3–W7) and Data Consistency checks (C1–C5) produce inaccurate results.

**Current state**: Verify which fields are already included in the discovery page output. Add any missing fields before or as part of this feature.

## 4. System Overview

### 4.1 Architecture

```
┌─────────────┐     POST /readiness/assess       ┌──────────────────────┐
│   Client    │ ───────────────────────────────► │  Lambda              │
│  (Dashboard)│  { pubkey, place_id,             │  (readiness.js)      │
│             │    discovery_url }               │                      │
│             │ ◄─────────────────────────────── │  1. Query Google API │
│             │     { status: "complete" }       │  2. Fetch website    │
│             │                                  │  3. Fetch discovery  │
│             │     Query kind:1059              │  4. Run benchmark    │
│             │     from relays                  │  5. Build report     │
│             │ ◄──── (gift-wrapped report) ──── │  6. Seal + wrap      │
│             │                                  │  7. Publish to Nostr │
│  Unwrap with│                                  │  8. Self-CC Synvya   │
│  existing   │                                  └──────────────────────┘
│  NIP-59 code│
└─────────────┘
```

### 4.2 Main Components

**1. UX (Client — Dashboard tab)**
- Displayed at the top of the Dashboard page (`/app/dashboard`), above the existing Analytics section
- "Refresh Report" button triggers a new assessment
- On page load, fetches the most recent report from Nostr by querying `kind:1059` events addressed to the business pubkey, unwrapping with existing `nip59.ts` code, and filtering for `kind:30078` with `d` tag `synvya-readiness-report`
- If no report exists, shows an empty state with a "Run First Report" button

**2. Readiness Engine (Lambda — `readiness.js`)**
- Receives: business Nostr pubkey, Google Place ID, discovery page URL
- Gathers data from two sources:
  - **Google Places API (New)** via Place ID: address, phone, hours, website, category
  - **Business website / Synvya discovery page** via HTTP fetch: existence, HTML menu content, Schema.org JSON-LD. The client passes the discovery page URL; the Lambda does not reconstruct it.
- Runs benchmark checks (Section 5)
- Builds report JSON (Section 6)
- Creates `kind:30078` event, seals and gift-wraps per NIP-17
- Publishes two gift-wrapped copies to relays:
  1. To the business (the receiver)
  2. To Synvya (self-CC for cooldown tracking)

**3. Report Storage (Nostr)**

The inner event before sealing:
```json
{
  "id": "<hash>",
  "pubkey": "<synvya-public-key>",
  "created_at": "<current-unix-timestamp>",
  "kind": 30078,
  "tags": [
    ["d", "synvya-readiness-report"],
    ["p", "<business-pubkey>"]
  ],
  "content": "<NIP-44 encrypted JSON report>"
}
```
- The `d` tag is static — only the latest report is kept per business (replaceable event semantics)
- Sealed (`kind:13`) and gift-wrapped (`kind:1059`) per NIP-17, using the same patterns as `client/src/lib/nip59.ts`
- The Lambda uses `nostr-tools/nip44` and `nostr-tools/nip59` — same libraries as the client
- Relays: `wss://relay.damus.io` and `wss://relay.snort.social`

### 4.3 Synvya Keys

Stored in AWS Secrets Manager as a single secret with two keys: `npub` and `nsec`. Retrieved using the cached Secrets Manager pattern from existing Lambdas (see `media.js`).

### 4.4 Failure Handling

The Lambda depends on external services. Each has defined failure behavior:

| Dependency | Failure mode | Lambda behavior |
|---|---|---|
| Google Places API | Timeout or HTTP error | Return `500`. Google data is required for all categories; partial report is not useful. |
| Website fetch (`websiteUri`) | Timeout, DNS failure, HTTP error | Mark all M checks as `fail` with `detail: "website_unreachable"`. Mark W3–W7 as `fail` with same detail. Do NOT return 500 — the report is still useful (Google + discovery + consistency). |
| Discovery page fetch | Timeout, DNS failure, HTTP error | Mark W2 as `fail`. Mark C1–C5 as `skipped`. Menu checks fall back to website only. |
| Nostr relay publish | Connection failure | Retry up to 3 times with 2s delay. If all retries fail, return `500`. A report that can't be stored is not delivered. |

Per-fetch timeout: **5 seconds** for website and discovery page fetches. Google Places API uses the SDK default.

**Execution order**: Google Places API runs first (required to obtain `websiteUri`). Once Google responds, website fetch and discovery page fetch run concurrently (`Promise.all`). If `websiteUri` is absent, website fetch is skipped. Nostr publishes (business + self-CC) also run concurrently.

### 4.5 Security

**SSRF protection**: The Lambda fetches `websiteUri` from Google Places, which is an arbitrary URL. Before fetching:
- Resolve the hostname via DNS
- If DNS returns multiple A/AAAA records, **all** resolved addresses must be public. If any resolved address is private or reserved, block the URL.
- Block IPv4 private/reserved ranges: `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16` (AWS metadata), `127.0.0.0/8`
- Block IPv6 private/reserved ranges: `::1`, `fc00::/7` (unique local), `fe80::/10` (link-local)
- Allow only `http://` and `https://` protocols
- If the URL fails validation, mark website checks as `fail` with `detail: "blocked_url"`

**Response size limit**: Max **1 MB** for website and discovery page responses. Truncate or abort if exceeded. Mark checks as `fail` with `detail: "response_too_large"`.

**HTML parsing safety**: Use a streaming/SAX parser or a safe DOM parser (e.g., `cheerio`). Do not execute JavaScript. Only extract `<script type="application/ld+json">` blocks.

## 5. Benchmark Specification

Four categories with weighted checks. Each check is binary (pass/fail). The overall readiness percentage is:

```
overall_percentage = Σ (category_weight × category_percentage)
category_percentage = (passing_checks / total_checks) × 100
```

When a check is `skipped`, it is excluded from both numerator and denominator.

### 5.1 Google Business Profile (Weight: 25%)

Source: Google Places API (New) via Place ID.

| # | Check | Pass condition | Data field |
|---|---|---|---|
| G1 | Found on Google Maps | Place ID resolves successfully | `places/{id}` returns 200 |
| G2 | Address listed | `formattedAddress` is non-empty | `formattedAddress` |
| G3 | Phone number listed | `nationalPhoneNumber` or `internationalPhoneNumber` is non-empty | `nationalPhoneNumber` |
| G4 | Opening hours listed | `currentOpeningHours` or `regularOpeningHours` is present | `regularOpeningHours` |
| G5 | Website URL listed | `websiteUri` is non-empty | `websiteUri` |
| G6 | Business category set | `primaryType` is non-empty | `primaryType` |

### 5.2 Machine-Readable Menu (Weight: 35%)

Source: JSON-LD from the business website (from Google `websiteUri`) or the Synvya discovery page (if no own website). Parsed via the `normalizeJsonLd()` contract (Section 5.8).

v1.0 uses **JSON-LD only** — no HTML heuristic parsing. This keeps scoring deterministic: same page always produces the same score. AI assistants themselves prioritize JSON-LD over unstructured HTML.

**Source selection**: M checks are evaluated against exactly one source: the Google-listed website (`websiteUri`) if present, otherwise the discovery page. Never both. If `websiteUri` is absent and `discovery_url` is null, all M checks fail.

| # | Check | Pass condition | Data source |
|---|---|---|---|
| M1 | Menu items on website | ≥1 `MenuItem` found in JSON-LD | Selected source JSON-LD |
| M2 | Items have descriptions | ≥80% of MenuItems have non-empty `description` | Selected source JSON-LD |
| M3 | Items have prices | ≥80% of MenuItems have `offers.price` | Selected source JSON-LD |
| M4 | Items have dietary tags | ≥30% of MenuItems have `suitableForDiet` | Selected source JSON-LD |
| M5 | Items have images | ≥50% of MenuItems have `image` | Selected source JSON-LD |
| M6 | Menu organized in sections | ≥1 `MenuSection` with `hasMenuItem` | Selected source JSON-LD |

**M1 is a gating check.** If M1 fails (0 menu items), M2–M6 auto-fail (not skipped). This avoids division-by-zero on percentage calculations and correctly reflects that no menu data means no menu quality.

**Threshold rationale**: M2/M3 at 80% — a few items without descriptions/prices is acceptable (market-price items). M4 at 30% — not all items have dietary relevance but AI heavily rewards any tagging. M5 at 50% — images are valuable but many menus don't photograph every item.

**Fallback logic**: Check the Google-listed website first. If that URL matches the discovery page URL, only one fetch is needed. If the website has no JSON-LD menu but the discovery page does, the recommendation suggests changing the Google website URL to the discovery page.

### 5.3 Website & Schema.org (Weight: 25%)

Source: Google Places API for `websiteUri`, then HTTP fetch + JSON-LD parse via `normalizeJsonLd()` (Section 5.8).

| # | Check | Pass condition | Data source |
|---|---|---|---|
| W1 | Website listed on Google | `websiteUri` is non-empty and points to the business website or Synvya discovery page | Google Places API |
| W2 | Discovery page published | Synvya discovery page returns HTTP 200 | HTTP GET on discovery URL |
| W3 | JSON-LD FoodEstablishment | `@type: "Restaurant"` (or FoodEstablishment subtype) in JSON-LD | Google-listed website JSON-LD |
| W4 | Schema.org OpeningHoursSpecification | `openingHoursSpecification` array in JSON-LD | Google-listed website JSON-LD |
| W5 | Schema.org Menu with MenuItems | `hasMenu` with ≥1 `MenuItem` in JSON-LD | Google-listed website JSON-LD |
| W6 | Schema.org prices on items | ≥80% of MenuItems have `offers.price` | Google-listed website JSON-LD |
| W7 | Schema.org dietary info | ≥1 MenuItem has `suitableForDiet` | Google-listed website JSON-LD |

**W1 is a gating check.** If W1 fails (no `websiteUri` on Google), W3–W7 automatically fail. The report summary states: "Your Google Business Profile has no website URL. Add your business website, or if you don't have one, set it to your Synvya discovery page URL so AI assistants can find your structured data."

W2 is independent of W1 — the discovery page may exist even if Google doesn't link to it. If W2 passes but W1 fails, the recommendation highlights that the page exists but Google doesn't know about it.

**Schema.org source priority**: W3–W7 check the Google-listed website. If that site has no JSON-LD but the discovery page does, W3–W7 still fail because AI crawlers follow the Google URL. The recommendation is to either add Schema.org to the business website or change the Google website URL to the discovery page.

### 5.4 Data Consistency (Weight: 15%)

Source: Cross-reference Google Places API against Synvya discovery page Schema.org JSON-LD.

| # | Check | Pass condition | Comparison |
|---|---|---|---|
| C1 | Business name matches | Normalized names match | Google `displayName` vs Schema.org `name` |
| C2 | Address matches | Normalized addresses match | Google `formattedAddress` vs Schema.org `address` |
| C3 | Phone matches | Digits-only values match | Google `nationalPhoneNumber` vs Schema.org `telephone` |
| C4 | Hours match | Per-day open/close times within tolerance | Google `regularOpeningHours` vs Schema.org `openingHoursSpecification` |
| C5 | Website URL matches | Normalized domains match | Google `websiteUri` vs Schema.org `url` |

C1–C5 require the discovery page to exist (W2 pass). If it does not exist, all are skipped (excluded from denominator) and the recommendation prioritizes publishing the discovery page.

**Normalization algorithms:**

**C1 — Name**: Lowercase, trim whitespace, collapse multiple spaces. Strip common suffixes ("LLC", "Inc", "Restaurant"). Compare with exact string match after normalization.

**C2 — Address**: Lowercase, strip punctuation. Standardize abbreviations: `st` → `street`, `ave` → `avenue`, `blvd` → `boulevard`, `dr` → `drive`, `rd` → `road`, `ste` → `suite`, `apt` → `apartment`. Remove suite/unit numbers before comparison. Compare first line (street) and city independently. Both must match.

**C3 — Phone**: Strip all non-digit characters. Remove leading `1` (US country code) if present. Compare the resulting 10-digit strings.

**C4 — Hours**: Convert both sources to a canonical format: array of `{ day: 0-6, open: minutes_from_midnight, close: minutes_from_midnight }`. If neither source has hours, the check is skipped. If there are zero overlapping days between sources, the check fails. For overlapping days, open and close times must each be within **30 minutes**. A day present in one source but missing from the other counts as a mismatch. Pass if all days match (overlapping within tolerance, no unmatched days). The `detail` field reports match quality, e.g., `"5/7 days matched"`.

**C5 — URL**: Extract hostname only. Strip `www.` prefix. Compare hostnames. Paths, query strings, and fragments are ignored. Example: `https://www.elcandado.com/menu` and `http://elcandado.com` both normalize to `elcandado.com` → pass.

### 5.5 Overall Score Calculation

```
overall = (0.25 × google_pct) + (0.35 × menu_pct) + (0.25 × schema_pct) + (0.15 × consistency_pct)
```

Color thresholds:
- **Green** (≥ 75%): Strong AI readiness
- **Orange** (40–74%): Partially ready — key gaps to address
- **Red** (< 40%): Low readiness — AI assistants are likely skipping this business

### 5.6 Diagnosis Labels

Human-readable one-liner selected by the first matching condition:

| Condition | Label |
|---|---|
| Overall ≥ 90% | Excellent — fully optimized for AI discovery |
| Overall ≥ 75% | Strong — minor improvements available |
| Menu < 30% AND Google ≥ 60% | Partially ready — menu data missing |
| Schema < 30% AND Menu ≥ 60% | Menu exists but website lacks Schema.org markup |
| Consistency < 50% | Data conflicts across platforms — AI trust at risk |
| Google < 30% | Weak Google presence — not visible to AI search |
| Overall < 25% | Low readiness — most AI assistants will skip this business |
| Default | Partially ready — multiple areas need attention |

### 5.7 Recommendation Generation

Recommendations are generated from failing checks, ordered by impact (weight × number of affected checks). Each includes:
- **Priority**: `quick_win` (actionable in Synvya) or `external` (requires action outside Synvya)
- **Title**: Action-oriented one-liner
- **Body**: Why it matters + where to do it
- **CTA link**: For quick wins, the relevant Synvya tab (Menu, Settings, Profile)

Always-included recommendation (regardless of check results):
- **Yelp/DoorDash/UberEats**: "List your business on Yelp and delivery platforms. AI assistants cross-reference Google, Yelp, DoorDash, and Uber Eats. Ensure your menu and hours are consistent across all platforms." (Priority: `external`)

### 5.8 JSON-LD Parsing Contract

All structured data extraction uses a single `normalizeJsonLd(html)` function that returns a normalized object. This avoids duplicating parsing logic across checks.

**Input**: Raw HTML string (from website or discovery page fetch).

**Extraction steps**:
1. Find all `<script type="application/ld+json">` blocks in the HTML
2. Parse each as JSON. Skip blocks that fail to parse.
3. If a block contains `@graph`, flatten: treat each item in the array as a top-level entity
4. Collect all entities across all blocks into a single array

**Entity resolution**:
1. Find the first entity where `@type` is `"Restaurant"`, `"FoodEstablishment"`, `"CafeOrCoffeeShop"`, `"BarOrPub"`, `"FastFoodRestaurant"`, or `"Bakery"` (Schema.org FoodEstablishment subtypes). This is the `foodEstablishment`.
2. If `@type` is an array (e.g., `["Restaurant", "LocalBusiness"]`), match if ANY element is a FoodEstablishment subtype.
3. Extract `hasMenu` from the food establishment. If `hasMenu` is a URL string, look for a `Menu` entity with that `@id` in the collected entities. If it's an inline object, use directly.
4. Extract `MenuItem` entries from the menu's `hasMenuSection[].hasMenuItem[]` or `hasMenuItem[]` (flat menu without sections).
5. Extract `MenuSection` entries from `hasMenuSection[]`.

**Output**:
```typescript
{
  foodEstablishment: {  // null if not found
    type: string,
    name: string,
    address: string | { streetAddress, addressLocality, ... },
    telephone: string,
    url: string,
    openingHoursSpecification: Array<{ dayOfWeek, opens, closes }>,
  },
  menuItems: Array<{    // empty array if none
    name: string,
    description: string | null,
    price: number | null,      // from offers.price
    image: string | null,
    suitableForDiet: string[] | null,
  }>,
  menuSections: Array<{  // empty array if none
    name: string,
    itemCount: number,
  }>,
}
```

All check logic operates on this normalized output, never on raw HTML or raw JSON-LD.

## 6. Report Content Schema

The `content` field of the `kind:30078` event is NIP-44 encrypted JSON:

```json
{
  "version": 1,
  "type": "readiness-report",
  "created_at": 1711324800,
  "business_pubkey": "<hex-pubkey>",
  "google_place_id": "<place-id>",
  "overall_percentage": 50,
  "color": "orange",
  "diagnosis_label": "Partially ready — menu data missing",
  "summary": "Your Google presence is solid but AI assistants can't find a machine-readable menu...",
  "categories": {
    "google_business_profile": {
      "weight": 0.25,
      "percentage": 83,
      "checks": {
        "found_on_google": { "pass": true },
        "address_listed": { "pass": true },
        "phone_listed": { "pass": true },
        "hours_listed": { "pass": true },
        "website_listed": { "pass": true },
        "category_set": { "pass": false }
      }
    },
    "machine_readable_menu": {
      "weight": 0.35,
      "percentage": 0,
      "checks": {
        "items_published": { "pass": false, "detail": "0 items found" },
        "items_have_descriptions": { "pass": false, "detail": "0%" },
        "items_have_prices": { "pass": false, "detail": "0%" },
        "items_have_dietary_tags": { "pass": false, "detail": "0%" },
        "items_have_images": { "pass": false, "detail": "0%" },
        "menu_organized": { "pass": false }
      }
    },
    "website_schema_org": {
      "weight": 0.25,
      "percentage": 57,
      "checks": {
        "website_exists": { "pass": true },
        "discovery_page_published": { "pass": true },
        "json_ld_food_establishment": { "pass": true },
        "schema_opening_hours": { "pass": true },
        "schema_menu_with_items": { "pass": false },
        "schema_prices_on_items": { "pass": false },
        "schema_dietary_info": { "pass": false }
      }
    },
    "data_consistency": {
      "weight": 0.15,
      "percentage": 100,
      "checks": {
        "name_matches": { "pass": true },
        "address_matches": { "pass": true },
        "phone_matches": { "pass": true },
        "hours_match": { "pass": true, "detail": "7/7 days matched" },
        "website_matches": { "pass": true }
      }
    }
  },
  "recommendations": [
    {
      "priority": "quick_win",
      "title": "Publish your menu as structured data",
      "body": "AI assistants cannot read PDF menus. Connect your Square POS in the Menu tab...",
      "cta_tab": "menu",
      "impact_pct": 35
    },
    {
      "priority": "external",
      "title": "Set your business category on Google",
      "body": "Log into Google Business Profile and set your primary category...",
      "cta_tab": null,
      "impact_pct": 4
    }
  ],
  "data_snapshot": {
    "google": {
      "display_name": "El Candado",
      "address": "123 Main St, Austin, TX 78701",
      "phone": "(512) 555-1234",
      "website": "https://elcandado.com",
      "primary_type": null,
      "hours_available": true
    },
    "discovery_page": {
      "url": "https://synvya.com/restaurant/el-candado/",
      "exists": true,
      "has_json_ld": true,
      "schema_types": ["Restaurant", "OpeningHoursSpecification"],
      "schema_name": "El Candado",
      "schema_address": "123 Main St, Austin, TX 78701",
      "schema_phone": "+15125551234",
      "schema_website": "https://elcandado.com",
      "schema_hours": true,
      "menu_item_count": 0
    },
    "website": {
      "url": "https://elcandado.com",
      "reachable": true,
      "has_json_ld": false,
      "menu_item_count": 0
    }
  }
}
```

**Field definitions:**
- `version`: Schema version for forward compatibility. Current: `1`
- `pass`: `true` or `false`. Omitted when `skipped` is `true`.
- `skipped`: When `true`, the check is excluded from category percentage denominator. The `pass` field is omitted. Example: `{ "skipped": true, "detail": "discovery_page_missing" }`
- `detail`: Optional human-readable context (e.g., `"5/7 days matched"`, `"3 of 24 items"`, `"website_unreachable"`)
- `data_snapshot`: Raw data used for assessment — stored for debugging and Data Consistency display
- `impact_pct`: Estimated percentage-point gain if this recommendation is addressed. Formula: `category_weight × (checks_this_recommendation_fixes / total_non_skipped_checks_in_category) × 100`. If a recommendation spans multiple categories, sum across categories. Example: publishing a menu fixes M1–M6 (6/6 checks in a 35%-weight category) → `impact_pct = 0.35 × (6/6) × 100 = 35`.

## 7. Display Specification

Rendered at the top of the Dashboard page, above Analytics charts. See `docs/specs/dashboard-mockup.html` for visual reference.

### 7.1 Layout

1. **Header**: "AI Readiness Report" title + subtitle
2. **Score hero** (left-to-right):
   - Circular gauge with overall percentage, color-coded (green/orange/red)
   - Diagnosis badge (colored pill)
   - Summary paragraph (from `summary` field)
   - "Refresh Report" button
   - "Last assessed: {date}" timestamp
3. **Category cards** (2×2 grid):
   - Category name + percentage + weight label
   - Progress bar, color-coded
   - Checklist of checks (green ✓ / red ✗)
4. **Recommendations** (ordered list):
   - Legend: green = quick win, orange = external action
   - Each: numbered icon + bold title + description + CTA link

### 7.2 Empty State

- Heading: "No AI Readiness Report yet"
- Body: "Run your first report to see how ready your business is for AI discovery."
- "Run First Report" button (primary style)
- If Google Place ID missing: button disabled, text reads "Complete your Google Maps verification in the Profile tab first"

### 7.3 Loading State

- "Refresh Report" replaced with spinner + "Analyzing..."
- Button disabled to prevent duplicate submissions
- On completion: re-fetch report from Nostr and update display

### 7.4 Color Coding

| Range | Color | CSS variable |
|---|---|---|
| ≥ 75% | Green | `--primary` (#22c55e) |
| 40–74% | Orange | `--orange` (#f97316) |
| < 40% | Red | `--red` (#ef4444) |

Applied to: gauge stroke, percentage text, category bar fills, category percentage labels.

## 8. API Specification

### 8.1 Trigger Assessment

```
POST {VITE_API_BASE_URL}/readiness/assess
```

**Request body:**
```json
{
  "pubkey": "<hex-pubkey-of-business>",
  "place_id": "<google-place-id>",
  "discovery_url": "https://synvya.com/restaurant/el-candado/"
}
```

`discovery_url`: Full URL of the Synvya discovery page. The client provides this. Set to `null` if no discovery page has been published.

**Responses:**

| Status | Body | Meaning |
|---|---|---|
| `200` | `{ "status": "complete", "event_id": "<kind-1059-event-id>" }` | Report published to Nostr |
| `400` | `{ "status": "error", "error": "Missing required field: pubkey" }` | Missing required fields |
| `404` | `{ "status": "error", "error": "Google Place ID not found" }` | Place ID invalid |
| `429` | `{ "status": "cooldown", "next_available_at": 1711929600, "message": "Assessment available again on April 1, 2026" }` | Cooldown active (production only) |
| `500` | `{ "status": "error", "error": "Internal error" }` | Server error |

### 8.2 CORS

Allow `https://account.synvya.com` and `http://localhost:5173` (dev). Same pattern as existing Lambdas.

## 9. Configuration

### 9.1 Lambda Environment Variables

| Variable | Value | Source |
|---|---|---|
| `SYNVYA_SECRET_ARN` | ARN of Secrets Manager secret containing Synvya `npub` and `nsec` | AWS Console |
| `SYNVYA_SECRET_NPUB_KEY` | JSON key for npub (default: `npub`) | AWS Console |
| `SYNVYA_SECRET_NSEC_KEY` | JSON key for nsec (default: `nsec`) | AWS Console |
| `GOOGLE_MAPS_SECRET_ARN` | ARN of Google Maps API key secret | AWS Console (same as `googlemaps.js`) |
| `GOOGLE_MAPS_SECRET_KEY` | JSON key for API key (default: `google-maps-api-key`) | AWS Console |
| `NOSTR_RELAYS` | Comma-separated relay URLs (default: `wss://relay.damus.io,wss://relay.snort.social`) | AWS Console |
| `CORS_ALLOW_ORIGIN` | Allowed origins (default: `https://account.synvya.com`) | AWS Console |
| `DISCOVERY_BASE_URL` | Base URL for discovery pages (default: `https://synvya.com`) | AWS Console |

### 9.2 Lambda Deployment

- Function name: `synvya-readiness-report`
- Runtime: Node.js 18 (ARM64)
- File: `infra/lambda/readiness.js`
- Timeout: 30 seconds (see Section 4.4 for per-fetch timeouts and parallelization)
- Memory: 256 MB
- Dependencies: same `package.json` as other Lambdas (`nostr-tools`, `@aws-sdk/client-secrets-manager`, `node-fetch`, `ws`, `cheerio`)

### 9.3 API Gateway Route

Add to existing HTTP API: `POST /readiness/assess` → `synvya-readiness-report` Lambda

### 9.4 CloudFront Behavior

Add `/readiness/*` behavior routing to API Gateway (same pattern as `/api/*`).

### 9.5 Rate Limiting

- **Production**: One assessment per business per 7 days. The Lambda checks `created_at` of the most recent self-CC `kind:30078` event for the business pubkey. If < 7 days, return `429`.
- **Development** (`CORS_ALLOW_ORIGIN` includes `localhost`): No cooldown.
- No DynamoDB needed — cooldown reads from Nostr self-CC events.
- **Client**: On `429`, show "Next assessment available on {date}" and disable the button.

### 9.6 IAM Permissions

Lambda execution role requires:
- `secretsmanager:GetSecretValue` on Synvya secret ARN and Google Maps secret ARN
- No DynamoDB access needed

### 9.7 Client Environment

No new environment variables. Uses existing `VITE_API_BASE_URL`.

## 10. Testing

### 10.1 Lambda Unit Tests (`infra/lambda/readiness.test.js`)

Vitest, from `infra/lambda/`. Same patterns as `customers.test.js`.

**Benchmark scoring:**

| Test | Description |
|---|---|
| `calculates overall percentage from category scores` | Known category percentages × weights = correct weighted sum |
| `category percentage counts only non-skipped checks` | 5 checks, 1 skipped, 3 pass → 3/4 = 75% |
| `all checks passing yields 100%` | Full data → 100% |
| `no data yields 0%` | Empty data → 0% |
| `skipped checks excluded from denominator` | Skipped check not counted in total |

**JSON-LD parsing (`normalizeJsonLd`):**

| Test | Description |
|---|---|
| `extracts FoodEstablishment from single JSON-LD block` | Standard single-block page → correct entity |
| `handles @graph with multiple entities` | JSON-LD with `@graph` array → flattens and finds Restaurant |
| `handles multiple JSON-LD blocks` | Two `<script>` blocks → merges entities from both |
| `handles @type as array` | `@type: ["Restaurant", "LocalBusiness"]` → matches |
| `extracts MenuItems from nested hasMenuSection` | `hasMenu.hasMenuSection[].hasMenuItem[]` → flat array |
| `extracts MenuItems from flat hasMenuItem` | `hasMenu.hasMenuItem[]` → flat array |
| `resolves hasMenu URL reference via @id` | `hasMenu: "url"` + separate Menu entity with matching `@id` → resolved |
| `returns empty menuItems when no menu` | FoodEstablishment without `hasMenu` → `menuItems: []` |
| `skips malformed JSON-LD blocks` | Invalid JSON in script tag → skipped, other blocks still parsed |

**Individual checks:**

| Test | Description |
|---|---|
| `M1: menu items found in JSON-LD` | Mock page with Schema.org MenuItems → M1 passes |
| `M1: no menu on website, found on discovery page` | Website without menu + discovery page with menu → M1 fails, recommendation generated |
| `M1 fail cascades to M2–M6` | 0 menu items → M1 fails, M2–M6 auto-fail (not skipped) |
| `M2: description threshold at 80%` | 10 items, 7 with descriptions → M2 fails (70% < 80%) |
| `M4: dietary tag threshold at 30%` | 10 items, 3 with tags → M4 passes (30% ≥ 30%) |
| `W1: fails when no websiteUri on Google` | No websiteUri → W1 fails, W3–W7 auto-fail |
| `W1: passes when websiteUri is discovery page` | websiteUri = discovery URL → W1 passes |
| `C1: name matching ignores case and suffixes` | "El Candado Restaurant" vs "el candado" → passes |
| `C2: address matching normalizes abbreviations` | "123 Main St" vs "123 Main Street" → passes |
| `C2: address matching ignores suite numbers` | "123 Main St, Ste 200" vs "123 Main Street" → passes |
| `C3: phone matching strips country code` | "+1 (512) 555-1234" vs "5125551234" → passes |
| `C4: hours match within 30-min tolerance` | open 9:00 vs open 9:30 same day → passes |
| `C4: hours fail beyond 30-min tolerance` | open 9:00 vs open 10:00 same day → fails |
| `C4: missing day in one source counts as mismatch` | Google has Mon–Sun, discovery has Fri–Sun → fails |
| `C4: neither source has hours → skipped` | No hours on either side → check skipped |
| `C5: URL matching is hostname-only` | "https://www.elcandado.com/menu" vs "http://elcandado.com" → passes |
| `C1–C5: skipped when discovery page missing` | No discovery page → all skipped, excluded from denominator |

**Failure handling:**

| Test | Description |
|---|---|
| `Google API failure returns 500` | Mock Google timeout → Lambda returns 500 |
| `website fetch failure marks M and W checks as failed` | Mock website timeout → M1–M6 fail with `detail: "website_unreachable"`, W3–W7 fail |
| `discovery fetch failure skips C checks` | Mock discovery timeout → W2 fails, C1–C5 skipped |
| `Nostr publish retry on failure` | Mock first 2 publishes fail, 3rd succeeds → 200 |
| `Nostr publish returns 500 after 3 retries` | Mock all publishes fail → 500 |

**Security:**

| Test | Description |
|---|---|
| `blocks private IP in websiteUri` | websiteUri resolves to 169.254.169.254 → checks fail with `detail: "blocked_url"` |
| `blocks when any DNS record is private` | websiteUri resolves to [93.184.216.34, 10.0.0.1] → blocked |
| `blocks IPv6 private ranges` | websiteUri resolves to fc00::1 → blocked |
| `blocks non-http protocols` | websiteUri is `file:///etc/passwd` → checks fail with `detail: "blocked_url"` |
| `truncates response over 1MB` | Mock 2MB response → checks fail with `detail: "response_too_large"` |

**Recommendations:**

| Test | Description |
|---|---|
| `recommendations ordered by impact` | Quick wins with highest `impact_pct` first |
| `Yelp/DoorDash recommendation always included` | Present regardless of check results |
| `no recommendations when all checks pass` | Only Yelp/DoorDash general recommendation |

**Diagnosis labels:**

| Test | Description |
|---|---|
| `selects correct label based on category scores` | Each condition in Section 5.6 table |
| `labels evaluated in priority order` | Multiple matches → first wins |

**NIP-17 wrapping:**

| Test | Description |
|---|---|
| `creates kind 30078 event with correct tags` | `d: synvya-readiness-report` and `p: <business-pubkey>` |
| `encrypts content with NIP-44` | Content encrypted, decryptable with recipient key |
| `creates two gift wraps (recipient + self-CC)` | Two `kind:1059` events: business + Synvya |
| `seal pubkey matches rumor pubkey` | Seal signed by Synvya key |

**API handler:**

| Test | Description |
|---|---|
| `returns 400 when pubkey missing` | No pubkey → 400 |
| `returns 400 when place_id missing` | No place_id → 400 |
| `returns 404 when Place ID not found` | Google 404 → 404 |
| `returns 200 with event_id on success` | Full mock → 200 |
| `returns 429 when cooldown active (production)` | Self-CC 3 days old + production origin → 429 |
| `allows request during cooldown in dev mode` | Self-CC 3 days old + localhost origin → 200 |
| `handles OPTIONS preflight` | OPTIONS → 204 with CORS headers |

### 10.2 Client Unit Tests (`client/src/`)

**Report parsing** (`services/readiness.test.ts`):

| Test | Description |
|---|---|
| `parses report JSON from unwrapped event` | Mock NIP-59 event → all fields parse correctly |
| `handles version 1 report format` | Forward-compatibility check on `version` field |
| `calculates category colors from percentages` | Green/orange/red thresholds correct |

**Dashboard component** (`pages/Dashboard.test.tsx`):

| Test | Description |
|---|---|
| `renders empty state when no report exists` | No events → "No AI Readiness Report yet" |
| `renders report with correct overall percentage` | Gauge displays correct number |
| `renders all 4 category cards` | Google, Menu, Schema, Consistency present |
| `renders pass/fail icons correctly` | Mixed results → correct ✓ and ✗ |
| `renders recommendations in order` | Sorted by impact |
| `disables button when Google Place ID missing` | No Place ID → button disabled |
| `shows loading state during assessment` | Spinner appears |

### 10.3 Integration Tests (`client/src/integration/readinessReport.test.ts`)

| Test | Description |
|---|---|
| `full NIP-59 wrap/unwrap cycle` | Create report → wrap → unwrap → content intact |
| `report event has correct kind and tags` | kind 30078, correct d-tag and p-tag |

### 10.4 Test Fixtures

`infra/lambda/test-fixtures/`:
- `google-place-full.json` — Complete Google Places API response
- `google-place-minimal.json` — Minimal (name + address only)
- `google-place-no-website.json` — No `websiteUri` field
- `discovery-page-full.html` — Complete JSON-LD: FoodEstablishment, Menu, MenuSections, MenuItems with prices/dietary/images, OpeningHoursSpecification, address, phone, url
- `discovery-page-minimal.html` — FoodEstablishment only (no menu)
- `website-with-menu.html` — JSON-LD Menu + MenuItems
- `website-no-schema.html` — No JSON-LD structured data
- `website-graph-format.html` — JSON-LD using `@graph` array with multiple entities
- `website-multiple-blocks.html` — Two separate `<script type="application/ld+json">` blocks
- `website-malformed-jsonld.html` — One valid and one malformed JSON-LD block

## 11. Development Workflow

1. Branch: `feature/ai-readiness-report` from `main`
2. Write all test files first (Lambda + client)
3. Confirm all tests fail (red phase)
4. Implement Lambda: `infra/lambda/readiness.js`
5. Implement client service: `client/src/services/readiness.ts`
6. Implement Dashboard UI: `client/src/pages/Dashboard.tsx`
7. Run tests until all pass (green phase)
8. `cd client && npm run build` to verify type-checking
9. PR against `main`

## 12. Future Enhancements

The following checks require the Google Business Profile API, which needs account-level access beyond the Google Places API (New). Deferred until GBP API integration is available.

| Check ID | Category | Check | Description |
|---|---|---|---|
| G7 | Google Business Profile | Menu link set and points to HTML | `menuUri` non-empty and resolves to HTML (not PDF). HTTP HEAD check on Content-Type. If business has no website, recommend pointing menu link to Synvya discovery page. |
| G8 | Google Business Profile | Native menu data on Google | Business has structured food menu entries via `locations.getFoodMenus`. |
| C6 | Data Consistency | Google menu link points to menu page | `menuUri` resolves to a page with menu items, not a PDF or homepage. |
| C7 | Data Consistency | Menu on Google matches website menu | Google native menu items vs Schema.org MenuItems overlap ≥ 70% (fuzzy match). Only when both sources have data; skipped otherwise. |

When added, the report `version` field increments to `2`. The client must handle both versions for backward compatibility.
