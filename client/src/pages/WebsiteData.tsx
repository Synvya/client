import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useWebsiteData } from "@/state/useWebsiteData";
import { useAuth } from "@/state/useAuth";
import { useRelays } from "@/state/useRelays";
import { getPool } from "@/lib/relayPool";
import { parseKind0ProfileEvent } from "@/components/BusinessProfileForm";
import type { BusinessProfile } from "@/types/profile";
import type { SquareEventTemplate } from "@/services/square";
import { Copy, Download, Code, RefreshCw, AlertCircle } from "lucide-react";
import { mapBusinessTypeToEstablishmentSlug } from "@/lib/siteExport/typeMapping";
import { slugify } from "@/lib/siteExport/slug";
import { buildStaticSiteFiles } from "@/lib/siteExport/buildSite";
import { buildZipBlob, triggerBrowserDownload } from "@/lib/siteExport/zip";

export function WebsiteDataPage(): JSX.Element {
  const schema = useWebsiteData((state) => state.schema);
  const lastUpdated = useWebsiteData((state) => state.lastUpdated);
  const updateWebsiteSchema = useWebsiteData((state) => state.updateSchema);
  const clearSchema = useWebsiteData((state) => state.clearSchema);
  const pubkey = useAuth((state) => state.pubkey);
  const relays = useRelays((state) => state.relays);
  const [copied, setCopied] = useState(false);
  const [downloadStatus, setDownloadStatus] = useState<"idle" | "success">("idle");
  const [refreshing, setRefreshing] = useState(false);
  const [lastProfile, setLastProfile] = useState<BusinessProfile | null>(null);
  const [lastMenuEvents, setLastMenuEvents] = useState<SquareEventTemplate[] | null>(null);
  const [lastGeohash, setLastGeohash] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  // Reset copied state after 2 seconds
  useEffect(() => {
    if (copied) {
      const timer = setTimeout(() => setCopied(false), 2000);
      return () => clearTimeout(timer);
    }
  }, [copied]);

  // Reset download status after 2 seconds
  useEffect(() => {
    if (downloadStatus === "success") {
      const timer = setTimeout(() => setDownloadStatus("idle"), 2000);
      return () => clearTimeout(timer);
    }
  }, [downloadStatus]);

  // Auto-refresh on mount if we have auth and no schema
  useEffect(() => {
    if (pubkey && relays.length && !schema && !refreshing) {
      handleRefresh();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pubkey, relays.length]); // Only run when auth/relays change

  const handleCopy = async () => {
    if (!schema) return;
    try {
      await navigator.clipboard.writeText(schema);
      setCopied(true);
    } catch (error) {
      console.error("Failed to copy to clipboard:", error);
    }
  };

  const handleDownload = () => {
    if (!schema) return;
    try {
      const blob = new Blob([schema], { type: "text/html" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "schema-org-snippet.html";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setDownloadStatus("success");
    } catch (error) {
      console.error("Failed to download:", error);
    }
  };

  const handleRefresh = async () => {
    if (!pubkey || !relays.length) return;
    
    setRefreshing(true);
    try {
      const pool = getPool();
      
      // Fetch profile (kind 0)
      const profileEvent = await pool.get(relays, {
        kinds: [0],
        authors: [pubkey]
      });
      
      if (!profileEvent) {
        // No profile published yet
        clearSchema();
        return;
      }
      
      // Parse profile using the same logic as BusinessProfileForm
      const { patch } = parseKind0ProfileEvent(profileEvent);
      const profile: BusinessProfile = {
        name: patch.name || "",
        displayName: patch.displayName || patch.name || "",
        about: patch.about || "",
        website: patch.website || "",
        nip05: patch.nip05 || "",
        picture: patch.picture || "",
        banner: patch.banner || "",
        businessType: patch.businessType || ("restaurant" as const),
        categories: patch.categories || [],
        phone: patch.phone,
        email: patch.email,
        street: patch.street,
        city: patch.city,
        state: patch.state,
        zip: patch.zip,
        country: patch.country,
        cuisine: patch.cuisine,
        openingHours: patch.openingHours,
        acceptsReservations: patch.acceptsReservations
      };
      
      // Extract geohash from profile event tags
      const geohashTag = profileEvent.tags.find((t: string[]) => t[0] === "g")?.[1];
      setLastGeohash(geohashTag || null);
      
      // Fetch menu events (kinds 30402 and 30405)
      // Query for both product and collection events at once
      const allMenuEvents = await pool.querySync(relays, {
        kinds: [30402, 30405],
        authors: [pubkey]
      });
      
      // Deduplicate events (filter invalid format, then by d-tag, then by name)
      const { deduplicateEvents } = await import("@/lib/nostrEventProcessing");
      const menuEvents = deduplicateEvents(allMenuEvents, pubkey);
      setLastMenuEvents(menuEvents.length > 0 ? menuEvents : null);
      setLastProfile(profile);
      
      // Generate and store schema
      updateWebsiteSchema(
        profile,
        menuEvents.length > 0 ? menuEvents : null,
        geohashTag || null,
        pubkey
      );
    } catch (error) {
      console.error("Failed to refresh website data:", error);
      // Could show error toast here in the future
    } finally {
      setRefreshing(false);
    }
  };

  const handleDownloadWebsiteZip = async () => {
    if (!pubkey || !lastProfile) return;
    setExporting(true);
    try {
      const typeSlug = mapBusinessTypeToEstablishmentSlug(lastProfile.businessType);
      const nameSlug = slugify(lastProfile.name || lastProfile.displayName || "business");

      const { files } = buildStaticSiteFiles({
        profile: lastProfile,
        geohash: lastGeohash,
        menuEvents: lastMenuEvents,
        merchantPubkey: pubkey,
        typeSlug,
        nameSlug,
      });

      const zipBlob = await buildZipBlob(files);
      triggerBrowserDownload(zipBlob, `${typeSlug}-${nameSlug}-synvya-site.zip`);
    } catch (error) {
      console.error("Failed to export website zip:", error);
    } finally {
      setExporting(false);
    }
  };

  const formatLastUpdated = (date: Date | null): string => {
    if (!date) return "Never";
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return "Just now";
    if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
    if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
    if (days < 7) return `${days} day${days === 1 ? "" : "s"} ago`;
    
    return date.toLocaleDateString();
  };

  if (!pubkey) {
    return (
      <div className="container py-10">
        <div className="mx-auto max-w-4xl space-y-8">
          <div className="rounded-lg border bg-card p-6 shadow-sm">
            <div className="flex items-center gap-3 text-muted-foreground">
              <AlertCircle className="h-5 w-5" />
              <p>Please complete onboarding to access website data.</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="container py-10">
      <div className="mx-auto max-w-4xl space-y-8">
        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Website</h1>
            <p className="mt-2 text-muted-foreground">
              Refresh pulls your latest profile + menu published data to update the schema snippet and Synvya website files zip.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              onClick={handleRefresh}
              disabled={refreshing || !pubkey || !relays.length}
              className="shrink-0"
            >
              <RefreshCw className={`mr-2 h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
              {refreshing ? "Refreshing..." : "Refresh"}
            </Button>
          </div>
        </div>

        {/* Explanation Card */}
        <div className="rounded-lg border bg-card p-6 shadow-sm">
          <div className="flex items-start gap-3">
            <Code className="mt-1 h-5 w-5 flex-shrink-0 text-primary" />
            <div className="space-y-2">
              <h2 className="text-lg font-semibold">What is this?</h2>
              <p className="text-sm text-muted-foreground">
                This page generates two outputs from your latest published profile and menu data:
              </p>
              <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                <li>
                  <strong>Schema Data</strong>: JSON-LD you can paste into your own website’s <code className="rounded bg-muted px-1 py-0.5">&lt;head&gt;</code>.
                </li>
                <li>
                  <strong>Synvya Website Files</strong>: a zip of static pages we can deploy under synvya.com.
                </li>
              </ul>
            </div>
          </div>
        </div>

        {/* Outputs */}
        {schema ? (
          <div className="space-y-8">
            {/* Status Bar */}
            <div className="flex items-center justify-between rounded-lg border bg-muted/30 px-4 py-3">
              <div className="flex items-center gap-2 text-sm">
                <div className="h-2 w-2 rounded-full bg-green-500"></div>
                <span className="font-medium">Last updated:</span>
                <span className="text-muted-foreground">{formatLastUpdated(lastUpdated)}</span>
              </div>
            </div>

            {/* Schema Data */}
            <div className="space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-xl font-semibold">Schema Data</h2>
                  <p className="text-sm text-muted-foreground">
                    Copy/paste this into your own website’s <code className="rounded bg-muted px-1 py-0.5">&lt;head&gt;</code>.
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={handleDownload} disabled={downloadStatus === "success"}>
                    <Download className="mr-2 h-4 w-4" />
                    {downloadStatus === "success" ? "Downloaded!" : "Download"}
                  </Button>
                  <Button variant="default" size="sm" onClick={handleCopy} disabled={copied}>
                    <Copy className="mr-2 h-4 w-4" />
                    {copied ? "Copied!" : "Copy"}
                  </Button>
                </div>
              </div>
              <div className="rounded-lg border bg-card shadow-sm">
                <Textarea
                  value={schema}
                  readOnly
                  className="min-h-[420px] resize-none rounded-lg border-0 font-mono text-xs leading-relaxed shadow-none focus-visible:ring-0"
                  style={{
                    fontFamily: "'Fira Code', 'Consolas', 'Monaco', monospace"
                  }}
                />
              </div>
              <div className="rounded-lg border bg-card p-6 shadow-sm">
                <h3 className="mb-3 font-semibold">How to use this code</h3>
                <ol className="space-y-2 text-sm text-muted-foreground">
                  <li className="flex gap-2">
                    <span className="font-semibold text-foreground">1.</span>
                    <span>Copy the code above by clicking the "Copy" button</span>
                  </li>
                  <li className="flex gap-2">
                    <span className="font-semibold text-foreground">2.</span>
                    <span>
                      Open your website's HTML file (usually{" "}
                      <code className="rounded bg-muted px-1 py-0.5">index.html</code>)
                    </span>
                  </li>
                  <li className="flex gap-2">
                    <span className="font-semibold text-foreground">3.</span>
                    <span>
                      Paste the code inside the{" "}
                      <code className="rounded bg-muted px-1 py-0.5">&lt;head&gt;</code> section, before the closing{" "}
                      <code className="rounded bg-muted px-1 py-0.5">&lt;/head&gt;</code> tag
                    </span>
                  </li>
                  <li className="flex gap-2">
                    <span className="font-semibold text-foreground">4.</span>
                    <span>Save and deploy your website</span>
                  </li>
                  <li className="flex gap-2">
                    <span className="font-semibold text-foreground">5.</span>
                    <span>
                      Verify it's working using{" "}
                      <a
                        href="https://search.google.com/test/rich-results"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary underline-offset-4 hover:underline"
                      >
                        Google's Rich Results Test
                      </a>
                    </span>
                  </li>
                </ol>
              </div>
            </div>

            {/* Synvya Website Files */}
            <div className="space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-xl font-semibold">Synvya Website Files</h2>
                  <p className="text-sm text-muted-foreground">
                    Download a zip of static HTML pages (index/menu/item) with embedded schema.
                  </p>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handleDownloadWebsiteZip}
                  disabled={exporting || !lastProfile}
                >
                  {exporting ? "Building zip…" : "Download Website Zip"}
                </Button>
              </div>
              {lastProfile ? (
                <div className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">
                  Deployment path will be based on your business type + name slug (e.g.{" "}
                  <code className="rounded bg-muted px-1 py-0.5">restaurant/elcandado/</code>).
                </div>
              ) : null}
            </div>
          </div>
        ) : (
          /* Empty State */
          <div className="rounded-lg border bg-card p-12 text-center shadow-sm">
            <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-muted">
              <Code className="h-10 w-10 text-muted-foreground" />
            </div>
            <h3 className="mt-6 text-lg font-semibold">No data available yet</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              Publish your business profile and menu, then click "Refresh" to generate structured data for your website.
            </p>
            <div className="mt-6 flex gap-3 justify-center">
              <Button
                onClick={handleRefresh}
                disabled={refreshing || !pubkey || !relays.length}
              >
                <RefreshCw className={`mr-2 h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
                {refreshing ? "Refreshing..." : "Refresh from Nostr"}
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  window.location.href = "/app/profile";
                }}
              >
                Go to Profile
              </Button>
            </div>
          </div>
        )}

        {/* Additional Resources */}
        <div className="rounded-lg border bg-card p-6 shadow-sm">
          <h3 className="mb-3 font-semibold">Additional Resources</h3>
          <ul className="space-y-2 text-sm text-muted-foreground">
            <li>
              <a
                href="https://schema.org/Restaurant"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary underline-offset-4 hover:underline"
              >
                Schema.org Restaurant Documentation
              </a>
            </li>
            <li>
              <a
                href="https://developers.google.com/search/docs/appearance/structured-data/intro-structured-data"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary underline-offset-4 hover:underline"
              >
                Google Structured Data Guide
              </a>
            </li>
            <li>
              <a
                href="https://search.google.com/test/rich-results"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary underline-offset-4 hover:underline"
              >
                Test Your Structured Data
              </a>
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}

