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
import { Copy, Download, Code, RefreshCw, AlertCircle, Sparkles, FileText, Package, Info, ExternalLink, HelpCircle } from "lucide-react";
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
  const [lastProfileTags, setLastProfileTags] = useState<string[][] | null>(null);
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

  const handleDownloadWebsiteZip = async () => {
    if (!pubkey || !lastProfile) return;
    setExporting(true);
    try {
      const typeSlug = mapBusinessTypeToEstablishmentSlug(lastProfile.businessType);
      const nameSlug = slugify(lastProfile.name || lastProfile.displayName || "business");

      const { html, handle } = buildStaticSiteFiles({
        profile: lastProfile,
        geohash: lastGeohash,
        menuEvents: lastMenuEvents,
        merchantPubkey: pubkey,
        profileTags: lastProfileTags,
        typeSlug,
        nameSlug,
      });

      // Create zip file with folder structure: <handle>/index.html
      const files: Record<string, string> = {
        [`${handle}/index.html`]: html,
      };

      const zipBlob = await buildZipBlob(files);
      triggerBrowserDownload(zipBlob, `${handle}.zip`);
    } catch (error) {
      console.error("Failed to export discovery page:", error);
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
          <div className="space-y-2">
            <h1 className="text-3xl font-bold tracking-tight">Discovery</h1>
            <p className="text-lg text-muted-foreground">
              Get discovered by AI assistants like ChatGPT and Claude. Download your discovery page to be published on Synvya, and optionally add discovery code to your own website.
            </p>
            <p className="text-sm text-muted-foreground">
              Click "Refresh" to pull your latest published profile and menu data.
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
            <Info className="mt-1 h-5 w-5 flex-shrink-0 text-primary" />
            <div className="space-y-3">
              <h2 className="text-lg font-semibold">What You Get</h2>
              <p className="text-sm text-muted-foreground">
                This page generates two things from your latest published profile and menu data to help AI assistants find your restaurant:
              </p>
              <ul className="list-disc space-y-2 pl-5 text-sm text-muted-foreground">
                <li>
                  <strong className="text-foreground">Your Synvya Discovery Page:</strong> Download a complete discovery page package and email it to synvya@synvya.com to get your page published on synvya.com for maximum visibility.
                </li>
                <li>
                  <strong className="text-foreground">Add Discovery Code to Your Website (Optional):</strong> If you have your own website, add this code to make it discoverable by AI assistants. Works alongside your Synvya page for maximum visibility.
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

            {/* Discovery Code */}
            <div className="space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-xl font-semibold">Add Discovery Code to Your Website</h2>
                  <p className="text-sm text-muted-foreground">
                    Have your own website? Copy/paste this code into your website's <code className="rounded bg-muted px-1 py-0.5">&lt;head&gt;</code> section to make it discoverable by AI assistants.
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
                <h3 className="mb-4 font-semibold flex items-center gap-2">
                  <HelpCircle className="h-5 w-5 text-primary" />
                  How to use this code
                </h3>
                <ol className="space-y-3 text-sm text-muted-foreground">
                  <li className="flex gap-3">
                    <span className="font-semibold text-foreground shrink-0">1.</span>
                    <span>Copy the code above by clicking the "Copy" button</span>
                  </li>
                  <li className="flex gap-3">
                    <span className="font-semibold text-foreground shrink-0">2.</span>
                    <span>
                      Find your website's main page file (usually called{" "}
                      <code className="rounded bg-muted px-1 py-0.5">index.html</code>). If you're not sure how to do this, ask your web developer or hosting provider.
                    </span>
                  </li>
                  <li className="flex gap-3">
                    <span className="font-semibold text-foreground shrink-0">3.</span>
                    <span>
                      Paste the code inside the{" "}
                      <code className="rounded bg-muted px-1 py-0.5">&lt;head&gt;</code> section, before the closing{" "}
                      <code className="rounded bg-muted px-1 py-0.5">&lt;/head&gt;</code> tag
                    </span>
                  </li>
                  <li className="flex gap-3">
                    <span className="font-semibold text-foreground shrink-0">4.</span>
                    <span>Save and publish your website</span>
                  </li>
                </ol>
              </div>
            </div>

            {/* Synvya Discovery Page */}
            <div className="space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <Package className="mt-1 h-6 w-6 flex-shrink-0 text-primary" />
                  <div>
                    <h2 className="text-xl font-semibold">Your Synvya Discovery Page</h2>
                    <p className="text-sm text-muted-foreground">
                      Download a complete discovery page package with your restaurant information, menu, and all the code needed for AI discovery. After downloading, email the zip file to synvya@synvya.com and we'll publish it on synvya.com for you.
                    </p>
                  </div>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handleDownloadWebsiteZip}
                  disabled={exporting || !lastProfile}
                  className="shrink-0"
                >
                  {exporting ? "Building zip…" : "Download Discovery Page"}
                </Button>
              </div>
              <div className="rounded-lg border bg-muted/30 p-4">
                <p className="text-sm text-muted-foreground">
                  <strong className="text-foreground">Next step:</strong> After downloading, email the zip file to{" "}
                  <a href="mailto:synvya@synvya.com" className="text-primary hover:underline">synvya@synvya.com</a>{" "}
                  and we'll publish your discovery page on synvya.com.
                </p>
              </div>
            </div>
          </div>
        ) : (
          /* Empty State */
          <div className="rounded-lg border bg-card p-12 text-center shadow-sm">
            <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-muted">
              <Sparkles className="h-10 w-10 text-muted-foreground" />
            </div>
            <h3 className="mt-6 text-lg font-semibold">Get Started with Discovery</h3>
            <p className="mt-2 text-sm text-muted-foreground max-w-md mx-auto">
              Publish your restaurant profile and menu to generate your discovery page and code that help AI assistants find and recommend your restaurant.
            </p>
            <div className="mt-6 flex gap-3 justify-center">
              <Button
                onClick={handleRefresh}
                disabled={refreshing || !pubkey || !relays.length}
              >
                <RefreshCw className={`mr-2 h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
                {refreshing ? "Refreshing..." : "Refresh"}
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

      </div>
    </div>
  );
}

