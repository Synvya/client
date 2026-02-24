import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, RefreshCw, Sparkles, ImageIcon } from "lucide-react";
import type { MenuReviewState, MenuReviewItem } from "@/lib/menuImport/types";

interface MenuReviewPanelProps {
  reviewState: MenuReviewState;
  enriching: boolean;
  imageGenProgress: { current: number; total: number } | null;
  publishBusy: boolean;
  onEnrich: () => void;
  onGenerateImages: () => void;
  onRegenerateImage: (index: number) => void;
  onPublish: () => void;
  onReUpload?: () => void;
  reUploadLabel?: string;
  reUploadAccept?: string;
}

export function MenuReviewPanel({
  reviewState,
  enriching,
  imageGenProgress,
  publishBusy,
  onEnrich,
  onGenerateImages,
  onRegenerateImage,
  onPublish,
  onReUpload,
  reUploadLabel,
  reUploadAccept,
}: MenuReviewPanelProps): JSX.Element {
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [lightboxName, setLightboxName] = useState<string>("");

  return (
    <div className="space-y-4">
      {/* Summary bar */}
      <div className="rounded-md border bg-muted/30 p-3 text-sm">
        <span className="font-medium">Loaded:</span> {reviewState.fileName} &mdash;{" "}
        {reviewState.items.length} item{reviewState.items.length === 1 ? "" : "s"},{" "}
        {reviewState.menus.length} menu{reviewState.menus.length === 1 ? "" : "s"}/section{reviewState.menus.length === 1 ? "" : "s"}
      </div>

      {/* Grouped item list */}
      <div className="max-h-[32rem] space-y-4 overflow-y-auto rounded-md border p-3">
        {(() => {
          const grouped = new Map<string, Map<string, { item: MenuReviewItem; idx: number }[]>>();
          reviewState.items.forEach((item, idx) => {
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
                                  setLightboxUrl(item.generatedImageUrl!);
                                  setLightboxName(item.name);
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
                                onClick={() => onRegenerateImage(idx)}
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
                                onClick={() => onRegenerateImage(idx)}
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
          onClick={onEnrich}
          disabled={enriching}
          variant="outline"
          size="sm"
        >
          {enriching ? (
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
          onClick={onGenerateImages}
          disabled={imageGenProgress !== null}
          variant="outline"
          size="sm"
        >
          {imageGenProgress ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Generating images ({imageGenProgress.current}/{imageGenProgress.total})...
            </>
          ) : (
            <>
              <ImageIcon className="mr-2 h-4 w-4" />
              Generate Photos
            </>
          )}
        </Button>
      </div>

      {/* Publish & re-upload */}
      <div className="flex flex-wrap gap-3">
        <Button
          onClick={onPublish}
          disabled={publishBusy}
        >
          {publishBusy ? "Publishing..." : "Publish Menu"}
        </Button>
        {onReUpload && (
          <Button type="button" variant="outline" onClick={onReUpload}>
            {reUploadLabel || "Upload Different File"}
          </Button>
        )}
      </div>

      {/* Image lightbox */}
      <Dialog open={lightboxUrl !== null} onOpenChange={(open) => { if (!open) setLightboxUrl(null); }}>
        <DialogContent className="max-w-lg p-2">
          <DialogHeader className="px-2 pt-2">
            <DialogTitle className="text-sm">{lightboxName}</DialogTitle>
          </DialogHeader>
          {lightboxUrl && (
            <img
              src={lightboxUrl}
              alt={lightboxName}
              className="w-full rounded object-contain"
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
