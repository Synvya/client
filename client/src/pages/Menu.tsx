import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { MenuManagerView, type MenuItemPatch } from "@/components/MenuManagerView";
import { MenuReviewPanel } from "@/components/MenuReviewPanel";
import { Store, FileSpreadsheet, FileText, ArrowLeft, ArrowRight, Check, RefreshCw, AlertCircle, Loader2, Mail, ExternalLink } from "lucide-react";
import { buildSquareAuthorizeUrl } from "@/lib/square/auth";
import {
  fetchSquareStatus,
  previewSquareCatalog,
  type SquareConnectionStatus,
} from "@/services/square";
import { publishToRelays, getPool } from "@/lib/relayPool";
import { validateEvent } from "@/validation/nostrValidation";
import { resolveProfileLocation } from "@/lib/profileLocation";
import { useBusinessProfile } from "@/state/useBusinessProfile";
import { useAuth } from "@/state/useAuth";
import { useRelays } from "@/state/useRelays";
import { useOnboardingProgress } from "@/state/useOnboardingProgress";
import { buildDeletionEventByAddress } from "@/lib/handlerEvents";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import sampleSpreadsheetUrl from "@/assets/Sample Menu Importer.xlsx?url";
import { buildSpreadsheetPreviewEvents, parseMenuSpreadsheetXlsx } from "@/lib/spreadsheet/menuSpreadsheet";
import { fetchAndPublishDiscovery } from "@/services/discoveryPublish";
import { cn } from "@/lib/utils";
import type { MenuReviewState, MenuReviewItem } from "@/lib/menuImport/types";
import { reviewStateToSpreadsheetRows } from "@/lib/menuImport/pdfToMenuData";
import { spreadsheetToReviewState } from "@/lib/menuImport/spreadsheetToReviewState";
import { squareEventsToReviewState } from "@/lib/menuImport/squareToReviewState";
import { extractPdfMenu } from "@/services/menuImport";
import { pdfToImages } from "@/lib/menuImport/pdfToImages";
import { useMenuEnhancement } from "@/hooks/useMenuEnhancement";
import { fetchLiveMenuData, type LiveMenuData, type LiveMenuItem } from "@/lib/menu/menuFetch";

type MenuSource = "square" | "spreadsheet" | "pdf";
type WorkflowStep = 1 | 2;

interface WorkflowStepIndicatorProps {
  currentStep: WorkflowStep;
  source: MenuSource;
}

function WorkflowStepIndicator({ currentStep, source }: WorkflowStepIndicatorProps): JSX.Element {
  const steps = [
    { step: 1, label: source === "square" ? "Connect" : "Upload" },
    { step: 2, label: "Review & Publish" },
  ];

  return (
    <div className="flex items-center gap-2">
      {steps.map(({ step, label }, index) => (
        <div key={step} className="flex items-center gap-2">
          <div className="flex items-center gap-2">
            <div
              className={cn(
                "flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium",
                step < currentStep
                  ? "bg-emerald-500 text-white"
                  : step === currentStep
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground"
              )}
            >
              {step < currentStep ? <Check className="h-3.5 w-3.5" /> : step}
            </div>
            <span
              className={cn(
                "text-sm",
                step === currentStep ? "font-medium text-foreground" : "text-muted-foreground"
              )}
            >
              {label}
            </span>
          </div>
          {index < steps.length - 1 && (
            <div
              className={cn(
                "h-px w-8",
                step < currentStep ? "bg-emerald-500" : "bg-muted"
              )}
            />
          )}
        </div>
      ))}
    </div>
  );
}

