import { useEffect, useState } from "react";
import type { Offer } from "@/types/loyalty";
import { parseOfferEvent } from "@/lib/offerEvents";
import { getPool } from "@/lib/relayPool";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { CalendarIcon, Edit, XCircle } from "lucide-react";

interface OffersListProps {
  /** Merchant's public key */
  pubkey: string;
  /** Relay URLs to query */
  relays: string[];
  /** Callback when edit is clicked */
  onEdit: (offer: Offer) => void;
  /** Callback when deactivate is confirmed */
  onDeactivate: (offer: Offer) => Promise<void>;
}

type FilterStatus = "all" | "active" | "inactive";

/**
 * Format date for display
 */
function formatDate(date: Date): string {
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * Check if an offer is currently valid based on dates
 */
function isOfferExpired(offer: Offer): boolean {
  if (offer.status !== "active") return false;
  const now = new Date();
  return now > offer.validUntil;
}

/**
 * Format offer type for display
 * Converts type codes to user-friendly labels
 */
function formatOfferType(type: string): string {
  if (type === "bogo") return "BOGO";
  return type
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function OffersList({
  pubkey,
  relays,
  onEdit,
  onDeactivate,
}: OffersListProps): JSX.Element {
  const [offers, setOffers] = useState<Offer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterStatus>("active");
  const [deactivating, setDeactivating] = useState<string | null>(null);
  const [offerToDeactivate, setOfferToDeactivate] = useState<Offer | null>(null);

  useEffect(() => {
    if (!pubkey || !relays.length) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    const pool = getPool();
    const targets = Array.from(new Set(relays.map((relay) => relay.trim()).filter(Boolean)));

    if (!targets.length) {
      setError("No relays configured");
      setLoading(false);
      return;
    }

    // Subscribe to kind:31556 events from this merchant
    const sub = pool.subscribeMany(
      targets,
      {
        kinds: [31556],
        authors: [pubkey],
      },
      {
        onevent(event) {
          const offer = parseOfferEvent(event);
          if (offer) {
            setOffers((prev) => {
              // Check if we already have this offer (by code/d tag)
              const existingIndex = prev.findIndex((o) => o.code === offer.code);
              if (existingIndex >= 0) {
                // Update existing offer (replaceable event)
                const updated = [...prev];
                updated[existingIndex] = offer;
                return updated;
              } else {
                // Add new offer
                return [...prev, offer];
              }
            });
          }
        },
        oneose() {
          // End of stored events - stop loading
          setLoading(false);
        },
      }
    );

    // Cleanup subscription on unmount
    return () => {
      sub.close();
    };
  }, [pubkey, relays]);

  /**
   * Handle deactivate button click
   */
  function handleDeactivateClick(offer: Offer) {
    setOfferToDeactivate(offer);
  }

  /**
   * Confirm deactivation
   */
  async function confirmDeactivate() {
    if (!offerToDeactivate) return;

    try {
      setDeactivating(offerToDeactivate.code);
      await onDeactivate(offerToDeactivate);
      setOfferToDeactivate(null);
    } catch (error) {
      console.error("Error deactivating offer:", error);
      // Error handling is done in parent component
    } finally {
      setDeactivating(null);
    }
  }

  /**
   * Filter offers based on selected filter
   */
  const filteredOffers = offers.filter((offer) => {
    if (filter === "all") return true;
    if (filter === "active") return offer.status === "active";
    if (filter === "inactive") return offer.status === "inactive";
    return true;
  });

  /**
   * Sort offers: active first (by validUntil desc), then inactive (by createdAt desc)
   */
  const sortedOffers = [...filteredOffers].sort((a, b) => {
    // Active offers first
    if (a.status === "active" && b.status === "inactive") return -1;
    if (a.status === "inactive" && b.status === "active") return 1;

    // Within active offers, sort by validUntil (descending - latest expiry first)
    if (a.status === "active" && b.status === "active") {
      return b.validUntil.getTime() - a.validUntil.getTime();
    }

    // Within inactive offers, sort by createdAt (descending - most recent first)
    return b.createdAt - a.createdAt;
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-muted-foreground">Loading offers...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-destructive">{error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Filter Tabs */}
      <div className="flex gap-2 border-b">
        <button
          onClick={() => setFilter("active")}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            filter === "active"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          Active
        </button>
        <button
          onClick={() => setFilter("inactive")}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            filter === "inactive"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          Inactive
        </button>
        <button
          onClick={() => setFilter("all")}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            filter === "all"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          All
        </button>
      </div>

      {/* Offers Grid */}
      {sortedOffers.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <p className="text-muted-foreground">
            {filter === "all"
              ? "No offers yet. Create your first offer to get started!"
              : `No ${filter} offers found.`}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {sortedOffers.map((offer) => {
            const expired = isOfferExpired(offer);

            return (
              <Card key={offer.code} className="flex flex-col">
                <CardHeader>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex flex-col gap-2">
                      <CardTitle className="text-xl font-bold">{offer.code}</CardTitle>
                      <div className="flex gap-2">
                        {offer.type && (
                          <Badge variant="outline" className="capitalize">
                            {formatOfferType(offer.type)}
                          </Badge>
                        )}
                        <Badge
                          variant={
                            offer.status === "active"
                              ? expired
                                ? "secondary"
                                : "default"
                              : "outline"
                          }
                        >
                          {offer.status === "active" ? (expired ? "Expired" : "Active") : "Inactive"}
                        </Badge>
                      </div>
                    </div>
                  </div>
                </CardHeader>

                <CardContent className="flex-1">
                  <p className="text-sm text-muted-foreground mb-4">{offer.description}</p>

                  {offer.status === "active" && (
                    <div className="space-y-2 text-sm">
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <CalendarIcon className="h-4 w-4" />
                        <span>
                          {formatDate(offer.validFrom)} - {formatDate(offer.validUntil)}
                        </span>
                      </div>
                    </div>
                  )}
                </CardContent>

                <CardFooter className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onEdit(offer)}
                    disabled={deactivating === offer.code}
                  >
                    <Edit className="h-4 w-4 mr-1" />
                    Edit
                  </Button>

                  {offer.status === "active" && (
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => handleDeactivateClick(offer)}
                      disabled={deactivating === offer.code}
                    >
                      <XCircle className="h-4 w-4 mr-1" />
                      {deactivating === offer.code ? "Deactivating..." : "Deactivate"}
                    </Button>
                  )}
                </CardFooter>
              </Card>
            );
          })}
        </div>
      )}

      {/* Deactivate Confirmation Dialog */}
      <AlertDialog
        open={offerToDeactivate !== null}
        onOpenChange={(open) => !open && setOfferToDeactivate(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Deactivate Offer?</AlertDialogTitle>
            <AlertDialogDescription>
              This will deactivate the offer "{offerToDeactivate?.code}". The offer will no longer
              be active but will remain in your list. You can create a new offer with the same code
              later if needed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDeactivate}>Deactivate</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
