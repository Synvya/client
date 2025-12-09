import { SquareEventTemplate } from "@/services/square";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { MapPin, Tag, DollarSign, Image as ImageIcon, Trash2, Package, UtensilsCrossed } from "lucide-react";

interface PublicationPreviewProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  events: SquareEventTemplate[];
  pendingCount: number;
  totalEvents: number;
  deletionCount?: number;
}

function extractTagValue(tags: string[][], tagName: string): string | null {
  const tag = tags.find((t) => Array.isArray(t) && t.length >= 2 && t[0] === tagName);
  return tag && tag[1] ? tag[1] : null;
}

function extractTagValues(tags: string[][], tagName: string): string[] {
  return tags
    .filter((t) => Array.isArray(t) && t.length >= 2 && t[0] === tagName)
    .map((t) => t[1])
    .filter((v): v is string => Boolean(v));
}

function formatPrice(priceTag: string[], currency?: string): string | null {
  if (!priceTag || priceTag.length < 2) return null;
  const amount = priceTag[1];
  const curr = currency || priceTag[2] || "USD";
  try {
    const numAmount = parseFloat(amount);
    if (isNaN(numAmount)) return null;
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: curr,
    }).format(numAmount);
  } catch {
    return `${amount} ${curr}`;
  }
}

export function PublicationPreview({
  open,
  onOpenChange,
  events,
  pendingCount,
  totalEvents,
  deletionCount = 0,
}: PublicationPreviewProps): JSX.Element {
  const updateCount = pendingCount - deletionCount;
  const hasDeletions = deletionCount > 0;
  const hasUpdates = updateCount > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Preview Publication</DialogTitle>
          <DialogDescription>
            {pendingCount === 0 && !hasDeletions
              ? "No new listings to publish. All items are up to date."
              : (
                <div className="space-y-1">
                  {hasUpdates && (
                    <div>
                      Previewing {updateCount} item{updateCount === 1 ? "" : "s"} (products and collections) to {updateCount === 1 ? "update" : "update or create"}.
                    </div>
                  )}
                  {hasDeletions && (
                    <div className="text-orange-600 dark:text-orange-400">
                      {deletionCount} item{deletionCount === 1 ? "" : "s"} will be deleted.
                    </div>
                  )}
                </div>
              )}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto pr-2 space-y-6">
          {events.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <p>No items to preview.</p>
            </div>
          ) : (
            events.map((event, index) => {
              const isDeletion = event._isDeletion === true;
              const isCollection = event.kind === 30405;
              const isProduct = event.kind === 30402;
              const title = extractTagValue(event.tags, "title");
              const summary = extractTagValue(event.tags, "summary");
              const location = extractTagValue(event.tags, "location");
              const images = extractTagValues(event.tags, "image");
              const priceTag = event.tags.find((t) => Array.isArray(t) && t[0] === "price");
              const price = priceTag ? formatPrice(priceTag) : null;
              
              // Extract collection references (a tags for kind 30405)
              // Format: ["a", "30405:<pubkey>:<d-tag>"]
              const collectionRefs = event.tags
                .filter((t) => Array.isArray(t) && t[0] === "a" && typeof t[1] === "string" && t[1].startsWith("30405:"))
                .map((t) => {
                  // Parse "30405:<pubkey>:<d-tag>" to extract d-tag (collection name)
                  const parts = (t[1] as string).split(":");
                  return parts.length >= 3 ? parts[2] : null;
                })
                .filter((v): v is string => v !== null);
              
              // Extract suitableForDiet tags
              const suitableForDiet = extractTagValues(event.tags, "schema.org:MenuItem:suitableForDiet");
              
              // Extract t tags (dietary preferences only - ingredients are now in contains tags)
              const tTags = extractTagValues(event.tags, "t");

              return (
                <div
                  key={index}
                  className={`rounded-lg border p-4 space-y-3 shadow-sm ${
                    isDeletion
                      ? "bg-orange-50 dark:bg-orange-950/20 border-orange-200 dark:border-orange-800"
                      : isCollection
                      ? "bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800"
                      : "bg-card"
                  }`}
                >
                  {isDeletion && (
                    <div className="flex items-center gap-2 text-orange-600 dark:text-orange-400 font-semibold mb-2">
                      <Trash2 className="h-4 w-4" />
                      <span>Will be deleted</span>
                    </div>
                  )}
                  {isCollection && !isDeletion && (
                    <div className="flex items-center gap-2 text-blue-600 dark:text-blue-400 font-semibold mb-2">
                      <Package className="h-4 w-4" />
                      <span>Collection</span>
                    </div>
                  )}
                  {title && (
                    <h3 className="text-lg font-semibold text-foreground">{title}</h3>
                  )}

                  {images.length > 0 && (
                    <div className="flex gap-2 overflow-x-auto pb-2">
                      {images.map((imgUrl, imgIndex) => (
                        <img
                          key={imgIndex}
                          src={imgUrl}
                          alt={title || `Listing image ${imgIndex + 1}`}
                          className="h-32 w-32 object-cover rounded-md border flex-shrink-0"
                          onError={(e) => {
                            const target = e.target as HTMLImageElement;
                            target.style.display = "none";
                          }}
                        />
                      ))}
                    </div>
                  )}

                  {summary && (
                    <p className="text-sm text-muted-foreground">{summary}</p>
                  )}

                  {event.content && (
                    <div className="text-sm text-foreground whitespace-pre-wrap">
                      {event.content.split("\n").map((line, lineIndex) => {
                        if (line.startsWith("**") && line.endsWith("**")) {
                          return (
                            <p key={lineIndex} className="font-semibold mb-1">
                              {line.slice(2, -2)}
                            </p>
                          );
                        }
                        return <p key={lineIndex}>{line}</p>;
                      })}
                    </div>
                  )}

                  <div className="flex flex-wrap gap-4 text-sm text-muted-foreground pt-2 border-t">
                    {price && (
                      <div className="flex items-center gap-1.5">
                        <DollarSign className="h-4 w-4" />
                        <span className="font-medium text-foreground">{price}</span>
                      </div>
                    )}

                    {location && (
                      <div className="flex items-center gap-1.5">
                        <MapPin className="h-4 w-4" />
                        <span>{location}</span>
                      </div>
                    )}

                    {collectionRefs.length > 0 && (
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <Package className="h-4 w-4" />
                        <span className="text-xs">Part of:</span>
                        <div className="flex gap-1.5 flex-wrap">
                          {collectionRefs.map((collectionName, refIndex) => (
                            <span
                              key={refIndex}
                              className="px-2 py-0.5 rounded-md bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 text-xs font-medium"
                            >
                              {collectionName} Menu
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {suitableForDiet.length > 0 && (
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <UtensilsCrossed className="h-4 w-4" />
                        <span className="text-xs">Dietary:</span>
                        <div className="flex gap-1.5 flex-wrap">
                          {suitableForDiet.map((diet, dietIndex) => (
                            <span
                              key={dietIndex}
                              className="px-2 py-0.5 rounded-md bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 text-xs font-medium"
                            >
                              {diet.replace(/_/g, " ")}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {tTags.length > 0 && (
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <Tag className="h-4 w-4" />
                        <div className="flex gap-1.5 flex-wrap">
                          {tTags.map((tag, tagIndex) => (
                            <span
                              key={tagIndex}
                              className="px-2 py-0.5 rounded-md bg-muted text-xs"
                            >
                              {tag.replace(/_/g, " ")}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
