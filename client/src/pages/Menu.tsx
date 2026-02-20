import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { PublicationPreview } from "@/components/PublicationPreview";
import { MenuManagerView, type MenuItemPatch } from "@/components/MenuManagerView";
import { Store, FileSpreadsheet, FileText, ArrowLeft, ArrowRight, Check, RefreshCw, AlertCircle, Loader2, Mail, ExternalLink, Sparkles, ImageIcon } from "lucide-react";
import { buildSquareAuthorizeUrl } from "@/lib/square/auth";
import {
  fetchSquareStatus,
  publishSquareCatalog,
  previewSquareCatalog,
  type SquareConnectionStatus,
  type SquareEventTemplate,
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
import type { PdfImportState, PdfReviewItem, PdfExtractedMenu } from "@/lib/menuImport/types";
import { pdfStateToSpreadsheetRows } from "@/lib/menuImport/pdfToMenuData";
import { extractPdfMenu, enrichMenuDescriptions, generateMenuItemImage } from "@/services/menuImport";
import { pdfToImages } from "@/lib/menuImport/pdfToImages";
import { fetchLiveMenuData, type LiveMenuData, type LiveMenuItem } from "@/lib/menu/menuFetch";

type MenuSource = "square" | "spreadsheet" | "pdf";
type WorkflowStep = 1 | 2 | 3;

interface WorkflowStepIndicatorProps {
  currentStep: WorkflowStep;
  source: MenuSource;
}

function WorkflowStepIndicator({ currentStep, source }: WorkflowStepIndicatorProps): JSX.Element {
  const steps = [
    { step: 1, label: source === "square" ? "Connect" : "Upload" },
    { step: 2, label: source === "pdf" ? "Review & Publish" : "Review Menu" },
    ...(source !== "pdf" ? [{ step: 3, label: "Publish" }] : []),
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
  const [publishSuccess, setPublishSuccess] = useState(false);

  // Menu Manager state
  const [pageMode, setPageMode] = useState<"manager" | "import">("manager");
  const [managerLoading, setManagerLoading] = useState(false);
  const [managerError, setManagerError] = useState<string | null>(null);
  const [managerData, setManagerData] = useState<LiveMenuData | null>(null);

  const [selectedSource, setSelectedSource] = useState<MenuSource | null>(null);
  const [activeSource, setActiveSource] = useState<MenuSource | null>(null);
  const [pendingAutoPreviewSquare, setPendingAutoPreviewSquare] = useState(false);

  const [sheetError, setSheetError] = useState<string | null>(null);
  const [sheetNotice, setSheetNotice] = useState<string | null>(null);
  const [sheetFileName, setSheetFileName] = useState<string | null>(null);
  const [sheetParsed, setSheetParsed] = useState<{ menus: any[]; items: any[] } | null>(null);
  const [sheetPreviewViewed, setSheetPreviewViewed] = useState(false);
  const [sheetPreviewEvents, setSheetPreviewEvents] = useState<SquareEventTemplate[] | null>(null);
  const [sheetPreviewLoading, setSheetPreviewLoading] = useState(false);
  const [sheetPublishBusy, setSheetPublishBusy] = useState(false);

  // PDF import state
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [pdfNotice, setPdfNotice] = useState<string | null>(null);
  const [pdfFileName, setPdfFileName] = useState<string | null>(null);
  const [pdfExtracting, setPdfExtracting] = useState(false);
  const [pdfImportState, setPdfImportState] = useState<PdfImportState | null>(null);
  const [pdfPreviewViewed, setPdfPreviewViewed] = useState(false);
  const [pdfPreviewEvents, setPdfPreviewEvents] = useState<SquareEventTemplate[] | null>(null);
  const [pdfPreviewLoading, setPdfPreviewLoading] = useState(false);
  const [pdfPublishBusy, setPdfPublishBusy] = useState(false);
  const [pdfEnriching, setPdfEnriching] = useState(false);
  const [pdfImageGenProgress, setPdfImageGenProgress] = useState<{ current: number; total: number } | null>(null);
  const [pdfLightboxUrl, setPdfLightboxUrl] = useState<string | null>(null);
  const [pdfLightboxName, setPdfLightboxName] = useState<string>("");

  // Multi-step publish progress and Synvya.com error handling
  const [publishStep, setPublishStep] = useState<"nostr" | "synvya" | null>(null);
  const [synvyaError, setSynvyaError] = useState<string | null>(null);
  const [lastPublishedHtml, setLastPublishedHtml] = useState<string | null>(null);

  // Compute current workflow step
  const currentStep: WorkflowStep = useMemo(() => {
    if (selectedSource === "square") {
      if (!squareStatus?.connected) return 1;
      if (!previewViewed) return 2;
      return 3;
    }
    if (selectedSource === "spreadsheet") {
      if (!sheetParsed) return 1;
      if (!sheetPreviewViewed) return 2;
      return 3;
    }
    if (selectedSource === "pdf") {
      if (!pdfImportState) return 1;
      return 2;
    }
    return 1;
  }, [selectedSource, squareStatus?.connected, previewViewed, sheetParsed, sheetPreviewViewed, pdfImportState, pdfPreviewViewed]);

  useEffect(() => {
    if (!pubkey) {
      setSquareStatus(null);
      setPreviewViewed(false);
      setPreviewEvents(null);
      setActiveSource(null);
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
          setPreviewViewed(false);
          if (activeSource !== "spreadsheet") {
            setPreviewEvents(null);
          }
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
        if (activeSource !== "spreadsheet") {
          setPreviewEvents(null);
        }
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
      setSelectedSource("square");
      setPendingAutoPreviewSquare(true);
      setPageMode("import");
      const next = location.pathname;
      window.history.replaceState(null, "", next);
    }
  }, [location.pathname, location.search]);

  // Auto-load catalog preview when returning from Square OAuth callback
  useEffect(() => {
    if (!pendingAutoPreviewSquare || !squareStatus?.connected || !pubkey || previewLoading) return;
    setPendingAutoPreviewSquare(false);
    setSquareError(null);
    setPreviewLoading(true);
    setPublishSuccess(false);
    void (async () => {
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
    })();
  }, [
    pendingAutoPreviewSquare,
    squareStatus?.connected,
    pubkey,
    previewLoading,
    relays,
    cachedProfileLocation,
    setCachedProfileLocation,
    squareStatus?.profileLocation,
  ]);

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
    setPublishSuccess(false);
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
    setPublishSuccess(false);
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
    setSynvyaError(null);
    setSheetPublishBusy(true);
    try {
      // Step 1: Publish to Nostr
      setPublishStep("nostr");
      const publishedIds: string[] = [];
      // Publish products first, then collections (safer for references)
      const ordered = [
        ...sheetPreviewEvents.filter((e) => e.kind === 30402),
        ...sheetPreviewEvents.filter((e) => e.kind === 30405),
      ];
      // Save events before clearing state (needed for discovery publish fallback)
      const publishedMenuEvents = [...ordered];
      for (const template of ordered) {
        const signed = await signEvent(template as any);
        validateEvent(signed);
        await publishToRelays(signed, relays);
        publishedIds.push(signed.id);
      }
      setSheetPreviewViewed(false);
      setPreviewViewed(false);
      setSheetPreviewEvents(null);
      setPreviewEvents(null);
      setPublishSuccess(true);
      setMenuPublished(true);
      if (activeSource === "spreadsheet") {
        setActiveSource(null);
      }

      // Step 2: Publish discovery page to Synvya.com
      setPublishStep("synvya");
      try {
        const discoveryResult = await fetchAndPublishDiscovery(pubkey, relays, publishedMenuEvents);
        setDiscoveryPageUrl(discoveryResult.url);
        setLastPublishedHtml(discoveryResult.html);
        setSheetNotice(`Published ${publishedIds.length} event${publishedIds.length === 1 ? "" : "s"} and updated discovery page.`);
      } catch (synvyaErr) {
        // Nostr publish succeeded, but Synvya.com failed
        console.error("Failed to publish to Synvya.com:", synvyaErr);
        const errorMessage = synvyaErr instanceof Error ? synvyaErr.message : "Failed to publish discovery page";
        setSynvyaError(errorMessage);
        setSheetNotice(`Published ${publishedIds.length} event${publishedIds.length === 1 ? "" : "s"} (discovery page update failed).`);
      }
      void refreshManagerData();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to publish spreadsheet menu.";
      setSheetError(message);
    } finally {
      setSheetPublishBusy(false);
      setPublishStep(null);
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
    setPdfError(null);
    setPdfNotice(null);
    setPdfPreviewViewed(false);
    setPdfPreviewEvents(null);
    setPdfFileName(file.name);
    setPdfExtracting(true);
    setPublishSuccess(false);
    try {
      const isImage = file.type.startsWith("image/");
      const pageImages = isImage
        ? [await fileToBase64Image(file)]
        : await pdfToImages(file);
      const result = await extractPdfMenu(pageImages, "");

      const reviewItems: PdfReviewItem[] = result.items.map((item) => ({
        ...item,
        imageGenEnabled: false,
        imageGenStatus: "idle" as const,
      }));

      setPdfImportState({
        fileName: file.name,
        menus: result.menus,
        items: reviewItems,
      });
      setPdfNotice(`Extracted ${result.items.length} item${result.items.length === 1 ? "" : "s"} from ${file.name}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to extract menu.";
      setPdfError(message);
      setPdfImportState(null);
    } finally {
      setPdfExtracting(false);
    }
  };

  const handlePdfEnrich = async () => {
    if (!pdfImportState) return;
    setPdfError(null);
    setPdfEnriching(true);
    try {
      const result = await enrichMenuDescriptions(
        pdfImportState.items.map((i) => ({
          name: i.name,
          description: i.description,
          ingredients: i.ingredients,
        })),
        { name: "", cuisine: "", about: "" },
      );

      const enrichMap = new Map(result.items.map((i) => [i.name, i.enrichedDescription]));
      setPdfImportState((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          items: prev.items.map((item) => ({
            ...item,
            enrichedDescription: enrichMap.get(item.name) || item.enrichedDescription,
          })),
        };
      });
      setPdfNotice("Descriptions enriched successfully.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to enrich descriptions.";
      setPdfError(message);
    } finally {
      setPdfEnriching(false);
    }
  };

  const handlePdfGenerateImages = async () => {
    if (!pdfImportState) return;
    setPdfError(null);

    // Generate images for all items that don't already have one
    const enabledItems = pdfImportState.items
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => item.imageGenStatus !== "done");

    if (!enabledItems.length) {
      setPdfNotice("All items already have generated images.");
      return;
    }

    setPdfImageGenProgress({ current: 0, total: enabledItems.length });

    for (let i = 0; i < enabledItems.length; i++) {
      const { item, index } = enabledItems[i];
      setPdfImageGenProgress({ current: i + 1, total: enabledItems.length });

      // Mark as generating
      setPdfImportState((prev) => {
        if (!prev) return prev;
        const items = [...prev.items];
        items[index] = { ...items[index], imageGenStatus: "generating" };
        return { ...prev, items };
      });

      try {
        const result = await generateMenuItemImage({
          itemName: item.name,
          imageDescription: item.imageDescription,
          cuisineContext: "",
        });

        setPdfImportState((prev) => {
          if (!prev) return prev;
          const items = [...prev.items];
          items[index] = { ...items[index], generatedImageUrl: result.url, imageGenStatus: "done" };
          return { ...prev, items };
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Image generation failed";
        setPdfImportState((prev) => {
          if (!prev) return prev;
          const items = [...prev.items];
          items[index] = { ...items[index], imageGenStatus: "error", imageGenError: message };
          return { ...prev, items };
        });
      }
    }

    setPdfImageGenProgress(null);
    setPdfNotice("Image generation complete.");
  };

  const handlePdfRegenerateImage = async (index: number) => {
    if (!pdfImportState) return;
    const item = pdfImportState.items[index];
    if (!item) return;

    setPdfImportState((prev) => {
      if (!prev) return prev;
      const items = [...prev.items];
      items[index] = { ...items[index], imageGenStatus: "generating", imageGenError: undefined };
      return { ...prev, items };
    });

    try {
      const result = await generateMenuItemImage({
        itemName: item.name,
        imageDescription: item.imageDescription,
        cuisineContext: "",
      });
      setPdfImportState((prev) => {
        if (!prev) return prev;
        const items = [...prev.items];
        items[index] = { ...items[index], generatedImageUrl: result.url, imageGenStatus: "done" };
        return { ...prev, items };
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Image generation failed";
      setPdfImportState((prev) => {
        if (!prev) return prev;
        const items = [...prev.items];
        items[index] = { ...items[index], imageGenStatus: "error", imageGenError: message };
        return { ...prev, items };
      });
    }
  };

  const handlePreviewPdf = () => {
    if (!pubkey || !pdfImportState) return;
    setPdfError(null);
    setPdfPreviewLoading(true);
    try {
      const { menus, items } = pdfStateToSpreadsheetRows(pdfImportState);
      const events = buildSpreadsheetPreviewEvents({
        merchantPubkey: pubkey,
        menus,
        items,
      });
      setPdfPreviewEvents(events);
      setPreviewEvents(events);
      setPreviewPendingCount(events.length);
      setPreviewTotalEvents(events.length);
      setPreviewDeletionCount(0);
      setPreviewOpen(true);
      setPdfPreviewViewed(true);
      setPreviewViewed(true);
      setActiveSource("pdf");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to build preview from PDF data.";
      setPdfError(message);
    } finally {
      setPdfPreviewLoading(false);
    }
  };

  const handlePublishPdf = async () => {
    if (!pubkey) return;
    if (!pdfPreviewEvents || pdfPreviewEvents.length === 0) {
      setPdfError("No preview events. Please preview before publishing.");
      return;
    }
    setPdfError(null);
    setPdfNotice(null);
    setSynvyaError(null);
    setPdfPublishBusy(true);
    try {
      setPublishStep("nostr");
      const publishedIds: string[] = [];
      const ordered = [
        ...pdfPreviewEvents.filter((e) => e.kind === 30402),
        ...pdfPreviewEvents.filter((e) => e.kind === 30405),
      ];
      const publishedMenuEvents = [...ordered];
      for (const template of ordered) {
        const signed = await signEvent(template as any);
        validateEvent(signed);
        await publishToRelays(signed, relays);
        publishedIds.push(signed.id);
      }
      setPdfPreviewViewed(false);
      setPreviewViewed(false);
      setPdfPreviewEvents(null);
      setPreviewEvents(null);
      setPublishSuccess(true);
      setMenuPublished(true);
      if (activeSource === "pdf") {
        setActiveSource(null);
      }

      setPublishStep("synvya");
      try {
        const discoveryResult = await fetchAndPublishDiscovery(pubkey, relays, publishedMenuEvents);
        setDiscoveryPageUrl(discoveryResult.url);
        setLastPublishedHtml(discoveryResult.html);
        setPdfNotice(`Published ${publishedIds.length} event${publishedIds.length === 1 ? "" : "s"} and updated discovery page.`);
      } catch (synvyaErr) {
        console.error("Failed to publish to Synvya.com:", synvyaErr);
        const errorMessage = synvyaErr instanceof Error ? synvyaErr.message : "Failed to publish discovery page";
        setSynvyaError(errorMessage);
        setPdfNotice(`Published ${publishedIds.length} event${publishedIds.length === 1 ? "" : "s"} (discovery page update failed).`);
      }
      void refreshManagerData();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to publish PDF menu.";
      setPdfError(message);
    } finally {
      setPdfPublishBusy(false);
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
      setPreviewViewed(false);
      setPreviewEvents(null);
      setActiveSource(null);
      setPublishSuccess(false);
      await refreshManagerData();
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
    setSynvyaError(null);
    setResyncBusy(true);
    try {
      // Step 1: Publish to Nostr
      setPublishStep("nostr");
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

      // Collect menu events for discovery publish fallback (exclude deletion events)
      const squareMenuEvents = events.filter((e) => e.kind === 30402 || e.kind === 30405);

      // Helper to publish discovery page after successful Nostr publish
      const publishDiscovery = async (): Promise<{ success: boolean; url?: string; error?: string }> => {
        setPublishStep("synvya");
        try {
          const discoveryResult = await fetchAndPublishDiscovery(pubkey, relays, squareMenuEvents);
          setDiscoveryPageUrl(discoveryResult.url);
          setLastPublishedHtml(discoveryResult.html);
          return { success: true, url: discoveryResult.url };
        } catch (synvyaErr) {
          console.error("Failed to publish to Synvya.com:", synvyaErr);
          const errorMessage = synvyaErr instanceof Error ? synvyaErr.message : "Failed to publish discovery page";
          setSynvyaError(errorMessage);
          return { success: false, error: errorMessage };
        }
      };

      if (!events.length) {
        setStatusVersion((value) => value + 1);
        setPreviewViewed(false);
        setPreviewEvents(null);
        setPublishSuccess(true);
        setMenuPublished(true);
        // Step 2: Publish discovery page
        const discoveryResult = await publishDiscovery();
        if (discoveryResult.success) {
          setSquareNotice("Square catalog is already up to date. Discovery page updated.");
        } else {
          setSquareNotice("Square catalog is already up to date (discovery page update failed).");
        }
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
        setStatusVersion((value) => value + 1);
        setPreviewViewed(false);
        setPreviewEvents(null);
        setPublishSuccess(true);
        setMenuPublished(true);
        // Step 2: Publish discovery page after successful Nostr publish
        const discoveryResult = await publishDiscovery();
        if (discoveryResult.success) {
          messages.push("Discovery page updated.");
        } else {
          messages.push("(Discovery page update failed)");
        }
        setSquareNotice(messages.join(" "));
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
        setStatusVersion((value) => value + 1);
        setPreviewViewed(false);
        setPreviewEvents(null);
        setPublishSuccess(true);
        setMenuPublished(true);
        // Step 2: Publish discovery page
        const discoveryResult = await publishDiscovery();
        if (discoveryResult.success) {
          setSquareNotice("No listings required publishing. Discovery page updated.");
        } else {
          setSquareNotice("No listings required publishing (discovery page update failed).");
        }
      }
      void refreshManagerData();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to publish catalog to Nostr.";
      setSquareError(message);
    } finally {
      setResyncBusy(false);
      setPublishStep(null);
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

  // Auto-refresh manager on mount when pubkey is available
  useEffect(() => {
    if (pubkey && pageMode === "manager") {
      void refreshManagerData();
    }
  }, [pubkey, pageMode, refreshManagerData]);

  const handleDeleteItems = async (addresses: string[]) => {
    if (!pubkey) return;

    // Send kind 5 deletion request (relays may or may not honor it)
    const deletionEvent = buildDeletionEventByAddress(addresses, [30402], "removing menu items");
    const signed = await signEvent(deletionEvent);
    validateEvent(signed);
    await publishToRelays(signed, relays);

    // Republish each item with ["visibility", "<hidden"] so our software ignores it
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

    // Rebuild the 30402 event preserving existing tags except title, price, image
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
    setActiveSource(null);
    setPreviewViewed(false);
    setSheetPreviewViewed(false);
    setPreviewEvents(null);
    setSheetPreviewEvents(null);
    setPdfPreviewViewed(false);
    setPdfPreviewEvents(null);
    setPdfImportState(null);
    setPdfError(null);
    setPdfNotice(null);
    setPublishSuccess(false);
  };

  return (
    <div className="container space-y-6 py-10">
      {/* Profile-first guard - Show when profile is not published */}
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

      {/* Source Selection - Show when no source is selected */}
      {!selectedSource && !publishSuccess && (
        <section className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold">Choose Your Menu Source</h2>
            <p className="text-sm text-muted-foreground">
              Select how you'd like to import your menu items.
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            {/* Square Option */}
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

            {/* PDF Option */}
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

            {/* Spreadsheet Option */}
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

          {/* Workflow Step Indicator */}
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

          {/* Publishing progress indicator */}
          {resyncBusy && publishStep && (
            <div className="flex items-center gap-3 rounded-md border bg-muted/50 p-3 text-sm">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              <div className="flex items-center gap-2">
                <span className={
                  publishStep === "nostr"
                    ? "text-primary font-medium"
                    : "text-emerald-600"
                }>
                  {publishStep === "nostr" ? "1. Publishing to Nostr" : "1. Published"}
                </span>
                <span className="text-muted-foreground">→</span>
                <span className={publishStep === "synvya" ? "text-primary font-medium" : ""}>
                  2. Updating discovery page
                </span>
              </div>
            </div>
          )}

          {/* Synvya.com error with contact support option */}
          {synvyaError && (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
              <p className="font-medium text-amber-800">Discovery page update failed</p>
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
          {currentStep === 1 && (
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

          {/* Step 2 & 3: Connected - Show status and actions */}
          {squareStatus?.connected && currentStep >= 2 && (
            <div className="space-y-4">
              <div className="grid gap-6 md:grid-cols-2">
                <div className="grid gap-4 text-sm">
                  {squareLoading ? (
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <div className="h-4 w-4 animate-spin rounded-full border border-primary border-t-transparent" />
                      <span>Checking Square connection…</span>
                    </div>
                  ) : (
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
                  )}
                </div>

                <div className="rounded-md border bg-muted/30 p-4 text-sm">
                  <h3 className="mb-3 font-medium text-foreground">What Gets Published</h3>
                  <ul className="space-y-1.5 text-muted-foreground">
                    <li className="flex items-start gap-2">
                      <span className="mt-0.5">•</span>
                      <span>Title, Description, Price</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="mt-0.5">•</span>
                      <span>Location & Categories</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="mt-0.5">•</span>
                      <span>Pictures (if available)</span>
                    </li>
                  </ul>
                </div>
              </div>

              {/* Step 2: Review */}
              {currentStep === 2 && (
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground">Review your menu before publishing to Nostr.</p>
                  <Button onClick={handlePreviewSquare} disabled={previewLoading || squareLoading}>
                    {previewLoading ? "Loading Preview…" : "Review Menu Before Publishing"}
                  </Button>
                </div>
              )}

              {/* Step 3: Publish */}
              {currentStep === 3 && (
                <div className="space-y-3 rounded-md border bg-muted/30 p-4">
                  <p className="text-sm font-medium">Ready to publish your menu?</p>
                  <p className="text-sm text-muted-foreground">
                    {previewPendingCount} item{previewPendingCount === 1 ? "" : "s"} will be published to your Nostr relays.
                  </p>
                  <div className="flex flex-wrap gap-3">
                    <Button
                      onClick={() => setPublishConfirmOpen(true)}
                      disabled={resyncBusy}
                    >
                      {resyncBusy ? "Publishing…" : "Publish Menu"}
                    </Button>
                    <Button onClick={handlePreviewSquare} disabled={previewLoading} variant="outline">
                      <RefreshCw className="mr-2 h-4 w-4" />
                      {previewLoading ? "Loading…" : "Review Again"}
                    </Button>
                  </div>
                </div>
              )}

              <div className="flex flex-wrap gap-3 border-t pt-4">
                <Button variant="ghost" onClick={handleConnectSquare} disabled={connectBusy}>
                  {connectBusy ? "Opening Square…" : "Reconnect Square"}
                </Button>
                <Button onClick={handleUnpublishMenu} disabled={unpublishBusy} variant="destructive">
                  {unpublishBusy ? "Unpublishing…" : "Unpublish Menu"}
                </Button>
              </div>
            </div>
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
                <DialogTitle>Publish Menu</DialogTitle>
                <DialogDescription>
                  This action will make your menu visible to AI assistants.
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
                    if (activeSource === "square" || selectedSource === "square") {
                      await handleResyncSquare();
                      return;
                    }
                    if (activeSource === "spreadsheet" || selectedSource === "spreadsheet") {
                      await handlePublishSpreadsheet();
                      return;
                    }
                    if (activeSource === "pdf" || selectedSource === "pdf") {
                      await handlePublishPdf();
                      return;
                    }
                  }}
                  disabled={resyncBusy || sheetPublishBusy || pdfPublishBusy}
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

          {pdfError ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              {pdfError}
            </div>
          ) : null}

          {pdfNotice ? (
            <div className="rounded-md border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm text-emerald-600">
              {pdfNotice}
            </div>
          ) : null}

          {/* Publishing progress indicator */}
          {pdfPublishBusy && publishStep && (
            <div className="flex items-center gap-3 rounded-md border bg-muted/50 p-3 text-sm">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              <div className="flex items-center gap-2">
                <span className={publishStep === "nostr" ? "text-primary font-medium" : "text-emerald-600"}>
                  {publishStep === "nostr" ? "1. Publishing to Nostr" : "1. Published"}
                </span>
                <span className="text-muted-foreground">&rarr;</span>
                <span className={publishStep === "synvya" ? "text-primary font-medium" : ""}>
                  2. Updating discovery page
                </span>
              </div>
            </div>
          )}

          {synvyaError && (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
              <p className="font-medium text-amber-800">Discovery page update failed</p>
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

          {/* Step 2: Review & Enhance */}
          {currentStep === 2 && pdfImportState && (
            <div className="space-y-4">
              {pdfFileName && (
                <div className="rounded-md border bg-muted/30 p-3 text-sm">
                  <span className="font-medium">Loaded:</span> {pdfFileName} &mdash;{" "}
                  {pdfImportState.items.length} item{pdfImportState.items.length === 1 ? "" : "s"},{" "}
                  {pdfImportState.menus.length} menu{pdfImportState.menus.length === 1 ? "" : "s"}/section{pdfImportState.menus.length === 1 ? "" : "s"}
                </div>
              )}

              {/* Extracted items grouped by menu > section */}
              <div className="max-h-[32rem] space-y-4 overflow-y-auto rounded-md border p-3">
                {(() => {
                  // Group items: menu → section → items
                  const grouped = new Map<string, Map<string, { item: PdfReviewItem; idx: number }[]>>();
                  pdfImportState.items.forEach((item, idx) => {
                    const menu = item.partOfMenu || "Menu";
                    const section = item.partOfMenuSection || "";
                    if (!grouped.has(menu)) grouped.set(menu, new Map());
                    const menuMap = grouped.get(menu)!;
                    if (!menuMap.has(section)) menuMap.set(section, []);
                    menuMap.get(section)!.push({ item, idx });
                  });
                  return Array.from(grouped.entries()).map(([menuName, sections]) => (
                    <div key={menuName}>
                      <h4 className="mb-2 text-sm font-semibold">{menuName}</h4>
                      {Array.from(sections.entries()).map(([sectionName, entries]) => (
                        <div key={sectionName} className="mb-3 ml-2">
                          {sectionName && (
                            <h5 className="mb-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wide">{sectionName}</h5>
                          )}
                          <div className="space-y-1.5">
                            {entries.map(({ item, idx }) => (
                              <div key={idx} className="flex items-start gap-3 rounded-md border bg-background px-3 py-2 text-sm">
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2">
                                    <span className="font-medium">{item.name}</span>
                                    {item.price && (
                                      <span className="text-muted-foreground">${item.price}</span>
                                    )}
                                  </div>
                                  <p className="mt-0.5 text-muted-foreground text-xs">
                                    {item.enrichedDescription || item.description || "No description"}
                                  </p>
                                  {item.enrichedDescription && item.description && (
                                    <p className="mt-0.5 text-xs text-muted-foreground/70 line-through">
                                      {item.description}
                                    </p>
                                  )}
                                  {item.ingredients.length > 0 && (
                                    <p className="mt-0.5 text-xs text-muted-foreground/60">
                                      {item.ingredients.join(", ")}
                                    </p>
                                  )}
                                </div>
                                <div className="flex items-center gap-1.5 shrink-0">
                                  {item.imageGenStatus === "generating" && (
                                    <Loader2 className="h-4 w-4 animate-spin text-primary" />
                                  )}
                                  {item.imageGenStatus === "done" && item.generatedImageUrl && (
                                    <div className="flex items-center gap-1">
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setPdfLightboxUrl(item.generatedImageUrl!);
                                          setPdfLightboxName(item.name);
                                        }}
                                        className="rounded focus:outline-none focus:ring-2 focus:ring-primary"
                                      >
                                        <img
                                          src={item.generatedImageUrl}
                                          alt={item.name}
                                          className="h-10 w-10 rounded object-cover cursor-pointer hover:opacity-80 transition-opacity"
                                        />
                                      </button>
                                      <button
                                        type="button"
                                        title="Regenerate image"
                                        onClick={() => void handlePdfRegenerateImage(idx)}
                                        className="rounded p-0.5 text-muted-foreground hover:text-primary transition-colors"
                                      >
                                        <RefreshCw className="h-3.5 w-3.5" />
                                      </button>
                                    </div>
                                  )}
                                  {item.imageGenStatus === "error" && (
                                    <div className="flex items-center gap-1">
                                      <span className="text-xs text-destructive" title={item.imageGenError}>
                                        Failed
                                      </span>
                                      <button
                                        type="button"
                                        title="Retry image generation"
                                        onClick={() => void handlePdfRegenerateImage(idx)}
                                        className="rounded p-0.5 text-muted-foreground hover:text-primary transition-colors"
                                      >
                                        <RefreshCw className="h-3.5 w-3.5" />
                                      </button>
                                    </div>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  ));
                })()}
              </div>

              {/* Enhancement actions */}
              <div className="flex flex-wrap gap-3">
                <Button
                  onClick={handlePdfEnrich}
                  disabled={pdfEnriching}
                  variant="outline"
                  size="sm"
                >
                  {pdfEnriching ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Enriching descriptions...
                    </>
                  ) : (
                    <>
                      <Sparkles className="mr-2 h-4 w-4" />
                      Enhance Descriptions
                    </>
                  )}
                </Button>
                <Button
                  onClick={handlePdfGenerateImages}
                  disabled={pdfImageGenProgress !== null}
                  variant="outline"
                  size="sm"
                >
                  {pdfImageGenProgress ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Generating images ({pdfImageGenProgress.current}/{pdfImageGenProgress.total})...
                    </>
                  ) : (
                    <>
                      <ImageIcon className="mr-2 h-4 w-4" />
                      Generate Photos
                    </>
                  )}
                </Button>
              </div>

              {/* Publish & other actions */}
              <div className="flex flex-wrap gap-3">
                <Button
                  onClick={() => {
                    // Build preview events then open confirm dialog
                    handlePreviewPdf();
                    setPublishConfirmOpen(true);
                  }}
                  disabled={pdfPreviewLoading || pdfPublishBusy}
                >
                  {pdfPublishBusy ? "Publishing..." : "Publish Menu"}
                </Button>
                <label className="cursor-pointer">
                  <input
                    type="file"
                    accept=".pdf,image/*"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void handlePdfUpload(f);
                    }}
                  />
                  <Button type="button" variant="outline" asChild>
                    <span>Upload Different File</span>
                  </Button>
                </label>
              </div>
            </div>
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
                <DialogTitle>Publish Menu</DialogTitle>
                <DialogDescription>
                  This action will make your menu visible to AI assistants.
                  {pdfPreviewViewed && previewPendingCount > 0 && (
                    <span className="block mt-2">
                      You are about to publish {previewPendingCount} listing{previewPendingCount === 1 ? "" : "s"}.
                    </span>
                  )}
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" onClick={() => setPublishConfirmOpen(false)} disabled={pdfPublishBusy}>
                  Cancel
                </Button>
                <Button
                  onClick={async () => {
                    setPublishConfirmOpen(false);
                    await handlePublishPdf();
                  }}
                  disabled={pdfPublishBusy}
                >
                  Publish
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* Image lightbox */}
          <Dialog open={pdfLightboxUrl !== null} onOpenChange={(open) => { if (!open) setPdfLightboxUrl(null); }}>
            <DialogContent className="max-w-lg p-2">
              <DialogHeader className="px-2 pt-2">
                <DialogTitle className="text-sm">{pdfLightboxName}</DialogTitle>
              </DialogHeader>
              {pdfLightboxUrl && (
                <img
                  src={pdfLightboxUrl}
                  alt={pdfLightboxName}
                  className="w-full rounded object-contain"
                />
              )}
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

          {/* Workflow Step Indicator */}
          <WorkflowStepIndicator currentStep={currentStep} source="spreadsheet" />

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

          {/* Publishing progress indicator */}
          {sheetPublishBusy && publishStep && (
            <div className="flex items-center gap-3 rounded-md border bg-muted/50 p-3 text-sm">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              <div className="flex items-center gap-2">
                <span className={
                  publishStep === "nostr"
                    ? "text-primary font-medium"
                    : "text-emerald-600"
                }>
                  {publishStep === "nostr" ? "1. Publishing to Nostr" : "1. Published"}
                </span>
                <span className="text-muted-foreground">→</span>
                <span className={publishStep === "synvya" ? "text-primary font-medium" : ""}>
                  2. Updating discovery page
                </span>
              </div>
            </div>
          )}

          {/* Synvya.com error with contact support option */}
          {synvyaError && (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
              <p className="font-medium text-amber-800">Discovery page update failed</p>
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

          {/* Step 2: Review */}
          {currentStep === 2 && sheetParsed && (
            <div className="space-y-4">
              {sheetFileName && (
                <div className="rounded-md border bg-muted/30 p-3 text-sm">
                  <span className="font-medium">Loaded:</span> {sheetFileName}
                </div>
              )}
              <p className="text-sm text-muted-foreground">Review your menu before publishing to Nostr.</p>
              <div className="flex flex-wrap gap-3">
                <Button
                  onClick={handlePreviewSpreadsheet}
                  disabled={sheetPreviewLoading}
                >
                  {sheetPreviewLoading ? "Loading Preview…" : "Review Menu Before Publishing"}
                </Button>
                <label className="cursor-pointer">
                  <input
                    type="file"
                    accept=".xlsx"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void handleSpreadsheetUpload(f);
                    }}
                  />
                  <Button type="button" variant="outline" asChild>
                    <span>Upload Different File</span>
                  </Button>
                </label>
              </div>
            </div>
          )}

          {/* Step 3: Publish */}
          {currentStep === 3 && sheetPreviewViewed && (
            <div className="space-y-4">
              {sheetFileName && (
                <div className="rounded-md border bg-muted/30 p-3 text-sm">
                  <span className="font-medium">Loaded:</span> {sheetFileName}
                </div>
              )}
              <div className="space-y-3 rounded-md border bg-muted/30 p-4">
                <p className="text-sm font-medium">Ready to publish your menu?</p>
                <p className="text-sm text-muted-foreground">
                  {previewPendingCount} item{previewPendingCount === 1 ? "" : "s"} will be published to your Nostr relays.
                </p>
                <div className="flex flex-wrap gap-3">
                  <Button
                    onClick={() => setPublishConfirmOpen(true)}
                    disabled={sheetPublishBusy}
                  >
                    {sheetPublishBusy ? "Publishing…" : "Publish Menu"}
                  </Button>
                  <Button onClick={handlePreviewSpreadsheet} disabled={sheetPreviewLoading} variant="outline">
                    <RefreshCw className="mr-2 h-4 w-4" />
                    {sheetPreviewLoading ? "Loading…" : "Review Again"}
                  </Button>
                </div>
              </div>

              <div className="flex flex-wrap gap-3 border-t pt-4">
                <Button onClick={handleUnpublishMenu} disabled={unpublishBusy} variant="destructive">
                  {unpublishBusy ? "Unpublishing…" : "Unpublish Menu"}
                </Button>
              </div>
            </div>
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
                <DialogTitle>Publish Menu</DialogTitle>
                <DialogDescription>
                  This action will make your menu visible to AI assistants.
                  {sheetPreviewViewed && previewPendingCount > 0 && (
                    <span className="block mt-2">
                      You are about to publish {previewPendingCount} listing{previewPendingCount === 1 ? "" : "s"}.
                    </span>
                  )}
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" onClick={() => setPublishConfirmOpen(false)} disabled={sheetPublishBusy}>
                  Cancel
                </Button>
                <Button
                  onClick={async () => {
                    setPublishConfirmOpen(false);
                    await handlePublishSpreadsheet();
                  }}
                  disabled={sheetPublishBusy}
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
