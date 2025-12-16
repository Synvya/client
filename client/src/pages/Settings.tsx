import { FormEvent, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/state/useAuth";
import { useRelays } from "@/state/useRelays";
import { KeyBackupDrawer } from "@/components/KeyBackupDrawer";
import { useLocation } from "react-router-dom";
import { ChevronDown, ChevronUp, Copy, KeyRound, RadioTower, Store } from "lucide-react";
import { buildSquareAuthorizeUrl } from "@/lib/square/auth";
import {
  fetchSquareStatus,
  publishSquareCatalog,
  previewSquareCatalog,
  type SquareConnectionStatus,
  type SquareEventTemplate,
} from "@/services/square";
import { publishToRelays } from "@/lib/relayPool";
import { validateEvent } from "@/validation/nostrValidation";
import { resolveProfileLocation } from "@/lib/profileLocation";
import { useBusinessProfile } from "@/state/useBusinessProfile";
import { PublicationPreview } from "@/components/PublicationPreview";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export function SettingsPage(): JSX.Element {
  const npub = useAuth((state) => state.npub);
  const pubkey = useAuth((state) => state.pubkey);
  const signEvent = useAuth((state) => state.signEvent);
  const revealSecret = useAuth((state) => state.revealSecret);
  const relays = useRelays((state) => state.relays);
  const addRelay = useRelays((state) => state.addRelay);
  const removeRelay = useRelays((state) => state.removeRelay);
  const resetRelays = useRelays((state) => state.resetRelays);
  const { location: cachedProfileLocation, setLocation: setCachedProfileLocation } = useBusinessProfile((state) => ({
    location: state.location,
    setLocation: state.setLocation
  }));
  const location = useLocation();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerSecret, setDrawerSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [newRelay, setNewRelay] = useState("");
  const [busy, setBusy] = useState(false);
  const [squareStatus, setSquareStatus] = useState<SquareConnectionStatus | null>(null);
  const [squareLoading, setSquareLoading] = useState(false);
  const [squareError, setSquareError] = useState<string | null>(null);
  const [squareNotice, setSquareNotice] = useState<string | null>(null);
  const [statusVersion, setStatusVersion] = useState(0);
  const [connectBusy, setConnectBusy] = useState(false);
  const [resyncBusy, setResyncBusy] = useState(false);
  const [publishConfirmOpen, setPublishConfirmOpen] = useState(false);
  const [advancedSettingsOpen, setAdvancedSettingsOpen] = useState(false);
  const [previewViewed, setPreviewViewed] = useState(false);
  const [previewEvents, setPreviewEvents] = useState<SquareEventTemplate[] | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewPendingCount, setPreviewPendingCount] = useState(0);
  const [previewTotalEvents, setPreviewTotalEvents] = useState(0);
  const [previewDeletionCount, setPreviewDeletionCount] = useState(0);

  const handleReveal = async () => {
    setBusy(true);
    try {
      const secret = await revealSecret();
      if (secret) {
        setDrawerSecret(secret);
        setDrawerOpen(true);
      }
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!pubkey) {
      setSquareStatus(null);
      setPreviewViewed(false);
      setPreviewEvents(null);
      return;
    }
    setSquareLoading(true);
    setSquareError(null);
    void fetchSquareStatus(pubkey)
      .then((status) => {
        setSquareStatus(status);
        if (!status.connected) {
          setSquareNotice(null);
          setPreviewViewed(false);
          setPreviewEvents(null);
        }
        if (status.profileLocation) {
          setCachedProfileLocation(status.profileLocation);
        }
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : "Failed to load Square status.";
        setSquareError(message);
        setSquareStatus(null);
        setPreviewViewed(false);
        setPreviewEvents(null);
      })
      .finally(() => {
        setSquareLoading(false);
      });
  }, [pubkey, statusVersion, setCachedProfileLocation]);

  useEffect(() => {
    if (!pubkey || cachedProfileLocation) {
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const location = await resolveProfileLocation(pubkey, relays, null);
        if (!cancelled && location) {
          setCachedProfileLocation(location);
        }
      } catch (error) {
        console.warn("Failed to resolve profile location for Square publish", error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pubkey, relays, cachedProfileLocation, setCachedProfileLocation]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get("square") === "connected") {
      setSquareNotice("Square connection completed.");
      setStatusVersion((value) => value + 1);
      const next = location.pathname;
      window.history.replaceState(null, "", next);
    }
  }, [location.pathname, location.search]);

  const connectedAt = squareStatus?.connectedAt ?? null;
  const lastSyncAt = squareStatus?.lastSyncAt ?? null;
  const lastPublishCount = squareStatus?.lastPublishCount ?? 0;

  const connectedAtLabel = useMemo(() => {
    if (!connectedAt) return "Not connected";
    const date = new Date(connectedAt);
    return Number.isNaN(date.getTime()) ? connectedAt : date.toLocaleString();
  }, [connectedAt]);

  const lastSyncLabel = useMemo(() => {
    if (!lastSyncAt) return "Not yet synced";
    const date = new Date(lastSyncAt);
    return Number.isNaN(date.getTime()) ? lastSyncAt : date.toLocaleString();
  }, [lastSyncAt]);

  const handleConnectSquare = async () => {
    setSquareError(null);
    setSquareNotice(null);
    setConnectBusy(true);
    try {
      const { url } = await buildSquareAuthorizeUrl();
      window.location.href = url;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to start Square connection.";
      setSquareError(message);
    }
    setConnectBusy(false);
  };

  const handlePreviewSquare = async () => {
    if (!pubkey) return;
    setSquareError(null);
    setSquareNotice(null);
    setPreviewLoading(true);
    try {
      const profileLocation = await resolveProfileLocation(pubkey, relays, cachedProfileLocation);
      if (profileLocation && profileLocation !== cachedProfileLocation) {
        setCachedProfileLocation(profileLocation);
      }
      const effectiveLocation =
        profileLocation ?? squareStatus?.profileLocation ?? cachedProfileLocation ?? null;
      const result = await previewSquareCatalog({
        pubkey,
        profileLocation: effectiveLocation ?? undefined
      });
      if (effectiveLocation && effectiveLocation !== cachedProfileLocation) {
        setCachedProfileLocation(effectiveLocation);
      }
      setPreviewEvents(result.events);
      setPreviewPendingCount(result.pendingCount);
      setPreviewTotalEvents(result.totalEvents);
      setPreviewDeletionCount(result.deletionCount || 0);
      setPreviewOpen(true);
      setPreviewViewed(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to preview catalog.";
      setSquareError(message);
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleResyncSquare = async () => {
    if (!pubkey) return;
    setSquareError(null);
    setSquareNotice(null);
    setResyncBusy(true);
    try {
      const profileLocation = await resolveProfileLocation(pubkey, relays, cachedProfileLocation);
      if (profileLocation && profileLocation !== cachedProfileLocation) {
        setCachedProfileLocation(profileLocation);
      }
      const effectiveLocation =
        profileLocation ?? squareStatus?.profileLocation ?? cachedProfileLocation ?? null;
      const { events } = await publishSquareCatalog({
        pubkey,
        profileLocation: effectiveLocation ?? undefined
      });
      if (effectiveLocation && effectiveLocation !== cachedProfileLocation) {
        setCachedProfileLocation(effectiveLocation);
      }
      if (!events.length) {
        setSquareNotice("Square catalog is already up to date.");
        setStatusVersion((value) => value + 1);
        setPreviewViewed(false);
        setPreviewEvents(null);
        return;
      }

      // Separate deletion events (kind 5) from regular events (kind 30402 products and kind 30405 collections)
      const deletionEvents = events.filter((e) => e.kind === 5);
      const updateEvents = events.filter((e) => e.kind === 30402 || e.kind === 30405);

      const updateSuccesses: string[] = [];
      const updateFailures: string[] = [];
      const deletionSuccesses: string[] = [];
      const deletionFailures: string[] = [];

      // Handle deletion events
      for (const template of deletionEvents) {
        try {
          const signed = await signEvent(template);
          validateEvent(signed);
          await publishToRelays(signed, relays);
          deletionSuccesses.push(signed.id);
        } catch (error) {
          console.error("Failed to publish deletion event", error);
          // For deletion events, we can't use d-tag, so use event ID from e tags
          const eventIds = template.tags.filter((tag) => tag[0] === "e").map((tag) => tag[1]);
          if (eventIds.length > 0) {
            deletionFailures.push(eventIds[0]);
          } else {
            deletionFailures.push("unknown");
          }
        }
      }

      // Handle update/create events
      for (const template of updateEvents) {
        try {
          const dTag = template.tags.find((tag) => tag[0] === "d")?.[1];
          const isCollection = template.kind === 30405;
          console.log(`Publishing ${isCollection ? "collection" : "product"} event`, { 
            kind: template.kind, 
            dTag 
          });
          
          const signed = await signEvent(template);
          validateEvent(signed);
          console.log(`Event signed and validated`, { 
            kind: signed.kind, 
            id: signed.id.substring(0, 16) + "...",
            dTag 
          });
          
          await publishToRelays(signed, relays);
          console.log(`Event published successfully`, { 
            kind: signed.kind, 
            id: signed.id.substring(0, 16) + "...",
            dTag 
          });
          updateSuccesses.push(signed.id);
        } catch (error) {
          const dTag = template.tags.find((tag) => tag[0] === "d")?.[1];
          const isCollection = template.kind === 30405;
          console.error(`Failed to publish ${isCollection ? "collection" : "product"} event`, { 
            kind: template.kind, 
            dTag, 
            error: error instanceof Error ? error.message : String(error) 
          });
          if (dTag) {
            updateFailures.push(dTag);
          }
        }
      }

      // Build success/failure messages
      const messages: string[] = [];
      if (updateSuccesses.length > 0) {
        messages.push(
          `Published ${updateSuccesses.length} listing${updateSuccesses.length === 1 ? "" : "s"} to your relays.`
        );
      }
      if (deletionSuccesses.length > 0) {
        messages.push(
          `Deleted ${deletionSuccesses.length} listing${deletionSuccesses.length === 1 ? "" : "s"} from your relays.`
        );
      }
      if (messages.length > 0) {
        setSquareNotice(messages.join(" "));
        setStatusVersion((value) => value + 1);
        setPreviewViewed(false);
        setPreviewEvents(null);
      }

      const errorMessages: string[] = [];
      if (updateFailures.length > 0) {
        errorMessages.push(
          `Failed to publish ${updateFailures.length} listing${updateFailures.length === 1 ? "" : "s"}. Try again shortly.`
        );
      }
      if (deletionFailures.length > 0) {
        errorMessages.push(
          `Failed to delete ${deletionFailures.length} listing${deletionFailures.length === 1 ? "" : "s"}. Try again shortly.`
        );
      }
      if (errorMessages.length > 0) {
        setSquareError(errorMessages.join(" "));
      }

      if (!updateSuccesses.length && !deletionSuccesses.length && !updateFailures.length && !deletionFailures.length) {
        setSquareNotice("No listings required publishing.");
        setStatusVersion((value) => value + 1);
        setPreviewViewed(false);
        setPreviewEvents(null);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to publish catalog to Nostr.";
      setSquareError(message);
    } finally {
      setResyncBusy(false);
    }
  };

  const squareLocationsLabel = useMemo(() => {
    const locations = squareStatus?.locations ?? [];
    if (!locations.length) return "No locations on record";
    if (locations.length <= 2) {
      return locations.map((location) => location.name).join(", ");
    }
    const [first, second] = locations;
    return `${first.name}, ${second.name} + ${locations.length - 2} more`;
  }, [squareStatus?.locations]);

  const scopesLabel = useMemo(() => {
    const scopes = squareStatus?.scopes ?? [];
    return scopes.length ? scopes.join(", ") : "ITEMS_READ, MERCHANT_PROFILE_READ";
  }, [squareStatus?.scopes]);

  const handleCopy = async (value: string | null | undefined) => {
    if (!value) return;
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleAddRelay = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = newRelay.trim();
    if (!trimmed) return;
    addRelay(trimmed);
    setNewRelay("");
  };

  return (
    <div className="container space-y-8 py-10">
      <section className="space-y-4 rounded-lg border bg-card p-6">
        <header className="flex items-center gap-3">
          <KeyRound className="h-5 w-5 text-muted-foreground" />
          <div>
            <h2 className="text-lg font-semibold">Identity</h2>
            <p className="text-sm text-muted-foreground">Back up your merchant keys to maintain access across devices and prevent loss if browser data is cleared.</p>
          </div>
        </header>

        <div className="grid gap-3 text-sm">
          <div>
            <span className="text-xs uppercase text-muted-foreground">npub</span>
            <p className="font-mono break-all">{npub ?? "Loading…"}</p>
            <Button variant="link" className="px-0" onClick={() => handleCopy(npub)}>
              <Copy className="mr-2 h-3.5 w-3.5" />
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap gap-3">
          <Button onClick={handleReveal} disabled={busy}>
            <KeyRound className="mr-2 h-4 w-4" /> Backup Merchant Key
          </Button>
        </div>
      </section>

      <section className="space-y-4 rounded-lg border bg-card p-6">
        <header className="flex items-center gap-3">
          <Store className="h-5 w-5 text-muted-foreground" />
          <div>
            <h2 className="text-lg font-semibold">Square Integration</h2>
            <p className="text-sm text-muted-foreground">Connect your Square account to sync catalog items and make them visible to AI assistants.</p>
          </div>
        </header>

        {squareError ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            {squareError}
          </div>
        ) : null}

        {squareNotice ? (
          <div className="rounded-md border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm text-emerald-600">
            {squareNotice}
          </div>
        ) : null}

        <div className="grid gap-6 md:grid-cols-2">
          <div className="grid gap-4 text-sm">
            {squareLoading ? (
              <div className="flex items-center gap-2 text-muted-foreground">
                <div className="h-4 w-4 animate-spin rounded-full border border-primary border-t-transparent" />
                <span>Checking Square connection…</span>
              </div>
            ) : squareStatus?.connected ? (
              <dl className="grid gap-3">
                <div>
                  <dt className="text-xs uppercase text-muted-foreground">Status</dt>
                  <dd className="font-medium text-emerald-600">Connected</dd>
                </div>
                <div>
                  <dt className="text-xs uppercase text-muted-foreground">Merchant</dt>
                  <dd className="font-medium">
                    {squareStatus.merchantName || squareStatus.merchantId || "Square merchant"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs uppercase text-muted-foreground">Locations</dt>
                  <dd className="font-mono text-xs text-muted-foreground">{squareLocationsLabel}</dd>
                </div>
                <div>
                  <dt className="text-xs uppercase text-muted-foreground">Scopes</dt>
                  <dd className="font-mono text-xs text-muted-foreground">{scopesLabel}</dd>
                </div>
                <div>
                  <dt className="text-xs uppercase text-muted-foreground">Connected</dt>
                  <dd>{connectedAtLabel}</dd>
                </div>
                <div>
                  <dt className="text-xs uppercase text-muted-foreground">Last sync</dt>
                  <dd>{lastSyncLabel}</dd>
                </div>
                <div>
                  <dt className="text-xs uppercase text-muted-foreground">Listings prepared</dt>
                  <dd>{lastPublishCount}</dd>
                </div>
              </dl>
            ) : (
              <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                <p className="font-medium text-foreground">Square is not connected.</p>
                <p className="mt-1">
                  Connect your Square seller account to read your catalog and publish NIP-99 classified listings to your Nostr relays.
                </p>
              </div>
            )}
          </div>

          <div className="rounded-md border bg-muted/30 p-4 text-sm">
            <h3 className="mb-3 font-medium text-foreground">Public Information</h3>
            <p className="mb-3 text-muted-foreground">
              The following information is extracted from your Square catalog and made public to AI assistants:
            </p>
            <ul className="space-y-1.5 text-muted-foreground">
              <li className="flex items-start gap-2">
                <span className="mt-0.5">•</span>
                <span>Title</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-0.5">•</span>
                <span>Description</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-0.5">•</span>
                <span>Location</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-0.5">•</span>
                <span>Picture (if available)</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-0.5">•</span>
                <span>Price</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-0.5">•</span>
                <span>Categories</span>
              </li>
            </ul>
          </div>
        </div>

        <div className="flex flex-wrap gap-3">
          {squareStatus?.connected ? (
            <>
              <Button
                onClick={handlePreviewSquare}
                disabled={previewLoading || squareLoading}
                variant="outline"
              >
                {previewLoading ? "Loading Preview…" : "Preview Publication"}
              </Button>
              <Button
                onClick={() => setPublishConfirmOpen(true)}
                disabled={resyncBusy || squareLoading || !previewViewed}
              >
                {resyncBusy ? "Publishing…" : "Publish Latest Catalog"}
              </Button>
              <Button variant="ghost" onClick={handleConnectSquare} disabled={connectBusy}>
                {connectBusy ? "Opening Square…" : "Reconnect Square"}
              </Button>
            </>
          ) : (
            <Button onClick={handleConnectSquare} disabled={connectBusy || squareLoading}>
              {connectBusy ? "Opening Square…" : "Connect Square"}
            </Button>
          )}
        </div>
        {squareStatus?.connected && !previewViewed && (
          <p className="text-sm text-muted-foreground">
            Please preview your publication before publishing.
          </p>
        )}

        <PublicationPreview
          open={previewOpen}
          onOpenChange={setPreviewOpen}
          events={previewEvents || []}
          pendingCount={previewPendingCount}
          totalEvents={previewTotalEvents}
          deletionCount={previewDeletionCount}
        />

        <Dialog open={publishConfirmOpen} onOpenChange={setPublishConfirmOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Publish Catalog</DialogTitle>
              <DialogDescription>
                This action will make your product catalog visible to AI assistants. This step can NOT be undone.
                {previewViewed && previewPendingCount > 0 && (
                  <span className="block mt-2">
                    {previewDeletionCount > 0 ? (
                      <>
                        You are about to {previewPendingCount - previewDeletionCount > 0 ? "publish" : ""}
                        {previewPendingCount - previewDeletionCount > 0 && previewDeletionCount > 0 ? " and " : ""}
                        {previewDeletionCount > 0 ? "delete" : ""} {previewPendingCount} listing{previewPendingCount === 1 ? "" : "s"}
                        {previewDeletionCount > 0 && previewPendingCount - previewDeletionCount > 0 ? (
                          <> ({previewPendingCount - previewDeletionCount} to publish, {previewDeletionCount} to delete)</>
                        ) : previewDeletionCount > 0 ? (
                          <> ({previewDeletionCount} to delete)</>
                        ) : null}
                        .
                      </>
                    ) : (
                      <>You are about to publish {previewPendingCount} listing{previewPendingCount === 1 ? "" : "s"}.</>
                    )}
                  </span>
                )}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setPublishConfirmOpen(false)}
                disabled={resyncBusy}
              >
                Cancel
              </Button>
              <Button
                onClick={async () => {
                  setPublishConfirmOpen(false);
                  await handleResyncSquare();
                }}
                disabled={resyncBusy}
              >
                OK
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </section>

      <section className="space-y-4 rounded-lg border bg-card p-6">
        <button
          type="button"
          onClick={() => setAdvancedSettingsOpen(!advancedSettingsOpen)}
          className="flex w-full items-center justify-between gap-3 text-left"
        >
          <div className="flex items-center gap-3">
            <RadioTower className="h-5 w-5 text-muted-foreground" />
            <div>
              <h2 className="text-lg font-semibold">Advanced Settings</h2>
            </div>
          </div>
          {advancedSettingsOpen ? (
            <ChevronUp className="h-5 w-5 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-5 w-5 text-muted-foreground" />
          )}
        </button>

        {advancedSettingsOpen && (
          <div className="space-y-4 pt-2">
            <div>
              <h3 className="mb-1 text-base font-semibold">Relays</h3>
              <p className="text-sm text-muted-foreground">Configure the relays where your information is published.</p>
            </div>

            <ul className="grid gap-2 text-sm">
              {relays.map((relay) => (
                <li key={relay} className="flex items-center justify-between rounded-md border bg-muted/40 px-3 py-2">
                  <span className="font-mono text-xs">{relay}</span>
                  <Button variant="ghost" size="sm" onClick={() => removeRelay(relay)}>
                    Remove
                  </Button>
                </li>
              ))}
            </ul>

            <form onSubmit={handleAddRelay} className="flex flex-wrap gap-2">
              <Input
                value={newRelay}
                onChange={(event) => setNewRelay(event.target.value)}
                placeholder="wss://relay.example.com"
                className="max-w-sm"
              />
              <Button type="submit">Add relay</Button>
              <Button type="button" variant="ghost" onClick={resetRelays}>
                Reset defaults
              </Button>
            </form>
          </div>
        )}
      </section>

      <KeyBackupDrawer open={drawerOpen} onOpenChange={setDrawerOpen} nsec={drawerSecret} />
    </div>
  );
}
