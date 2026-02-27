import { useEffect, useState } from "react";
import { useAuth } from "@/state/useAuth";
import { useRelays } from "@/state/useRelays";
import { useOnboardingProgress } from "@/state/useOnboardingProgress";
import { parseKind0ProfileEvent } from "@/components/BusinessProfileForm";
import { getPool } from "@/lib/relayPool";
import type { BusinessProfile } from "@/types/profile";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Copy, Check, ExternalLink, Loader2 } from "lucide-react";

const PRESET_FIELDS = {
  headquarterCountry: "United States",
  primaryProductCategories: "Food & Beverage",
  interestedIn:
    "Integrating my product feed so my products show up in search results on ChatGPT",
  productFeedReady: "Yes",
  feedSize: "0-1M",
  checkoutIntegration: "No",
  freeText:
    "We have partnered with Synvya Inc. to produce our OpenAI compliant product fee. We are committed to building our Checkout API according to the Agentic Commerce Protocol in partnership with Synvya Inc.",
};

interface EditableFields {
  firstName: string;
  lastName: string;
  workTitle: string;
  linkedIn: string;
  workEmail: string;
  company: string;
  merchantWebsite: string;
}

function CopyButton({ value }: { value: string }): JSX.Element {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="ml-2 inline-flex items-center rounded p-1 text-muted-foreground hover:text-foreground"
      aria-label="Copy to clipboard"
    >
      {copied ? (
        <Check className="h-4 w-4 text-emerald-500" />
      ) : (
        <Copy className="h-4 w-4" />
      )}
    </button>
  );
}

function SummaryRow({
  label,
  value,
}: {
  label: string;
  value: string;
}): JSX.Element {
  return (
    <div className="flex items-start justify-between gap-4 py-2">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-muted-foreground">{label}</p>
        <p className="mt-0.5 break-words text-sm">{value}</p>
      </div>
      <CopyButton value={value} />
    </div>
  );
}

