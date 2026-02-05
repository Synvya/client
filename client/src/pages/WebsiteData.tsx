import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { CollapsibleSection } from "@/components/ui/collapsible-section";
import { useWebsiteData } from "@/state/useWebsiteData";
import { useAuth } from "@/state/useAuth";
import { useRelays } from "@/state/useRelays";
import { useOnboardingProgress } from "@/state/useOnboardingProgress";
import { getPool } from "@/lib/relayPool";
import { parseKind0ProfileEvent } from "@/components/BusinessProfileForm";
import type { BusinessProfile } from "@/types/profile";
import type { SquareEventTemplate } from "@/services/square";
import { Copy, Download, RefreshCw, AlertCircle, Sparkles, ExternalLink, HelpCircle, Globe, Check, Share2 } from "lucide-react";
import { mapBusinessTypeToEstablishmentSlug } from "@/lib/siteExport/typeMapping";
import { slugify } from "@/lib/siteExport/slug";
import { buildStaticSiteFiles } from "@/lib/siteExport/buildSite";
import { publishDiscoveryPage } from "@/services/discovery";

export function WebsiteDataPage(): JSX.Element {
  const schema = useWebsiteData((state) => state.schema);
  const lastUpdated = useWebsiteData((state) => state.lastUpdated);
  const updateWebsiteSchema = useWebsiteData((state) => state.updateSchema);
  const clearSchema = useWebsiteData((state) => state.clearSchema);
  const pubkey = useAuth((state) => state.pubkey);
  const relays = useRelays((state) => state.relays);
  const setDiscoveryPublished = useOnboardingProgress((state) => state.setDiscoveryPublished);
  const [copied, setCopied] = useState(false);
  const [urlCopied, setUrlCopied] = useState(false);
  const [downloadStatus, setDownloadStatus] = useState<"idle" | "success">("idle");
  const [refreshing, setRefreshing] = useState(false);
  const [lastProfile, setLastProfile] = useState<BusinessProfile | null>(null);
  const [lastMenuEvents, setLastMenuEvents] = useState<SquareEventTemplate[] | null>(null);
  const [lastGeohash, setLastGeohash] = useState<string | null>(null);
  const [lastProfileTags, setLastProfileTags] = useState<string[][] | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [publishedUrl, setPublishedUrl] = useState<string | null>(null);
  const [publishError, setPublishError] = useState<string | null>(null);

  // Reset copied state after 2 seconds
  useEffect(() => {
    if (copied) {
      const timer = setTimeout(() => setCopied(false), 2000);
      return () => clearTimeout(timer);
    }
  }, [copied]);

  // Reset URL copied state after 2 seconds
  useEffect(() => {
    if (urlCopied) {
      const timer = setTimeout(() => setUrlCopied(false), 2000);
      return () => clearTimeout(timer);
    }
  }, [urlCopied]);

  // Reset download status after 2 seconds
  useEffect(() => {
    if (downloadStatus === "success") {
      const timer = setTimeout(() => setDownloadStatus("idle"), 2000);
      return () => clearTimeout(timer);
    }
  }, [downloadStatus]);

  // Auto-refresh on mount to always show latest data
  useEffect(() => {
    if (pubkey && relays.length && !refreshing) {
      handleRefresh();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only run once on mount

  const handleCopy = async () => {
    if (!schema) return;
    try {
      await navigator.clipboard.writeText(schema);
      setCopied(true);
    } catch (error) {
      console.error("Failed to copy to clipboard:", error);
    }
  };

  const handleCopyUrl = async () => {
    if (!publishedUrl) return;
    try {
      await navigator.clipboard.writeText(publishedUrl);
      setUrlCopied(true);
    } catch (error) {
      console.error("Failed to copy URL to clipboard:", error);
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
      setLastProfileTags((profileEvent.tags as string[][]) || null);
      
      // Fetch menu events (kinds 30402 and 30405)
      // Query for both product and collection events at once
      const allMenuEvents = await pool.querySync(relays, {
        kinds: [30402, 30405],
        authors: [pubkey]
      });

      // Debug visibility into what we fetched (helps diagnose relay/query issues)
      console.log("[Website] menu fetch", {
        relayCount: relays.length,
        relays,
        fetchedCount: allMenuEvents.length,
        fetchedKinds: allMenuEvents.reduce<Record<string, number>>((acc, evt) => {
          const k = String(evt.kind);
          acc[k] = (acc[k] || 0) + 1;
          return acc;
        }, {}),
      });
      
      // Deduplicate events (filter invalid format, then by d-tag, then by name)
      const { deduplicateEvents } = await import("@/lib/nostrEventProcessing");
      const menuEvents = deduplicateEvents(allMenuEvents, pubkey);

      console.log("[Website] menu dedupe", {
        inputCount: allMenuEvents.length,
        outputCount: menuEvents.length,
        outputKinds: menuEvents.reduce<Record<string, number>>((acc, evt) => {
          const k = String(evt.kind);
          acc[k] = (acc[k] || 0) + 1;
          return acc;
        }, {}),
      });

      // High-signal detail: what actually survived dedupe?
      // Helps diagnose why new menus/items don't appear in schema/zip.
      const summarize = (evt: SquareEventTemplate) => {
        const d = evt.tags.find((t) => Array.isArray(t) && t[0] === "d")?.[1] ?? null;
        const title = evt.tags.find((t) => Array.isArray(t) && t[0] === "title")?.[1] ?? null;
        const a = evt.tags
          .filter((t) => Array.isArray(t) && t[0] === "a" && typeof t[1] === "string")
          .map((t) => t[1] as string);
        return { kind: evt.kind, created_at: evt.created_at, d, title, aCount: a.length, a };
      };
      console.log("[Website] menu dedupe survivors", menuEvents.map(summarize));

      try {
        const { buildMenuSchema } = await import("@/lib/schemaOrg");
        const menus = buildMenuSchema(profile.displayName || profile.name, menuEvents, pubkey, undefined);
        console.log("[Website] buildMenuSchema summary", {
          menuCount: menus.length,
          menuNames: menus.map((m) => m.name),
          topLevelCounts: menus.map((m) => ({
            name: m.name,
            directItems: Array.isArray(m.hasMenuItem) ? m.hasMenuItem.length : 0,
            sections: Array.isArray(m.hasMenuSection) ? m.hasMenuSection.length : 0,
          })),
        });
      } catch (e) {
        console.warn("[Website] buildMenuSchema debug failed", e);
      }

      setLastMenuEvents(menuEvents.length > 0 ? menuEvents : null);
      setLastProfile(profile);
      
      // Generate and store schema
      updateWebsiteSchema(
        profile,
        menuEvents.length > 0 ? menuEvents : null,
        geohashTag || null,
        pubkey,
        profileEvent.tags as string[][]
      );
    } catch (error) {
      console.error("Failed to refresh website data:", error);
      // Could show error toast here in the future
    } finally {
      setRefreshing(false);
    }
  };

  const handlePublish = async () => {
    if (!pubkey || !lastProfile) return;
    setPublishing(true);
    setPublishError(null);
    setPublishedUrl(null);
    try {
      const typeSlug = mapBusinessTypeToEstablishmentSlug(lastProfile.businessType);
      const nameSlug = slugify(lastProfile.name || lastProfile.displayName || "business");

      const { html } = buildStaticSiteFiles({
        profile: lastProfile,
        geohash: lastGeohash,
        menuEvents: lastMenuEvents,
        merchantPubkey: pubkey,
        profileTags: lastProfileTags,
        typeSlug,
        nameSlug,
      });

      const url = await publishDiscoveryPage(typeSlug, nameSlug, html);
      setPublishedUrl(url);
      setDiscoveryPublished(true);
    } catch (error) {
      console.error("Failed to publish discovery page:", error);
      setPublishError(error instanceof Error ? error.message : "Failed to publish discovery page");
    } finally {
      setPublishing(false);
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
      <div className="mx-auto max-w-4xl space-y-6">
        {/* Progress Indicator */}
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs font-medium text-primary-foreground">
            3
          </span>
          <span className="font-medium text-foreground">Step 3 of 3:</span>
          <span>Get Discovered</span>
        </div>

        {/* Header */}
        <div className="space-y-2">
          <h1 className="text-3xl font-bold tracking-tight">Get Discovered</h1>
          <p className="text-lg text-muted-foreground">
            Make your restaurant visible to ChatGPT, Claude, and other AI assistants.
          </p>
        </div>

        {/* Loading State - Show while refreshing on page load */}
        {refreshing && !schema && (
          <div className="flex items-center justify-center gap-3 rounded-lg border bg-card p-8 shadow-sm">
            <RefreshCw className="h-5 w-5 animate-spin text-primary" />
            <span className="text-sm text-muted-foreground">Loading your profile and menu data...</span>
          </div>
        )}

        {/* Success State - Show when published */}
        {publishedUrl && (
          <section className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-6">
            <div className="flex items-start gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-500 text-white">
                <Check className="h-4 w-4" />
              </div>
              <div className="flex-1 space-y-3">
                <div>
                  <p className="font-medium text-emerald-700">Your restaurant is live!</p>
                  <a
                    href={publishedUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm font-medium text-primary hover:underline"
                  >
                    {publishedUrl.replace("https://", "")}
                  </a>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="default"
                    size="sm"
                    onClick={() => window.open(publishedUrl, "_blank")}
                  >
                    <ExternalLink className="mr-2 h-4 w-4" />
                    View Page
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleCopyUrl}
                  >
                    <Share2 className="mr-2 h-4 w-4" />
                    {urlCopied ? "Copied!" : "Share"}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handlePublish}
                    disabled={publishing}
                  >
                    <RefreshCw className={`mr-2 h-4 w-4 ${publishing ? "animate-spin" : ""}`} />
                    {publishing ? "Updating…" : "Update"}
                  </Button>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* Outputs */}
        {schema ? (
          <div className="space-y-6">
            {/* Updating indicator - subtle bar when refreshing with existing data */}
            {refreshing && (
              <div className="flex items-center gap-2 rounded-md bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
                <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                <span>Updating...</span>
              </div>
            )}

            {/* Primary Action: Publish to Synvya.com */}
            {!publishedUrl && (
              <section className="space-y-4 rounded-lg border bg-card p-6 shadow-sm">
                <div className="flex items-start gap-3">
                  <Globe className="mt-1 h-6 w-6 flex-shrink-0 text-primary" />
                  <div className="flex-1">
                    <h2 className="text-xl font-semibold">Publish to Synvya.com</h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      One click to make your restaurant discoverable by AI assistants. Your page includes your profile, menu, and all the structured data AI needs to recommend you.
                    </p>
                  </div>
                </div>

                {publishError && (
                  <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4">
                    <div className="flex items-center gap-2 text-sm text-destructive">
                      <AlertCircle className="h-4 w-4" />
                      <span>{publishError}</span>
                    </div>
                  </div>
                )}

                <Button
                  onClick={handlePublish}
                  disabled={publishing || !lastProfile}
                  size="lg"
                  className="w-full sm:w-auto"
                >
                  <Globe className="mr-2 h-4 w-4" />
                  {publishing ? "Publishing…" : "Publish to Synvya.com"}
                </Button>
              </section>
            )}

            {/* Secondary Action: Add to Your Own Website (Collapsed) */}
            <CollapsibleSection
              title="Add to Your Own Website"
              description="For technical users: embed discovery code on your own site"
              badge="recommended"
              isComplete={false}
              defaultOpen={false}
            >
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Have your own website? Copy/paste this code into your website's{" "}
                  <code className="rounded bg-muted px-1 py-0.5">&lt;head&gt;</code> section to make it discoverable by AI assistants.
                </p>

                <div className="flex flex-wrap gap-2">
                  <Button variant="default" size="sm" onClick={handleCopy} disabled={copied}>
                    <Copy className="mr-2 h-4 w-4" />
                    {copied ? "Copied!" : "Copy Code"}
                  </Button>
                  <Button variant="outline" size="sm" onClick={handleDownload} disabled={downloadStatus === "success"}>
                    <Download className="mr-2 h-4 w-4" />
                    {downloadStatus === "success" ? "Downloaded!" : "Download"}
                  </Button>
                </div>

                <div className="rounded-lg border bg-muted/30">
                  <Textarea
                    value={schema}
                    readOnly
                    className="min-h-[300px] resize-none rounded-lg border-0 bg-transparent font-mono text-xs leading-relaxed shadow-none focus-visible:ring-0"
                    style={{
                      fontFamily: "'Fira Code', 'Consolas', 'Monaco', monospace"
                    }}
                  />
                </div>

                <div className="rounded-lg border bg-muted/30 p-4">
                  <h3 className="mb-3 font-semibold flex items-center gap-2 text-sm">
                    <HelpCircle className="h-4 w-4 text-primary" />
                    How to use this code
                  </h3>
                  <ol className="space-y-2 text-sm text-muted-foreground">
                    <li className="flex gap-3">
                      <span className="font-semibold text-foreground shrink-0">1.</span>
                      <span>Copy the code above by clicking the "Copy Code" button</span>
                    </li>
                    <li className="flex gap-3">
                      <span className="font-semibold text-foreground shrink-0">2.</span>
                      <span>
                        Find your website's main page file (usually{" "}
                        <code className="rounded bg-muted px-1 py-0.5">index.html</code>)
                      </span>
                    </li>
                    <li className="flex gap-3">
                      <span className="font-semibold text-foreground shrink-0">3.</span>
                      <span>
                        Paste the code inside the{" "}
                        <code className="rounded bg-muted px-1 py-0.5">&lt;head&gt;</code> section
                      </span>
                    </li>
                    <li className="flex gap-3">
                      <span className="font-semibold text-foreground shrink-0">4.</span>
                      <span>Save and publish your website</span>
                    </li>
                  </ol>
                </div>
              </div>
            </CollapsibleSection>

            {/* Subtle Refresh Link */}
            <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <span>Last updated {formatLastUpdated(lastUpdated)}</span>
              <span>·</span>
              <button
                type="button"
                onClick={handleRefresh}
                disabled={refreshing}
                className="inline-flex items-center gap-1 text-primary hover:underline disabled:opacity-50"
              >
                <RefreshCw className={`h-3 w-3 ${refreshing ? "animate-spin" : ""}`} />
                {refreshing ? "Refreshing…" : "Refresh"}
              </button>
            </div>
          </div>
        ) : !refreshing ? (
          /* Empty State - Only show when not refreshing */
          <div className="rounded-lg border bg-card p-12 text-center shadow-sm">
            <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-muted">
              <Sparkles className="h-10 w-10 text-muted-foreground" />
            </div>
            <h3 className="mt-6 text-lg font-semibold">Get Started with Discovery</h3>
            <p className="mt-2 text-sm text-muted-foreground max-w-md mx-auto">
              First, publish your restaurant profile and menu. Then come back here to make your restaurant discoverable by AI assistants.
            </p>
            <div className="mt-6 flex gap-3 justify-center">
              <Button
                onClick={handleRefresh}
                disabled={refreshing || !pubkey || !relays.length}
              >
                <RefreshCw className={`mr-2 h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
                {refreshing ? "Refreshing..." : "Check for Data"}
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
        ) : null}
      </div>
    </div>
  );
}
