import { useState, useEffect } from "react";
import { useAuth } from "@/state/useAuth";
import { useRelays } from "@/state/useRelays";
import { useBusinessProfile } from "@/state/useBusinessProfile";
import { OfferForm } from "@/components/OfferForm";
import { OffersList } from "@/components/OffersList";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import type { Offer } from "@/types/loyalty";
import { buildOfferEvent, buildDeactivateEvent } from "@/lib/offerEvents";
import { publishToRelays, getPool } from "@/lib/relayPool";
import { getTimezoneFromLocation, formatTimezoneDisplay } from "@/lib/timezoneUtil";
import { generateOfferCode } from "@/lib/codeGenerator";

export function LoyaltyPage(): JSX.Element {
  const pubkey = useAuth((state) => state.pubkey);
  const signEvent = useAuth((state) => state.signEvent);
  const relays = useRelays((state) => state.relays);
  const { location: profileLocation, setLocation } = useBusinessProfile((state) => ({
    location: state.location,
    setLocation: state.setLocation,
  }));

  const [showForm, setShowForm] = useState(false);
  const [editingOffer, setEditingOffer] = useState<Offer | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  // Fetch profile location on mount if not cached
  useEffect(() => {
    if (!pubkey || !relays.length || profileLocation) {
      return;
    }

    const pool = getPool();
    
    // Query for the merchant's kind:0 profile event
    pool
      .querySync(relays, {
        kinds: [0],
        authors: [pubkey],
        limit: 1,
      })
      .then((events) => {
        if (events.length > 0) {
          const event = events[0];
          try {
            const content = JSON.parse(event.content);
            // Look for location in tags
            const locationTag = event.tags.find((tag) => tag[0] === "location");
            if (locationTag && locationTag[1]) {
              setLocation(locationTag[1]);
            }
          } catch (error) {
            console.error("Error parsing profile event:", error);
          }
        }
      })
      .catch((error) => {
        console.error("Error fetching profile:", error);
      });
  }, [pubkey, relays, profileLocation, setLocation]);

  // Get timezone from profile location, or use default
  const timezone = profileLocation
    ? getTimezoneFromLocation(profileLocation)
    : "America/New_York";
  
  // Format timezone for display
  const timezoneDisplay = formatTimezoneDisplay(timezone);

  /**
   * Handle creating or updating an offer
   */
  async function handleSaveOffer(
    offer: Omit<Offer, "eventId" | "createdAt" | "status">
  ) {
    if (!pubkey) {
      setStatusMessage({ type: "error", text: "Not authenticated" });
      return;
    }

    setIsSubmitting(true);
    setStatusMessage(null);

    try {
      // Build the offer event
      const eventTemplate = buildOfferEvent(offer, pubkey, timezone);

      // Sign the event
      const signedEvent = await signEvent(eventTemplate);

      // Publish to relays
      const result = await publishToRelays(signedEvent, relays);

      setStatusMessage({
        type: "success",
        text: editingOffer
          ? `Offer "${offer.code}" updated successfully!`
          : `Offer "${offer.code}" created successfully!`,
      });

      // Hide form and clear editing state
      setShowForm(false);
      setEditingOffer(null);

      // Clear success message after 5 seconds
      setTimeout(() => setStatusMessage(null), 5000);
    } catch (error) {
      console.error("Error saving offer:", error);
      setStatusMessage({
        type: "error",
        text:
          error instanceof Error
            ? error.message
            : "Failed to save offer. Please try again.",
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  /**
   * Handle editing an offer
   */
  function handleEditOffer(offer: Offer) {
    setEditingOffer(offer);
    setShowForm(true);
    setStatusMessage(null);
  }

  /**
   * Handle deactivating an offer
   */
  async function handleDeactivateOffer(offer: Offer) {
    if (!pubkey) {
      setStatusMessage({ type: "error", text: "Not authenticated" });
      return;
    }

    setStatusMessage(null);

    try {
      // Build deactivate event
      const eventTemplate = buildDeactivateEvent(offer.code, pubkey);

      // Sign the event
      const signedEvent = await signEvent(eventTemplate);

      // Publish to relays
      await publishToRelays(signedEvent, relays);

      setStatusMessage({
        type: "success",
        text: `Offer "${offer.code}" deactivated successfully!`,
      });

      // Clear success message after 5 seconds
      setTimeout(() => setStatusMessage(null), 5000);
    } catch (error) {
      console.error("Error deactivating offer:", error);
      setStatusMessage({
        type: "error",
        text:
          error instanceof Error
            ? error.message
            : "Failed to deactivate offer. Please try again.",
      });
    }
  }

  /**
   * Handle canceling form
   */
  function handleCancelForm() {
    setShowForm(false);
    setEditingOffer(null);
    setStatusMessage(null);
  }

  /**
   * Handle create offer button
   */
  function handleCreateClick() {
    // Generate new 8-letter code for new offer
    const newCode = generateOfferCode();
    
    // Create a partial offer with generated code and default values
    const newOffer: Offer = {
      code: newCode,
      type: "coupon", // Default type
      description: "",
      validFrom: new Date(),
      validUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days from now
      status: "active",
      eventId: "",
      createdAt: 0,
    };
    
    setEditingOffer(newOffer);
    setShowForm(true);
    setStatusMessage(null);
  }

  if (!pubkey) {
    return (
      <div className="container py-10">
        <div className="flex items-center justify-center py-12">
          <p className="text-muted-foreground">Please log in to manage offers.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="container py-10">
      <div className="space-y-8">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">Loyalty Program</h1>
            <p className="text-muted-foreground mt-2">
              Create and manage promotional offers for your customers.
            </p>
          </div>
          {!showForm && (
            <Button onClick={handleCreateClick}>
              <Plus className="h-4 w-4 mr-2" />
              Create Offer
            </Button>
          )}
        </div>

        {/* Status Message */}
        {statusMessage && (
          <div
            className={`p-4 rounded-md ${
              statusMessage.type === "success"
                ? "bg-green-50 text-green-800 border border-green-200"
                : "bg-red-50 text-red-800 border border-red-200"
            }`}
          >
            {statusMessage.text}
          </div>
        )}

        {/* Offer Form */}
        {showForm && (
          <div className="border rounded-lg p-6 bg-card">
            <h2 className="text-xl font-semibold mb-4">
              {editingOffer ? "Edit Offer" : "Create New Offer"}
            </h2>
            <OfferForm
              offer={editingOffer ?? undefined}
              onSave={handleSaveOffer}
              onCancel={handleCancelForm}
              timezone={timezoneDisplay}
              isSubmitting={isSubmitting}
            />
          </div>
        )}

        {/* Offers List */}
        <div>
          <h2 className="text-xl font-semibold mb-4">Your Offers</h2>
          <OffersList
            pubkey={pubkey}
            relays={relays}
            onEdit={handleEditOffer}
            onDeactivate={handleDeactivateOffer}
          />
        </div>
      </div>
    </div>
  );
}
