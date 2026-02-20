/**
 * Test Harness Page
 * 
 * Development tool to simulate AI agent reservation requests
 * Allows testing the inbox and response flows without a real AI agent
 */

import { useState } from "react";
import { useAuth } from "@/state/useAuth";
import { useRelays } from "@/state/useRelays";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { buildReservationRequest } from "@/lib/reservationEvents";
import { wrapEvent } from "@/lib/nip59";
import { publishToRelays } from "@/lib/relayPool";
import { iso8601ToUnixAndTzid } from "@/lib/reservationTimeUtils";
import { generateSecretKey, getPublicKey } from "nostr-tools";
import { nip19 } from "nostr-tools";
import { AlertCircle, Send, Zap, Users, Calendar, FileText, Loader2 } from "lucide-react";
import type { ReservationRequest } from "@/types/reservation";
import { extractPdfMenu, enrichMenuDescriptions } from "@/services/menuImport";
import { pdfToImages } from "@/lib/menuImport/pdfToImages";
import type { PdfExtractionResult } from "@/lib/menuImport/types";

export function TestHarnessPage(): JSX.Element {
  const pubkey = useAuth((state) => state.pubkey);
  const relays = useRelays((state) => state.relays);

  // Form state
  const [partySize, setPartySize] = useState("2");
  const [datetime, setDatetime] = useState("");
  const [notes, setNotes] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [contactEmail, setContactEmail] = useState("");

  // Agent identity (persistent in session)
  const [agentPrivateKey] = useState(() => generateSecretKey());
  const [agentPublicKey] = useState(() => getPublicKey(agentPrivateKey));
  const [agentNpub] = useState(() => nip19.npubEncode(agentPublicKey));

  // Submission state
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // PDF extraction test state
  const [pdfTestExtracting, setPdfTestExtracting] = useState(false);
  const [pdfTestError, setPdfTestError] = useState<string | null>(null);
  const [pdfTestResult, setPdfTestResult] = useState<PdfExtractionResult | null>(null);
  const [pdfTestFileName, setPdfTestFileName] = useState<string | null>(null);
  const [pdfTestEnriching, setPdfTestEnriching] = useState(false);
  const [pdfTestEnrichedJson, setPdfTestEnrichedJson] = useState<string | null>(null);

  const handlePdfTestExtract = async (file: File) => {
    setPdfTestError(null);
    setPdfTestResult(null);
    setPdfTestEnrichedJson(null);
    setPdfTestFileName(file.name);
    setPdfTestExtracting(true);
    try {
      const pageImages = await pdfToImages(file);
      const result = await extractPdfMenu(pageImages, "");
      setPdfTestResult(result);
    } catch (err) {
      setPdfTestError(err instanceof Error ? err.message : "Extraction failed");
    } finally {
      setPdfTestExtracting(false);
    }
  };

  const handlePdfTestEnrich = async () => {
    if (!pdfTestResult) return;
    setPdfTestEnriching(true);
    setPdfTestError(null);
    try {
      const result = await enrichMenuDescriptions(
        pdfTestResult.items.map((i) => ({
          name: i.name,
          description: i.description,
          ingredients: i.ingredients,
        })),
        { name: "", cuisine: "", about: "" },
      );
      setPdfTestEnrichedJson(JSON.stringify(result, null, 2));
    } catch (err) {
      setPdfTestError(err instanceof Error ? err.message : "Enrichment failed");
    } finally {
      setPdfTestEnriching(false);
    }
  };

  const handleSend = async () => {
    if (!pubkey || !relays.length || !datetime) {
      setError("Missing required fields or configuration");
      return;
    }

    setLoading(true);
    setError(null);
    setSuccess(false);

    try {
      // Build reservation request payload
      const isoTime = new Date(datetime).toISOString();
      const { unixTimestamp, tzid } = iso8601ToUnixAndTzid(isoTime);
      const request: ReservationRequest = {
        party_size: parseInt(partySize, 10),
        time: unixTimestamp,
        tzid,
        message: notes || undefined,
        name: contactName || undefined,
        telephone: contactPhone ? (contactPhone.startsWith("tel:") ? contactPhone : `tel:${contactPhone}`) : undefined,
        email: contactEmail ? (contactEmail.startsWith("mailto:") ? contactEmail : `mailto:${contactEmail}`) : undefined,
      };

      // Build reservation request event template
      const requestTemplate = buildReservationRequest(
        request,
        agentPrivateKey,
        pubkey
      );

      // Wrap in gift wrap
      const giftWrap = wrapEvent(requestTemplate, agentPrivateKey, pubkey);

      // Publish to relays
      await publishToRelays(giftWrap, relays);

      setSuccess(true);
      
      // Clear form after 2 seconds
      setTimeout(() => {
        setSuccess(false);
      }, 3000);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to send request";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const loadExample = (example: "simple" | "detailed" | "large-party") => {
    const now = new Date();
    now.setHours(now.getHours() + 2); // 2 hours from now
    const datetimeLocal = now.toISOString().slice(0, 16);

    switch (example) {
      case "simple":
        setPartySize("2");
        setDatetime(datetimeLocal);
        setNotes("");
        setContactName("");
        setContactPhone("");
        setContactEmail("");
        break;
      case "detailed":
        setPartySize("4");
        setDatetime(datetimeLocal);
        setNotes("Window seat preferred, celebrating anniversary");
        setContactName("Alice Johnson");
        setContactPhone("(555) 123-4567");
        setContactEmail("alice@example.com");
        break;
      case "large-party":
        setPartySize("8");
        const laterDate = new Date(now);
        laterDate.setHours(laterDate.getHours() + 24);
        setDatetime(laterDate.toISOString().slice(0, 16));
        setNotes("Business dinner, need quiet area");
        setContactName("Bob Smith");
        setContactPhone("(555) 987-6543");
        setContactEmail("");
        break;
    }
  };

  return (
    <div className="container py-10">
      <div className="mx-auto max-w-2xl space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold">Test Harness</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Simulate AI agent reservation requests for development and testing
          </p>
        </div>

        {/* Warning Banner */}
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-amber-600" />
            <div className="flex-1 text-sm text-amber-600">
              <p className="font-semibold">Development Tool Only</p>
              <p className="mt-1">
                This page simulates AI agent messages for testing. Messages are sent to your own
                merchant account and will appear in the Reservations inbox.
              </p>
            </div>
          </div>
        </div>

        {/* Agent Identity */}
        <div className="rounded-lg border bg-card p-4">
          <h3 className="mb-2 text-sm font-semibold">Simulated AI Agent Identity</h3>
          <p className="break-all font-mono text-xs text-muted-foreground">{agentNpub}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Messages will appear as coming from this agent
          </p>
        </div>

        {/* Quick Examples */}
        <div className="space-y-2">
          <Label>Quick Examples</Label>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => loadExample("simple")}
              disabled={loading}
            >
              <Users className="mr-1 h-3 w-3" />
              Simple Request
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => loadExample("detailed")}
              disabled={loading}
            >
              <Calendar className="mr-1 h-3 w-3" />
              Detailed Request
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => loadExample("large-party")}
              disabled={loading}
            >
              <Zap className="mr-1 h-3 w-3" />
              Large Party
            </Button>
          </div>
        </div>

        {/* Form */}
        <div className="space-y-4 rounded-lg border bg-card p-6">
          <h3 className="font-semibold">Reservation Request</h3>

          <div className="grid gap-4">
            {/* Party Size */}
            <div className="grid gap-2">
              <Label htmlFor="party-size">Party Size *</Label>
              <Input
                id="party-size"
                type="number"
                min="1"
                max="20"
                value={partySize}
                onChange={(e) => setPartySize(e.target.value)}
                disabled={loading}
              />
            </div>

            {/* Date & Time */}
            <div className="grid gap-2">
              <Label htmlFor="datetime">Date & Time *</Label>
              <Input
                id="datetime"
                type="datetime-local"
                value={datetime}
                onChange={(e) => setDatetime(e.target.value)}
                disabled={loading}
              />
            </div>

            {/* Notes */}
            <div className="grid gap-2">
              <Label htmlFor="notes">Notes (optional)</Label>
              <Textarea
                id="notes"
                placeholder="Special requests, preferences, etc."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                disabled={loading}
                rows={3}
              />
            </div>

            {/* Contact Information */}
            <div className="space-y-3">
              <Label>Contact Information (optional)</Label>
              <div className="grid gap-3">
                <Input
                  placeholder="Name"
                  value={contactName}
                  onChange={(e) => setContactName(e.target.value)}
                  disabled={loading}
                />
                <Input
                  placeholder="Phone"
                  value={contactPhone}
                  onChange={(e) => setContactPhone(e.target.value)}
                  disabled={loading}
                />
                <Input
                  placeholder="Email"
                  type="email"
                  value={contactEmail}
                  onChange={(e) => setContactEmail(e.target.value)}
                  disabled={loading}
                />
              </div>
            </div>
          </div>

          {/* Feedback */}
          {error && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}

          {success && (
            <div className="rounded-md border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm text-emerald-600">
              Request sent! Check the Reservations page to see it.
            </div>
          )}

          {/* Submit */}
          <Button
            className="w-full"
            onClick={handleSend}
            disabled={loading || !datetime || !partySize}
          >
            <Send className="mr-2 h-4 w-4" />
            {loading ? "Sending..." : "Send Reservation Request"}
          </Button>
        </div>

        {/* Instructions */}
        <div className="rounded-lg border bg-muted/30 p-4 text-sm">
          <h4 className="font-semibold">How to use:</h4>
          <ol className="mt-2 list-inside list-decimal space-y-1 text-muted-foreground">
            <li>Fill out the reservation request form above</li>
            <li>Click "Send Reservation Request" to simulate an AI agent message</li>
            <li>Navigate to the Reservations page to see the incoming request</li>
            <li>Test the Accept, Decline, or Suggest flows</li>
            <li>Repeat with different scenarios to test edge cases</li>
          </ol>
        </div>

        {/* PDF Menu Extraction Test */}
        <div className="mt-8 space-y-4">
          <div>
            <h2 className="text-xl font-bold flex items-center gap-2">
              <FileText className="h-5 w-5" />
              PDF Menu Extraction
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Test PDF extraction accuracy. No publish capability — purely for inspection.
            </p>
          </div>

          <div className="rounded-lg border bg-card p-6 space-y-4">
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex flex-col gap-2">
                <Label>Upload PDF</Label>
                <input
                  type="file"
                  accept=".pdf"
                  disabled={pdfTestExtracting}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void handlePdfTestExtract(f);
                  }}
                  className="text-sm"
                />
              </div>
              {pdfTestResult && (
                <Button
                  onClick={handlePdfTestEnrich}
                  disabled={pdfTestEnriching}
                  variant="outline"
                  size="sm"
                >
                  {pdfTestEnriching ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Enriching...
                    </>
                  ) : (
                    "Enrich Descriptions"
                  )}
                </Button>
              )}
            </div>

            {pdfTestExtracting && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Extracting menu from {pdfTestFileName}...
              </div>
            )}

            {pdfTestError && (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                {pdfTestError}
              </div>
            )}

            {pdfTestResult && (
              <div className="space-y-4">
                {/* Summary stats */}
                <div className="flex flex-wrap gap-4 text-sm">
                  <div className="rounded-md bg-muted px-3 py-1.5">
                    Items: <span className="font-medium">{pdfTestResult.items.length}</span>
                  </div>
                  <div className="rounded-md bg-muted px-3 py-1.5">
                    With prices: <span className="font-medium">{pdfTestResult.items.filter((i) => i.price).length}</span>
                  </div>
                  <div className="rounded-md bg-muted px-3 py-1.5">
                    With ingredients: <span className="font-medium">{pdfTestResult.items.filter((i) => i.ingredients?.length).length}</span>
                  </div>
                  <div className="rounded-md bg-muted px-3 py-1.5">
                    Menus/sections: <span className="font-medium">{pdfTestResult.menus.length}</span>
                  </div>
                </div>

                {/* Side by side: JSON and preview cards */}
                <div className="grid gap-4 lg:grid-cols-2">
                  {/* Raw JSON */}
                  <div className="space-y-2">
                    <Label>Raw JSON</Label>
                    <pre className="max-h-96 overflow-auto rounded-md border bg-muted/30 p-3 text-xs">
                      {JSON.stringify(pdfTestResult, null, 2)}
                    </pre>
                  </div>

                  {/* Preview cards */}
                  <div className="space-y-2">
                    <Label>Preview Cards</Label>
                    <div className="max-h-96 space-y-2 overflow-auto rounded-md border p-3">
                      {pdfTestResult.items.map((item, idx) => (
                        <div key={idx} className="rounded-md border bg-background p-3 text-sm">
                          <div className="flex items-center justify-between">
                            <span className="font-medium">{item.name}</span>
                            {item.price && <span className="text-muted-foreground">${item.price}</span>}
                          </div>
                          {item.description && (
                            <p className="mt-1 text-xs text-muted-foreground">{item.description}</p>
                          )}
                          {item.ingredients?.length > 0 && (
                            <p className="mt-1 text-xs text-muted-foreground/70">
                              {item.ingredients.join(", ")}
                            </p>
                          )}
                          {item.suitableForDiets?.length > 0 && (
                            <div className="mt-1 flex gap-1">
                              {item.suitableForDiets.map((d) => (
                                <span key={d} className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-xs text-emerald-700">
                                  {d}
                                </span>
                              ))}
                            </div>
                          )}
                          <div className="mt-1 text-xs text-muted-foreground/50">
                            {item.partOfMenu}{item.partOfMenuSection ? ` > ${item.partOfMenuSection}` : ""}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Enriched descriptions */}
                {pdfTestEnrichedJson && (
                  <div className="space-y-2">
                    <Label>Enriched Descriptions</Label>
                    <pre className="max-h-64 overflow-auto rounded-md border bg-muted/30 p-3 text-xs">
                      {pdfTestEnrichedJson}
                    </pre>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

