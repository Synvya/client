# Schema and discovery page sync

This document describes when the **embed code** (schema.org LD+JSON) and the **Synvya.com discovery page** (`<type>/<name>/index.html`) are updated so they stay in sync with the merchant's profile and menu.

## Discovery page (Synvya.com)

The discovery page is pushed to Synvya.com in these cases:

- **Profile publish** – When the merchant clicks Publish on the Profile form, after the kind 0 event is published to Nostr, the client calls `fetchAndPublishDiscovery`. The service fetches profile (and menu) from relays, builds the static HTML, and publishes it via the discovery Lambda. The page URL is stored in onboarding state (`discoveryPageUrl`).
- **Profile update** – Same flow: the merchant edits the profile and clicks Publish again; `fetchAndPublishDiscovery` runs and the page is updated.
- **Menu add or update** – When the merchant publishes or resyncs the menu (Square or spreadsheet) from the Menu page, after Nostr events are published, the client calls `fetchAndPublishDiscovery` again. The service fetches the latest profile and menu from relays and republishes the discovery page.

## Embed code (schema store)

The schema shown in Account under "Add to Your Own Website" is stored in `useWebsiteData` (persisted in IndexedDB). It is updated in these cases:

- **After every successful discovery publish** – In `fetchAndPublishDiscovery` (see `client/src/services/discoveryPublish.ts`), after `publishDiscoveryToSynvya` succeeds, the service calls `useWebsiteData.getState().updateSchema(profile, menuEvents, geohash, pubkey, profileTags)`. So whenever the discovery page is pushed (profile publish, profile update, menu publish), the schema store is updated with the same data.
- **Settings backfill** – When the merchant opens the Account (Settings) page with a published profile but the schema store is empty (e.g. discovery push failed earlier, or returning user with cleared storage), a one-time backfill runs: the client calls `fetchDiscoveryData(pubkey, relays)` and then `updateSchema` with the result. The "Add to Your Own Website" section is shown whenever the profile is published; it displays a loading state until the schema is available or the backfill fails.

## Summary

| Event                     | Discovery page updated | Schema store updated   |
|---------------------------|------------------------|-------------------------|
| Profile publish           | Yes                    | Yes (after publish)     |
| Profile update            | Yes                    | Yes (after publish)     |
| Menu add / update         | Yes                    | Yes (after publish)     |
| Settings load (no schema) | No                     | Yes (backfill from Nostr) |

The discovery page is only pushed when the client explicitly runs a publish flow (Profile or Menu). The schema can also be populated by the Settings backfill when the user opens Account and schema is missing.