export function ChatGptMerchantPage(): JSX.Element {
  const pubkey = useAuth((s) => s.pubkey);
  const authStatus = useAuth((s) => s.status);
  const relays = useRelays((s) => s.relays);
  const discoveryPageUrl = useOnboardingProgress((s) => s.discoveryPageUrl);
  const setChatgptSubmitted = useOnboardingProgress((s) => s.setChatgptSubmitted);

  const [loading, setLoading] = useState(true);
  const [showSummary, setShowSummary] = useState(false);
  const [fields, setFields] = useState<EditableFields>({
    firstName: "",
    lastName: "",
    workTitle: "",
    linkedIn: "",
    workEmail: "",
    company: "",
    merchantWebsite: "",
  });

  // Load profile from kind 0
  useEffect(() => {
    if (authStatus !== "ready" || !pubkey) return;

    let cancelled = false;
    const pool = getPool();

    (async () => {
      try {
        const event = await pool.get(relays, {
          kinds: [0],
          authors: [pubkey],
        });

        if (!event || cancelled) return;

        const { patch } = parseKind0ProfileEvent(event);
        const profile = patch as Partial<BusinessProfile>;

        setFields((prev) => ({
          ...prev,
          workEmail: profile.email || prev.workEmail,
          company: profile.displayName || profile.name || prev.company,
          merchantWebsite: profile.website || discoveryPageUrl || prev.merchantWebsite,
        }));
      } catch (error) {
        console.warn("Failed to load profile for ChatGPT Merchant page", error);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [authStatus, pubkey, relays, discoveryPageUrl]);

  const updateField = (key: keyof EditableFields, value: string) =>
    setFields((prev) => ({ ...prev, [key]: value }));

  if (loading) {
    return (
      <div className="container flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (showSummary) {
    return (
      <div className="container max-w-2xl py-10">
        <h1 className="text-2xl font-bold">ChatGPT Merchant Application</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Copy each field below and paste it into the corresponding field in
          the ChatGPT Merchant application.
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          Once you submit the application, OpenAI will reach out to you via
          e-mail as they onboard merchants on a rolling basis.
        </p>

        <div className="mt-4 flex justify-center gap-3">
          <Button variant="outline" onClick={() => setShowSummary(false)}>
            Back to Edit
          </Button>
          <Button
            onClick={() => {
              setChatgptSubmitted(true);
              window.open("https://chatgpt.com/merchants/", "_blank");
            }}
          >
            <ExternalLink className="mr-2 h-4 w-4" />
            Open ChatGPT Merchant Form
          </Button>
        </div>

        <Card className="mt-6 p-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <SummaryRow label="First name" value={fields.firstName} />
            <SummaryRow label="Last name" value={fields.lastName} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <SummaryRow label="Work title" value={fields.workTitle} />
            <SummaryRow label="LinkedIn" value={fields.linkedIn} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <SummaryRow label="Work email" value={fields.workEmail} />
            <SummaryRow label="Company" value={fields.company} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <SummaryRow
              label="Headquarter country"
              value={PRESET_FIELDS.headquarterCountry}
            />
            <SummaryRow
              label="Link to your merchant website"
              value={fields.merchantWebsite}
            />
          </div>

          <div className="mt-2 border-t pt-4">
            <SummaryRow
              label="Primary Product Categories"
              value={PRESET_FIELDS.primaryProductCategories}
            />
          </div>

          <div className="mt-2 border-t pt-4">
            <SummaryRow
              label="We are interested in"
              value={PRESET_FIELDS.interestedIn}
            />
          </div>

          <div className="mt-2 border-t pt-4">
            <SummaryRow
              label="Product Feed"
              value="Our product feed is ready to go and meets OpenAI's specifications"
            />
          </div>

          <div className="mt-2 border-t pt-4">
            <SummaryRow
              label="Feed Size - Unique SKU Count"
              value={PRESET_FIELDS.feedSize}
            />
          </div>

          <div className="mt-2 border-t pt-4">
            <SummaryRow
              label="Checkout Integration"
              value={PRESET_FIELDS.checkoutIntegration}
            />
          </div>

          <div className="mt-2 border-t pt-4">
            <SummaryRow
              label="Anything else you'd like us to know?"
              value={PRESET_FIELDS.freeText}
            />
          </div>
        </Card>

      </div>
    );
  }

  return (
    <div className="container max-w-2xl py-10">
      <h1 className="text-2xl font-bold">ChatGPT Merchant Application</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Your menu is published online with rich details for restaurant and menu
        discovery.
      </p>
      <p className="mt-2 text-sm text-muted-foreground">
        The ChatGPT Merchant application submits your menu as a product feed so
        each dish is understood as a distinct item in ChatGPT Product search,
        showing up as a product-style card (name, price, description, image)
        instead of a menu listing.
      </p>
      <p className="mt-2 text-sm text-muted-foreground">
        Complete this once now to be ready for Synvya takeout ordering at
        launch.
      </p>

      <div className="mt-6 space-y-4">
        <h2 className="text-lg font-semibold">Editable Fields</h2>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="firstName">First Name</Label>
            <Input
              id="firstName"
              value={fields.firstName}
              onChange={(e) => updateField("firstName", e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="lastName">Last Name</Label>
            <Input
              id="lastName"
              value={fields.lastName}
              onChange={(e) => updateField("lastName", e.target.value)}
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="workTitle">Work Title</Label>
          <Input
            id="workTitle"
            value={fields.workTitle}
            onChange={(e) => updateField("workTitle", e.target.value)}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="linkedIn">LinkedIn Profile URL</Label>
          <Input
            id="linkedIn"
            value={fields.linkedIn}
            onChange={(e) => updateField("linkedIn", e.target.value)}
            placeholder="https://linkedin.com/in/..."
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="workEmail">Work Email</Label>
          <Input
            id="workEmail"
            type="email"
            value={fields.workEmail}
            onChange={(e) => updateField("workEmail", e.target.value)}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="company">Company</Label>
          <Input
            id="company"
            value={fields.company}
            onChange={(e) => updateField("company", e.target.value)}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="merchantWebsite">Merchant Website</Label>
          <Input
            id="merchantWebsite"
            value={fields.merchantWebsite}
            onChange={(e) => updateField("merchantWebsite", e.target.value)}
          />
        </div>
      </div>

      <div className="mt-8">
        <Button onClick={() => setShowSummary(true)}>
          Prepare Application
        </Button>
      </div>
    </div>
  );
}