export function MenuPage(): JSX.Element {
  const navigate = useNavigate();
  const pubkey = useAuth((state) => state.pubkey);
  const signEvent = useAuth((state) => state.signEvent);
  const relays = useRelays((state) => state.relays);
  const { location: cachedProfileLocation, setLocation: setCachedProfileLocation } = useBusinessProfile((state) => ({
    location: state.location,
    setLocation: state.setLocation,
  }));
  const setMenuPublished = useOnboardingProgress((state) => state.setMenuPublished);
  const setDiscoveryPageUrl = useOnboardingProgress((state) => state.setDiscoveryPageUrl);
  const discoveryPageUrl = useOnboardingProgress((state) => state.discoveryPageUrl);
  const profilePublished = useOnboardingProgress((state) => state.profilePublished);

  const location = useLocation();

  // Square connection state
  const [squareStatus, setSquareStatus] = useState<SquareConnectionStatus | null>(null);
  const [squareLoading, setSquareLoading] = useState(false);
  const [squareError, setSquareError] = useState<string | null>(null);
  const [squareNotice, setSquareNotice] = useState<string | null>(null);
  const [statusVersion, setStatusVersion] = useState(0);
  const [connectBusy, setConnectBusy] = useState(false);
  const [pendingAutoPreviewSquare, setPendingAutoPreviewSquare] = useState(false);
  const [squareFetchingCatalog, setSquareFetchingCatalog] = useState(false);

  // Shared review state (unified across all sources)
  const [reviewState, setReviewState] = useState<MenuReviewState | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [importNotice, setImportNotice] = useState<string | null>(null);
  const [publishBusy, setPublishBusy] = useState(false);
  const [pdfExtracting, setPdfExtracting] = useState(false);
  const [publishConfirmOpen, setPublishConfirmOpen] = useState(false);
  const [unpublishBusy, setUnpublishBusy] = useState(false);
  const [publishSuccess, setPublishSuccess] = useState(false);

  // Menu Manager state
  const [pageMode, setPageMode] = useState<"manager" | "import">("manager");
  const [managerLoading, setManagerLoading] = useState(false);
  const [managerError, setManagerError] = useState<string | null>(null);
  const [managerData, setManagerData] = useState<LiveMenuData | null>(null);

  // Source selection
  const [selectedSource, setSelectedSource] = useState<MenuSource | null>(null);

  // Multi-step publish progress and Synvya.com error handling
  const [publishStep, setPublishStep] = useState<"nostr" | "synvya" | null>(null);
  const [publishProgress, setPublishProgress] = useState<{ current: number; total: number }>({ current: 0, total: 0 });
  const [synvyaError, setSynvyaError] = useState<string | null>(null);
  const [lastPublishedHtml, setLastPublishedHtml] = useState<string | null>(null);

  // File input refs for re-upload
  const pdfFileInputRef = useRef<HTMLInputElement>(null);
  const sheetFileInputRef = useRef<HTMLInputElement>(null);

  // Enhancement hook
  const {
    enriching,
    imageGenProgress,
    handleEnrich,
    handleGenerateImages,
    handleRegenerateImage,
  } = useMenuEnhancement({
    reviewState,
    setReviewState,
    setError: setImportError,
    setNotice: setImportNotice,
  });

  // Compute current workflow step
  const currentStep: WorkflowStep = useMemo(() => {
    if (reviewState) return 2;
    return 1;
  }, [reviewState]);

  // --- Square status loading ---
  useEffect(() => {
    if (!pubkey) {
      setSquareStatus(null);
      setSelectedSource(null);
      return;
    }
    setSquareLoading(true);
    setSquareError(null);
    void fetchSquareStatus(pubkey)
      .then((status) => {
        setSquareStatus(status);
        if (!status.connected) {
          setSquareNotice(null);
        }
        if (status.profileLocation) {
          setCachedProfileLocation(status.profileLocation);
        }
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : "Failed to load Square status.";
        setSquareError(message);
        setSquareStatus(null);
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

  // Square OAuth callback detection
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get("square") === "connected") {
      setSquareNotice("Square connection completed.");
      setStatusVersion((value) => value + 1);
      setSelectedSource("square");
      setPendingAutoPreviewSquare(true);
      setPageMode("import");
      const next = location.pathname;
      window.history.replaceState(null, "", next);
    }
  }, [location.pathname, location.search]);

  // Auto-load catalog preview when returning from Square OAuth callback
  useEffect(() => {
    if (!pendingAutoPreviewSquare || !squareStatus?.connected || !pubkey || squareFetchingCatalog) return;
    setPendingAutoPreviewSquare(false);
    void handleFetchSquareCatalog();
  }, [pendingAutoPreviewSquare, squareStatus?.connected, pubkey, squareFetchingCatalog]);

  const squareLocationsLabel = useMemo(() => {
    const locations = squareStatus?.locations ?? [];
    if (!locations.length) return "No locations on record";
    if (locations.length <= 2) {
      return locations.map((loc) => loc.name).join(", ");
    }
    const [first, second] = locations;
    return `${first.name}, ${second.name} + ${locations.length - 2} more`;
  }, [squareStatus?.locations]);

  // --- Handlers ---

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

  const handleFetchSquareCatalog = async () => {
    if (!pubkey) return;
    setSquareError(null);
    setSquareNotice(null);
    setImportError(null);
    setSquareFetchingCatalog(true);
    setPublishSuccess(false);
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
      const state = squareEventsToReviewState(result.events, "Square Catalog");
      setReviewState(state);
      setImportNotice(`Loaded ${state.items.length} item${state.items.length === 1 ? "" : "s"} from Square catalog.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to fetch Square catalog.";
      setSquareError(message);
    } finally {
      setSquareFetchingCatalog(false);
    }
  };

  const handleSpreadsheetUpload = async (file: File) => {
    if (!pubkey) return;
    setImportError(null);
    setImportNotice(null);
    setPublishSuccess(false);
    try {
      const parsed = await parseMenuSpreadsheetXlsx(file);
      const state = spreadsheetToReviewState({
        fileName: file.name,
        menus: parsed.menus,
        items: parsed.items,
      });
      setReviewState(state);
      setImportNotice(`Loaded ${state.items.length} item${state.items.length === 1 ? "" : "s"} from ${file.name}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to parse spreadsheet.";
      setImportError(message);
      setReviewState(null);
    }
  };

  const fileToBase64Image = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        resolve(dataUrl.split(",")[1]);
      };
      reader.onerror = () => reject(new Error("Failed to read image file."));
      reader.readAsDataURL(file);
    });

  const handlePdfUpload = async (file: File) => {
    if (!pubkey) return;
    setImportError(null);
    setImportNotice(null);
    setPdfExtracting(true);
    setPublishSuccess(false);
    try {
      const isImage = file.type.startsWith("image/");
      const pageImages = isImage
        ? [await fileToBase64Image(file)]
        : await pdfToImages(file);
      const result = await extractPdfMenu(pageImages, "");

      const reviewItems: MenuReviewItem[] = result.items.map((item) => ({
        ...item,
        imageGenEnabled: false,
        imageGenStatus: "idle" as const,
      }));

      setReviewState({
        fileName: file.name,
        menus: result.menus,
        items: reviewItems,
      });
      setImportNotice(`Extracted ${result.items.length} item${result.items.length === 1 ? "" : "s"} from ${file.name}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to extract menu.";
      setImportError(message);
      setReviewState(null);
    } finally {
      setPdfExtracting(false);
    }
  };

  // Unified publish handler for all sources
  const handlePublish = async () => {
    if (!pubkey || !reviewState) return;
    setImportError(null);
    setImportNotice(null);
    setSynvyaError(null);
    setPublishBusy(true);
    try {
      // Build events from review state
      const { menus, items } = reviewStateToSpreadsheetRows(reviewState);
      const previewEvents = buildSpreadsheetPreviewEvents({
        merchantPubkey: pubkey,
        menus,
        items,
      });

      if (previewEvents.length === 0) {
        setImportError("No events to publish.");
        return;
      }

      // Step 1: Publish to Nostr
      setPublishStep("nostr");
      const publishedIds: string[] = [];
      const ordered = [
        ...previewEvents.filter((e) => e.kind === 30402),
        ...previewEvents.filter((e) => e.kind === 30405),
      ];
      const publishedMenuEvents = [...ordered];
      setPublishProgress({ current: 0, total: ordered.length });
      for (const template of ordered) {
        const signed = await signEvent(template as any);
        validateEvent(signed);
        await publishToRelays(signed, relays);
        publishedIds.push(signed.id);
        setPublishProgress({ current: publishedIds.length, total: ordered.length });
      }
      setReviewState(null);
      setPublishSuccess(true);
      setMenuPublished(true);

      // Step 2: Publish discovery page to Synvya.com
      setPublishStep("synvya");
      try {
        const discoveryResult = await fetchAndPublishDiscovery(pubkey, relays, publishedMenuEvents);
        setDiscoveryPageUrl(discoveryResult.url);
        setLastPublishedHtml(discoveryResult.html);
        setImportNotice(`Published ${publishedIds.length} event${publishedIds.length === 1 ? "" : "s"} and updated discovery page.`);
      } catch (synvyaErr) {
        console.error("Failed to publish to Synvya.com:", synvyaErr);
        const errorMessage = synvyaErr instanceof Error ? synvyaErr.message : "Failed to publish discovery page";
        setSynvyaError(errorMessage);
        setImportNotice(`Published ${publishedIds.length} event${publishedIds.length === 1 ? "" : "s"} (discovery page update failed).`);
      }
      void refreshManagerData();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to publish menu.";
      setImportError(message);
    } finally {
      setPublishBusy(false);
      setPublishStep(null);
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
      setReviewState(null);
      setPublishSuccess(false);
      await refreshManagerData();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to unpublish menu.";
      setSquareError(message);
    } finally {
      setUnpublishBusy(false);
    }
  };

  // --- Menu Manager handlers ---

  const refreshManagerData = useCallback(async () => {
    if (!pubkey) return;
    setManagerLoading(true);
    setManagerError(null);
    try {
      const data = await fetchLiveMenuData(pubkey, relays);
      setManagerData(data);
      setMenuPublished(data.items.length > 0);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load menu from relays.";
      setManagerError(message);
    } finally {
      setManagerLoading(false);
    }
  }, [pubkey, relays]);

  useEffect(() => {
    if (pubkey && pageMode === "manager") {
      void refreshManagerData();
    }
  }, [pubkey, pageMode, refreshManagerData]);

  const handleDeleteItems = async (addresses: string[]) => {
    if (!pubkey) return;

    const deletionEvent = buildDeletionEventByAddress(addresses, [30402], "removing menu items");
    const signed = await signEvent(deletionEvent);
    validateEvent(signed);
    await publishToRelays(signed, relays);

    if (managerData) {
      const addressSet = new Set(addresses);
      const itemsToHide = managerData.items.filter((item) =>
        addressSet.has(`30402:${pubkey}:${item.dTag}`)
      );
      for (const item of itemsToHide) {
        const hiddenTags = [
          ...item.event.tags.filter((t) => t[0] !== "visibility"),
          ["visibility", "hidden"],
        ];
        const hiddenEvent = {
          kind: 30402 as const,
          created_at: Math.floor(Date.now() / 1000),
          content: item.event.content,
          tags: hiddenTags,
        };
        const signedHidden = await signEvent(hiddenEvent as any);
        validateEvent(signedHidden);
        await publishToRelays(signedHidden, relays);
      }
    }

    await refreshManagerData();
  };

  const handleEditItem = async (item: LiveMenuItem, patch: MenuItemPatch) => {
    if (!pubkey) return;

    const existingTags = item.event.tags.filter(
      (t) => t[0] !== "title" && t[0] !== "price" && t[0] !== "image"
    );

    const newTags = [...existingTags];
    const title = patch.title ?? item.title;
    const price = patch.price ?? item.price;
    const currency = patch.currency ?? item.currency;
    const imageUrl = patch.imageUrl ?? item.imageUrl;
    const description = patch.description ?? item.description;

    newTags.push(["title", title]);
    if (!newTags.some((t) => t[0] === "simple")) {
      newTags.push(["simple", "physical"]);
    }
    if (price) {
      newTags.push(["price", price, currency]);
    }
    if (imageUrl) {
      newTags.push(["image", imageUrl]);
    }

    const content = `**${title}**\n\n${description}`.trim();

    const template = {
      kind: 30402 as const,
      created_at: Math.floor(Date.now() / 1000),
      content,
      tags: newTags,
    };

    const signed = await signEvent(template as any);
    validateEvent(signed);
    await publishToRelays(signed, relays);
    await refreshManagerData();
  };

  const handleChangeSource = () => {
    setSelectedSource(null);
    setReviewState(null);
    setImportError(null);
    setImportNotice(null);
    setPublishSuccess(false);
  };

  // Re-upload handlers
  const handleReUpload = () => {
    if (selectedSource === "pdf") {
      pdfFileInputRef.current?.click();
    } else if (selectedSource === "spreadsheet") {
      sheetFileInputRef.current?.click();
    } else if (selectedSource === "square") {
      setReviewState(null);
      setImportError(null);
      setImportNotice(null);
    }
  };

  return (
    <div className="container space-y-6 py-10">
      {/* Hidden file inputs for re-upload */}
      <input
        ref={pdfFileInputRef}
        type="file"
        accept=".pdf,image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void handlePdfUpload(f);
        }}
      />
      <input
        ref={sheetFileInputRef}
        type="file"
        accept=".xlsx"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void handleSpreadsheetUpload(f);
        }}
      />

      {/* Profile-first guard */}
      {!profilePublished && (
        <section className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-6">
          <div className="flex items-start gap-3">
            <AlertCircle className="mt-0.5 h-5 w-5 text-amber-600" />
            <div className="flex-1">
              <h3 className="font-semibold text-amber-800">Publish your profile first</h3>
              <p className="mt-1 text-sm text-amber-700">
                Before adding your menu, you need to publish your restaurant profile. This ensures your menu items are properly linked to your business.
              </p>
              <Button
                onClick={() => navigate("/app/profile")}
                className="mt-3"
                variant="default"
              >
                Go to Profile
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </div>
          </div>
        </section>
      )}

      {/* Menu Manager View (default mode) */}
      {profilePublished && pageMode === "manager" && (
        <MenuManagerView
          pubkey={pubkey ?? ""}
          relays={relays}
          loading={managerLoading}
          error={managerError}
          menuData={managerData}
          onRefresh={() => void refreshManagerData()}
          onImport={() => {
            setPageMode("import");
            setPublishSuccess(false);
            handleChangeSource();
          }}
          onDeleteItems={handleDeleteItems}
          onEditItem={handleEditItem}
          onUnpublishAll={handleUnpublishMenu}
        />
      )}

      {/* Import mode content */}
      {profilePublished && pageMode === "import" && (
        <>
      {/* Back to Manager button */}
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          setPageMode("manager");
          setPublishSuccess(false);
          handleChangeSource();
          void refreshManagerData();
        }}
      >
        <ArrowLeft className="mr-2 h-3.5 w-3.5" />
        Back to Menu Manager
      </Button>

      {/* Success State */}
      {publishSuccess && (
        <section className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-6">
          <div className="flex items-start gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-500 text-white">
              <Check className="h-4 w-4" />
            </div>
            <div className="flex-1">
              <p className="font-medium text-emerald-700">Your menu is now live!</p>
              <p className="mt-1 text-sm text-emerald-600">
                Your restaurant is now discoverable by AI assistants.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  onClick={() => {
                    setPageMode("manager");
                    setPublishSuccess(false);
                    void refreshManagerData();
                  }}
                  variant="default"
                  size="sm"
                >
                  View Menu Manager
                </Button>
                {lastPublishedHtml && (
                  <Button
                    onClick={() => {
                      const blob = new Blob([lastPublishedHtml], { type: "text/html" });
                      window.open(URL.createObjectURL(blob), "_blank");
                    }}
                    variant="outline"
                    size="sm"
                  >
                    <ExternalLink className="mr-2 h-4 w-4" />
                    Preview Discovery Page
                  </Button>
                )}
                {discoveryPageUrl && !lastPublishedHtml && (
                  <Button
                    onClick={() => window.open(discoveryPageUrl, "_blank")}
                    variant="outline"
                    size="sm"
                  >
                    <ExternalLink className="mr-2 h-4 w-4" />
                    View Discovery Page
                  </Button>
                )}
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Source Selection */}
      {!selectedSource && !publishSuccess && (
        <section className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold">Choose Your Menu Source</h2>
            <p className="text-sm text-muted-foreground">
              Select how you'd like to import your menu items.
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <button
              type="button"
              onClick={() => setSelectedSource("square")}
              className={cn(
                "flex flex-col items-center gap-3 rounded-lg border-2 border-dashed p-6 text-center transition-colors hover:border-primary hover:bg-muted/50",
                squareStatus?.connected && "border-emerald-500 bg-emerald-500/5"
              )}
            >
              <Store className="h-10 w-10 text-muted-foreground" />
              <div>
                <h3 className="font-medium">Square POS</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  Connect your existing Square catalog
                </p>
              </div>
              {squareStatus?.connected && (
                <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-600">
                  Connected
                </span>
              )}
              <span className="text-sm font-medium text-primary">Select</span>
            </button>

            <button
              type="button"
              onClick={() => setSelectedSource("pdf")}
              className="flex flex-col items-center gap-3 rounded-lg border-2 border-dashed p-6 text-center transition-colors hover:border-primary hover:bg-muted/50"
            >
              <FileText className="h-10 w-10 text-muted-foreground" />
              <div>
                <h3 className="font-medium">PDF / Image Menu</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  Upload a PDF or picture of your menu
                </p>
              </div>
              <span className="text-sm font-medium text-primary">Select</span>
            </button>

            <button
              type="button"
              onClick={() => setSelectedSource("spreadsheet")}
              className="flex flex-col items-center gap-3 rounded-lg border-2 border-dashed p-6 text-center transition-colors hover:border-primary hover:bg-muted/50"
            >
              <FileSpreadsheet className="h-10 w-10 text-muted-foreground" />
              <div>
                <h3 className="font-medium">Spreadsheet</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  Upload an XLSX file manually
                </p>
              </div>
              <span className="text-sm font-medium text-primary">Select</span>
            </button>
          </div>
        </section>
      )}

      {/* Square Workflow */}
      {selectedSource === "square" && !publishSuccess && (
        <section className="space-y-4 rounded-lg border bg-card p-6">
          <header className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Store className="h-5 w-5 text-muted-foreground" />
              <div>
                <h2 className="text-lg font-semibold">Square Integration</h2>
                <p className="text-sm text-muted-foreground">
                  Connect your Square account to retrieve your menu.
                </p>
              </div>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleChangeSource}
              className="shrink-0 gap-1.5"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Change source
            </Button>
          </header>

          <WorkflowStepIndicator currentStep={currentStep} source="square" />

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

          {importError ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              {importError}
            </div>
          ) : null}

          {importNotice ? (
            <div className="rounded-md border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm text-emerald-600">
              {importNotice}
            </div>
          ) : null}

          {/* Publishing progress indicator */}
          {publishBusy && publishStep && (
            <div className="flex items-center gap-3 rounded-md border bg-muted/50 p-3 text-sm">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              <div className="flex items-center gap-2">
                <span className={
                  publishStep === "nostr"
                    ? "text-primary font-medium"
                    : "text-emerald-600"
                }>
                  {publishStep === "nostr" ? `1. Publishing (${publishProgress.current} of ${publishProgress.total})` : "1. Published"}
                </span>
                <span className="text-muted-foreground">&rarr;</span>
                <span className={publishStep === "synvya" ? "text-primary font-medium" : ""}>
                  2. Going live
                </span>
              </div>
            </div>
          )}

          {synvyaError && (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
              <p className="font-medium text-amber-800">Going live failed</p>
              <p className="mt-1 text-amber-700">{synvyaError}</p>
              <a
                href={`mailto:support@synvya.com?subject=Discovery%20Page%20Error&body=${encodeURIComponent(`Error: ${synvyaError}\n\nPublic Key: ${pubkey}`)}`}
                className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
              >
                <Mail className="h-3.5 w-3.5" />
                Contact support@synvya.com
              </a>
            </div>
          )}

          {/* Step 1: Connect */}
          {currentStep === 1 && !squareStatus?.connected && (
            <div className="space-y-4">
              <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                <p className="font-medium text-foreground">Square is not connected.</p>
                <p className="mt-1">
                  Connect your Square seller account to read your catalog and publish listings to your Nostr relays.
                </p>
              </div>
              <Button onClick={handleConnectSquare} disabled={connectBusy || squareLoading}>
                {connectBusy ? "Opening Square…" : "Connect Square"}
              </Button>
            </div>
          )}

          {/* Step 1: Connected but catalog not fetched yet */}
          {currentStep === 1 && squareStatus?.connected && (
            <div className="space-y-4">
              {squareLoading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <div className="h-4 w-4 animate-spin rounded-full border border-primary border-t-transparent" />
                  <span>Checking Square connection…</span>
                </div>
              ) : (
                <div className="flex items-center gap-3 rounded-md border border-emerald-500/40 bg-emerald-500/5 p-3 text-sm">
                  <Check className="h-4 w-4 text-emerald-600 shrink-0" />
                  <span>
                    Connected to <span className="font-medium">{squareStatus.merchantName || squareStatus.merchantId || "Square"}</span>
                    {squareLocationsLabel !== "No locations on record" && (
                      <span className="text-muted-foreground"> — {squareLocationsLabel}</span>
                    )}
                  </span>
                </div>
              )}

              <p className="text-sm text-muted-foreground">
                Import your Square catalog to review, enhance with AI descriptions and photos, then publish.
              </p>
              <Button onClick={() => void handleFetchSquareCatalog()} disabled={squareFetchingCatalog || squareLoading}>
                {squareFetchingCatalog ? "Fetching Catalog…" : "Fetch Menu from Square"}
              </Button>
            </div>
          )}

          {/* Step 2: Review & Publish */}
          {currentStep === 2 && reviewState && (
            <div className="space-y-4">
              <MenuReviewPanel
                reviewState={reviewState}
                enriching={enriching}
                imageGenProgress={imageGenProgress}
                publishBusy={publishBusy}
                onEnrich={() => void handleEnrich()}
                onGenerateImages={() => void handleGenerateImages()}
                onRegenerateImage={(idx) => void handleRegenerateImage(idx)}
                onPublish={() => {
                  setPublishConfirmOpen(true);
                }}
                onReUpload={() => {
                  setReviewState(null);
                  setImportError(null);
                  setImportNotice(null);
                }}
                reUploadLabel="Refetch from Square"
              />
            </div>
          )}

          <Dialog open={publishConfirmOpen} onOpenChange={setPublishConfirmOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Publish Menu</DialogTitle>
                <DialogDescription>
                  This action will make your menu visible to AI assistants.
                  {reviewState && (
                    <span className="block mt-2">
                      You are about to publish {reviewState.items.length} item{reviewState.items.length === 1 ? "" : "s"}.
                    </span>
                  )}
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" onClick={() => setPublishConfirmOpen(false)} disabled={publishBusy}>
                  Cancel
                </Button>
                <Button
                  onClick={async () => {
                    setPublishConfirmOpen(false);
                    await handlePublish();
                  }}
                  disabled={publishBusy}
                >
                  Publish
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </section>
      )}

      {/* PDF Workflow */}
      {selectedSource === "pdf" && !publishSuccess && (
        <section className="space-y-4 rounded-lg border bg-card p-6">
          <header className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <FileText className="h-5 w-5 text-muted-foreground" />
              <div>
                <h2 className="text-lg font-semibold">PDF / Image Menu Import</h2>
                <p className="text-sm text-muted-foreground">
                  Upload a PDF or picture of your menu and let AI extract, enrich, and generate images.
                </p>
              </div>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleChangeSource}
              className="shrink-0 gap-1.5"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Change source
            </Button>
          </header>

          <WorkflowStepIndicator currentStep={currentStep} source="pdf" />

          {importError ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              {importError}
            </div>
          ) : null}

          {importNotice ? (
            <div className="rounded-md border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm text-emerald-600">
              {importNotice}
            </div>
          ) : null}

          {/* Publishing progress indicator */}
          {publishBusy && publishStep && (
            <div className="flex items-center gap-3 rounded-md border bg-muted/50 p-3 text-sm">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              <div className="flex items-center gap-2">
                <span className={publishStep === "nostr" ? "text-primary font-medium" : "text-emerald-600"}>
                  {publishStep === "nostr" ? `1. Publishing (${publishProgress.current} of ${publishProgress.total})` : "1. Published"}
                </span>
                <span className="text-muted-foreground">&rarr;</span>
                <span className={publishStep === "synvya" ? "text-primary font-medium" : ""}>
                  2. Going live
                </span>
              </div>
            </div>
          )}

          {synvyaError && (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
              <p className="font-medium text-amber-800">Going live failed</p>
              <p className="mt-1 text-amber-700">{synvyaError}</p>
              <a
                href={`mailto:support@synvya.com?subject=Discovery%20Page%20Error&body=${encodeURIComponent(`Error: ${synvyaError}\n\nPublic Key: ${pubkey}`)}`}
                className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
              >
                <Mail className="h-3.5 w-3.5" />
                Contact support@synvya.com
              </a>
            </div>
          )}

          {/* Step 1: Upload PDF */}
          {currentStep === 1 && (
            <div className="space-y-4">
              <div className="flex flex-col gap-2">
                <label className="text-sm font-medium">Upload PDF or Image</label>
                <input
                  type="file"
                  accept=".pdf,image/*"
                  disabled={pdfExtracting}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void handlePdfUpload(f);
                  }}
                  className="text-sm"
                />
              </div>
              {pdfExtracting && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Extracting menu (this may take 10-20 seconds)...</span>
                </div>
              )}
              <p className="text-sm text-muted-foreground">
                Upload a PDF or picture of your menu. AI will extract all items, prices, and descriptions automatically.
              </p>
            </div>
          )}

          {/* Step 2: Review & Publish */}
          {currentStep === 2 && reviewState && (
            <MenuReviewPanel
              reviewState={reviewState}
              enriching={enriching}
              imageGenProgress={imageGenProgress}
              publishBusy={publishBusy}
              onEnrich={() => void handleEnrich()}
              onGenerateImages={() => void handleGenerateImages()}
              onRegenerateImage={(idx) => void handleRegenerateImage(idx)}
              onPublish={() => {
                setPublishConfirmOpen(true);
              }}
              onReUpload={() => pdfFileInputRef.current?.click()}
              reUploadLabel="Upload Different File"
            />
          )}

          <Dialog open={publishConfirmOpen} onOpenChange={setPublishConfirmOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Publish Menu</DialogTitle>
                <DialogDescription>
                  This action will make your menu visible to AI assistants.
                  {reviewState && (
                    <span className="block mt-2">
                      You are about to publish {reviewState.items.length} item{reviewState.items.length === 1 ? "" : "s"}.
                    </span>
                  )}
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" onClick={() => setPublishConfirmOpen(false)} disabled={publishBusy}>
                  Cancel
                </Button>
                <Button
                  onClick={async () => {
                    setPublishConfirmOpen(false);
                    await handlePublish();
                  }}
                  disabled={publishBusy}
                >
                  Publish
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </section>
      )}

      {/* Spreadsheet Workflow */}
      {selectedSource === "spreadsheet" && !publishSuccess && (
        <section className="space-y-4 rounded-lg border bg-card p-6">
          <header className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <FileSpreadsheet className="h-5 w-5 text-muted-foreground" />
              <div>
                <h2 className="text-lg font-semibold">Spreadsheet Import</h2>
                <p className="text-sm text-muted-foreground">
                  Upload an XLSX file with your menu.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <a
                href={sampleSpreadsheetUrl}
                download="Sample Menu Importer.xlsx"
                className="text-sm font-medium text-primary underline-offset-4 hover:underline"
              >
                Download template
              </a>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleChangeSource}
                className="shrink-0 gap-1.5"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Change source
              </Button>
            </div>
          </header>

          <WorkflowStepIndicator currentStep={currentStep} source="spreadsheet" />

          {importError ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              {importError}
            </div>
          ) : null}

          {importNotice ? (
            <div className="rounded-md border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm text-emerald-600">
              {importNotice}
            </div>
          ) : null}

          {/* Publishing progress indicator */}
          {publishBusy && publishStep && (
            <div className="flex items-center gap-3 rounded-md border bg-muted/50 p-3 text-sm">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              <div className="flex items-center gap-2">
                <span className={
                  publishStep === "nostr"
                    ? "text-primary font-medium"
                    : "text-emerald-600"
                }>
                  {publishStep === "nostr" ? `1. Publishing (${publishProgress.current} of ${publishProgress.total})` : "1. Published"}
                </span>
                <span className="text-muted-foreground">&rarr;</span>
                <span className={publishStep === "synvya" ? "text-primary font-medium" : ""}>
                  2. Going live
                </span>
              </div>
            </div>
          )}

          {synvyaError && (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
              <p className="font-medium text-amber-800">Going live failed</p>
              <p className="mt-1 text-amber-700">{synvyaError}</p>
              <a
                href={`mailto:support@synvya.com?subject=Discovery%20Page%20Error&body=${encodeURIComponent(`Error: ${synvyaError}\n\nPublic Key: ${pubkey}`)}`}
                className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
              >
                <Mail className="h-3.5 w-3.5" />
                Contact support@synvya.com
              </a>
            </div>
          )}

          {/* Step 1: Upload */}
          {currentStep === 1 && (
            <div className="space-y-4">
              <div className="flex flex-col gap-2">
                <label className="text-sm font-medium">Upload XLSX</label>
                <input
                  type="file"
                  accept=".xlsx"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void handleSpreadsheetUpload(f);
                  }}
                  className="text-sm"
                />
              </div>
              <p className="text-sm text-muted-foreground">
                Use our template to format your menu correctly.
              </p>
            </div>
          )}

          {/* Step 2: Review & Publish */}
          {currentStep === 2 && reviewState && (
            <MenuReviewPanel
              reviewState={reviewState}
              enriching={enriching}
              imageGenProgress={imageGenProgress}
              publishBusy={publishBusy}
              onEnrich={() => void handleEnrich()}
              onGenerateImages={() => void handleGenerateImages()}
              onRegenerateImage={(idx) => void handleRegenerateImage(idx)}
              onPublish={() => {
                setPublishConfirmOpen(true);
              }}
              onReUpload={() => sheetFileInputRef.current?.click()}
              reUploadLabel="Upload Different File"
            />
          )}

          <Dialog open={publishConfirmOpen} onOpenChange={setPublishConfirmOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Publish Menu</DialogTitle>
                <DialogDescription>
                  This action will make your menu visible to AI assistants.
                  {reviewState && (
                    <span className="block mt-2">
                      You are about to publish {reviewState.items.length} item{reviewState.items.length === 1 ? "" : "s"}.
                    </span>
                  )}
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" onClick={() => setPublishConfirmOpen(false)} disabled={publishBusy}>
                  Cancel
                </Button>
                <Button
                  onClick={async () => {
                    setPublishConfirmOpen(false);
                    await handlePublish();
                  }}
                  disabled={publishBusy}
                >
                  Publish
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </section>
      )}
        </>
      )}
    </div>
  );
}
