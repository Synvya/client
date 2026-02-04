import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { PublicationPreview } from "@/components/PublicationPreview";
import { Store } from "lucide-react";
import { buildSquareAuthorizeUrl } from "@/lib/square/auth";
import {
  fetchSquareStatus,
  publishSquareCatalog,
  previewSquareCatalog,
  clearSquareCache,
  type SquareConnectionStatus,
  type SquareEventTemplate,
} from "@/services/square";
import { publishToRelays, getPool } from "@/lib/relayPool";
import { validateEvent } from "@/validation/nostrValidation";
import { resolveProfileLocation } from "@/lib/profileLocation";
import { useBusinessProfile } from "@/state/useBusinessProfile";
import { useAuth } from "@/state/useAuth";
import { useRelays } from "@/state/useRelays";
import { buildDeletionEventByAddress } from "@/lib/handlerEvents";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import sampleSpreadsheetUrl from "@/assets/Sample Menu Importer.xlsx?url";
import { buildSpreadsheetPreviewEvents, parseMenuSpreadsheetXlsx } from "@/lib/spreadsheet/menuSpreadsheet";

export function MenuPage(): JSX.Element {
  const pubkey = useAuth((state) => state.pubkey);
  const signEvent = useAuth((state) => state.signEvent);
  const relays = useRelays((state) => state.relays);
  const { location: cachedProfileLocation, setLocation: setCachedProfileLocation } = useBusinessProfile((state) => ({
    location: state.location,
    setLocation: state.setLocation,
  }));

  const location = useLocation();
  const [squareStatus, setSquareStatus] = useState<SquareConnectionStatus | null>(null);
  const [squareLoading, setSquareLoading] = useState(false);
  const [squareError, setSquareError] = useState<string | null>(null);
  const [squareNotice, setSquareNotice] = useState<string | null>(null);
  const [statusVersion, setStatusVersion] = useState(0);
  const [connectBusy, setConnectBusy] = useState(false);
  const [resyncBusy, setResyncBusy] = useState(false);
  const [publishConfirmOpen, setPublishConfirmOpen] = useState(false);
  const [previewViewed, setPreviewViewed] = useState(false);
  const [previewEvents, setPreviewEvents] = useState<SquareEventTemplate[] | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewPendingCount, setPreviewPendingCount] = useState(0);
  const [previewTotalEvents, setPreviewTotalEvents] = useState(0);
  const [previewDeletionCount, setPreviewDeletionCount] = useState(0);
  const [unpublishBusy, setUnpublishBusy] = useState(false);

  const [activeSource, setActiveSource] = useState<"square" | "spreadsheet" | null>(null);

  const [sheetError, setSheetError] = useState<string | null>(null);
  const [sheetNotice, setSheetNotice] = useState<string | null>(null);
  const [sheetFileName, setSheetFileName] = useState<string | null>(null);
  const [sheetParsed, setSheetParsed] = useState<{ menus: any[]; items: any[] } | null>(null);
  const [sheetPreviewViewed, setSheetPreviewViewed] = useState(false);
  const [sheetPreviewEvents, setSheetPreviewEvents] = useState<SquareEventTemplate[] | null>(null);
  const [sheetPreviewLoading, setSheetPreviewLoading] = useState(false);
  const [sheetPublishBusy, setSheetPublishBusy] = useState(false);

  useEffect(() => {
    if (!pubkey) {
      setSquareStatus(null);
      setPreviewViewed(false);
      setPreviewEvents(null);
      setActiveSource(null);
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
          if (activeSource === "square") {
            setActiveSource(null);
          }
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
        if (activeSource === "square") {
          setActiveSource(null);
        }
      })
      .finally(() => {
        setSquareLoading(false);
      });
  }, [pubkey, statusVersion, setCachedProfileLocation, activeSource]);

  useEffect(() => {
    if (!pubkey || cachedProfileLocation) {
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const resolved = await resolveProfileLocation(pubkey, relays, null);
        if (!cancelled && resolved) {
          setCachedProfileLocation(resolved);
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

  const squareLocationsLabel = useMemo(() => {
    const locations = squareStatus?.locations ?? [];
    if (!locations.length) return "No locations on record";
    if (locations.length <= 2) {
      return locations.map((loc) => loc.name).join(", ");
    }
    const [first, second] = locations;
    return `${first.name}, ${second.name} + ${locations.length - 2} more`;
  }, [squareStatus?.locations]);

  const scopesLabel = useMemo(() => {
    const scopes = squareStatus?.scopes ?? [];
    return scopes.length ? scopes.join(", ") : "ITEMS_READ, MERCHANT_PROFILE_READ";
  }, [squareStatus?.scopes]);

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
        profileLocation: effectiveLocation ?? undefined,
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
      setActiveSource("square");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to preview catalog.";
      setSquareError(message);
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleSpreadsheetUpload = async (file: File) => {
    if (!pubkey) return;
    setSheetError(null);
    setSheetNotice(null);
    setSheetPreviewViewed(false);
    setSheetPreviewEvents(null);
    setSheetFileName(file.name);
    try {
      const parsed = await parseMenuSpreadsheetXlsx(file);
      setSheetParsed(parsed);
      setSheetNotice(`Loaded spreadsheet: ${file.name}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to parse spreadsheet.";
      setSheetError(message);
      setSheetParsed(null);
    }
  };

  const handlePreviewSpreadsheet = async () => {
    if (!pubkey) return;
    if (!sheetParsed) {
      setSheetError("Please upload a spreadsheet first.");
      return;
    }
    setSheetError(null);
    setSheetNotice(null);
    setSheetPreviewLoading(true);
    try {
      const events = buildSpreadsheetPreviewEvents({
        merchantPubkey: pubkey,
        menus: sheetParsed.menus,
        items: sheetParsed.items,
      });
      setSheetPreviewEvents(events);
      setPreviewEvents(events);
      setPreviewPendingCount(events.length);
      setPreviewTotalEvents(events.length);
      setPreviewDeletionCount(0);
      setPreviewOpen(true);
      setSheetPreviewViewed(true);
      setPreviewViewed(true);
      setActiveSource("spreadsheet");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to build preview events from spreadsheet.";
      setSheetError(message);
    } finally {
      setSheetPreviewLoading(false);
    }
  };

  const handlePublishSpreadsheet = async () => {
    if (!pubkey) return;
    if (!sheetPreviewEvents || sheetPreviewEvents.length === 0) {
      setSheetError("No preview events. Please preview before publishing.");
      return;
    }
    setSheetError(null);
    setSheetNotice(null);
    setSheetPublishBusy(true);
    try {
      const publishedIds: string[] = [];
      // Publish products first, then collections (safer for references)
      const ordered = [
        ...sheetPreviewEvents.filter((e) => e.kind === 30402),
        ...sheetPreviewEvents.filter((e) => e.kind === 30405),
      ];
      for (const template of ordered) {
        const signed = await signEvent(template as any);
        validateEvent(signed);
        await publishToRelays(signed, relays);
        publishedIds.push(signed.id);
      }
      setSheetNotice(`Published ${publishedIds.length} event${publishedIds.length === 1 ? "" : "s"} from spreadsheet.`);
      setSheetPreviewViewed(false);
      setPreviewViewed(false);
      setSheetPreviewEvents(null);
      setPreviewEvents(null);
      if (activeSource === "spreadsheet") {
        setActiveSource(null);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to publish spreadsheet menu.";
      setSheetError(message);
    } finally {
      setSheetPublishBusy(false);
    }
  };

  const handleUnpublishMenu = async () => {
    if (!pubkey) return;
    setSquareError(null);
    setSquareNotice(null);
    setUnpublishBusy(true);
    try {
      const pool = getPool();
      const menuEvents = await pool.querySync(relays, {
        kinds: [30402, 30405],
        authors: [pubkey],
      });

      if (menuEvents.length === 0) {
        setSquareNotice("No menu events found to unpublish.");
        return;
      }

      const addresses: string[] = [];
      for (const event of menuEvents) {
        const dTag = event.tags.find((tag) => Array.isArray(tag) && tag[0] === "d")?.[1];
        if (dTag) {
          addresses.push(`${event.kind}:${pubkey}:${dTag}`);
        }
      }

      if (addresses.length === 0) {
        setSquareError("No valid menu events found (missing d tags).");
        return;
      }

      const deletionEvent = buildDeletionEventByAddress(addresses, [30402, 30405], "removing menu");
      const signed = await signEvent(deletionEvent);
      validateEvent(signed);
      await publishToRelays(signed, relays);

      setSquareNotice(`Unpublished ${addresses.length} menu event${addresses.length === 1 ? "" : "s"}.`);
      setStatusVersion((value) => value + 1);
      setPreviewViewed(false);
      setPreviewEvents(null);
      setActiveSource(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to unpublish menu.";
      setSquareError(message);
    } finally {
      setUnpublishBusy(false);
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
        profileLocation: effectiveLocation ?? undefined,
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

      const deletionEvents = events.filter((e) => e.kind === 5);
      const updateEvents = events.filter((e) => e.kind === 30402 || e.kind === 30405);

      const updateSuccesses: string[] = [];
      const updateFailures: string[] = [];
      const deletionSuccesses: string[] = [];
      const deletionFailures: string[] = [];

      for (const template of deletionEvents) {
        try {
          const signed = await signEvent(template as any);
          validateEvent(signed);
          await publishToRelays(signed, relays);
          deletionSuccesses.push(signed.id);
        } catch (error) {
          console.error("Failed to publish deletion event", error);
          const eventIds = template.tags.filter((tag) => tag[0] === "e").map((tag) => tag[1]);
          deletionFailures.push(eventIds.length > 0 ? eventIds[0] : "unknown");
        }
      }

      for (const template of updateEvents) {
        try {
          const signed = await signEvent(template as any);
          validateEvent(signed);
          await publishToRelays(signed, relays);
          updateSuccesses.push(signed.id);
        } catch (error) {
          const dTag = template.tags.find((tag) => tag[0] === "d")?.[1];
          if (dTag) updateFailures.push(dTag);
          console.error("Failed to publish listing event", error);
        }
      }

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

      if (
        !updateSuccesses.length &&
        !deletionSuccesses.length &&
        !updateFailures.length &&
        !deletionFailures.length
      ) {
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

  return (
    <div className="container space-y-8 py-10">
      <section className="space-y-4 rounded-lg border bg-card p-6">
        <header className="flex items-center gap-3">
          <Store className="h-5 w-5 text-muted-foreground" />
          <div>
            <h2 className="text-lg font-semibold">Square Integration</h2>
            <p className="text-sm text-muted-foreground">
              Connect your Square account to retrieve your menu.
            </p>
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
                  <dd className="font-medium">{squareStatus.merchantName || squareStatus.merchantId || "Square merchant"}</dd>
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
                  Connect your Square seller account to read your catalog and publish listings to your Nostr relays.
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
              <Button onClick={handlePreviewSquare} disabled={previewLoading || squareLoading} variant="outline">
                {previewLoading ? "Loading Preview…" : "Preview Menu"}
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
          <p className="text-sm text-muted-foreground">Please preview your publication before publishing.</p>
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
                        {previewDeletionCount > 0 ? "delete" : ""} {previewPendingCount} listing
                        {previewPendingCount === 1 ? "" : "s"}
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
              <Button variant="outline" onClick={() => setPublishConfirmOpen(false)} disabled={resyncBusy}>
                Cancel
              </Button>
              <Button
                onClick={async () => {
                  setPublishConfirmOpen(false);
                  if (activeSource === "square") {
                    await handleResyncSquare();
                    return;
                  }
                  if (activeSource === "spreadsheet") {
                    await handlePublishSpreadsheet();
                    return;
                  }
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
        <header className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Spreadsheet Import</h2>
            <p className="text-sm text-muted-foreground">
              Upload an XLSX file with your menu. Use the template to help you.
            </p>
          </div>
          <a
            href={sampleSpreadsheetUrl}
            download="Sample Menu Importer.xlsx"
            className="text-sm font-medium text-primary underline-offset-4 hover:underline"
          >
            Download template
          </a>
        </header>

        {sheetError ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            {sheetError}
          </div>
        ) : null}

        {sheetNotice ? (
          <div className="rounded-md border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm text-emerald-600">
            {sheetNotice}
          </div>
        ) : null}

        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium">Upload XLSX</label>
          <input
            type="file"
            accept=".xlsx"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleSpreadsheetUpload(f);
            }}
          />
          {sheetFileName ? <div className="text-xs text-muted-foreground">Loaded: {sheetFileName}</div> : null}
        </div>

        <div className="flex flex-wrap gap-3">
          <Button
            onClick={handlePreviewSpreadsheet}
            disabled={sheetPreviewLoading || !sheetParsed}
            variant="outline"
          >
            {sheetPreviewLoading ? "Loading Preview…" : "Preview Menu"}
          </Button>
        </div>

        {!sheetPreviewViewed && (
          <p className="text-sm text-muted-foreground">Please preview your publication before publishing.</p>
        )}
      </section>

      <section className="space-y-3 rounded-lg border bg-card p-6">
        <header>
          <h2 className="text-lg font-semibold">Menu Actions</h2>
          <p className="text-sm text-muted-foreground">
            Preview a menu first (Square or Spreadsheet), then publish.
          </p>
          {activeSource ? (
            <p className="mt-2 text-sm text-muted-foreground">
              Active preview source: <span className="font-medium text-foreground">{activeSource === "square" ? "Square" : "Spreadsheet"}</span>
            </p>
          ) : null}
        </header>

        <div className="flex flex-wrap gap-3">
          <Button
            onClick={() => setPublishConfirmOpen(true)}
            disabled={!previewViewed || !activeSource || (activeSource === "spreadsheet" ? sheetPublishBusy : resyncBusy)}
          >
            {activeSource === "spreadsheet" ? (sheetPublishBusy ? "Publishing…" : "Publish Menu") : resyncBusy ? "Publishing…" : "Publish Menu"}
          </Button>
          <Button onClick={handleUnpublishMenu} disabled={unpublishBusy} variant="destructive">
            {unpublishBusy ? "Unpublishing…" : "Unpublish Menu"}
          </Button>
        </div>
      </section>
    </div>
  );
}


