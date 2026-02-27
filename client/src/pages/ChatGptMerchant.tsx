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
import { Copy, Check, ExternalLink, Loader2, Square, CheckSquare } from "lucide-react";

const PRESET_FIELDS = {
  headquarterCountry: "United States",
  primaryProductCategories: "Food & Beverage",
  interestedIn:
    "Integrating my product feed so my products show up in search results on ChatGPT",
  productFeedReady: "Yes",
  feedSize: "0-1M",
  checkoutIntegration:
    "We have built or are committed to building our Checkout API according to the Agentic Commerce Protocol.",
  freeText:
    "We have partnered with Synvya Inc. to produce our OpenAI compliant product feed. We are committed to building our Checkout API according to the Agentic Commerce Protocol in partnership with Synvya Inc.",
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

type ChecklistStepDef =
  | { type: "copy"; label: string; value: string }
  | { type: "instruction"; label: string; instruction: string };

function ChecklistStep({
  step,
  def,
  checked,
  onToggle,
}: {
  step: number;
  def: ChecklistStepDef;
  checked: boolean;
  onToggle: () => void;
}): JSX.Element {
  return (
    <div
      className={`flex items-start gap-3 rounded-lg border p-4 transition-colors ${
        checked ? "border-muted bg-muted/40" : "border-border bg-card"
      }`}
    >
      <button
        type="button"
        onClick={onToggle}
        className="mt-0.5 text-muted-foreground hover:text-foreground"
        aria-label={checked ? "Mark as incomplete" : "Mark as complete"}
      >
        {checked ? (
          <CheckSquare className="h-5 w-5 text-emerald-500" />
        ) : (
          <Square className="h-5 w-5" />
        )}
      </button>
      <div className="min-w-0 flex-1">
        <p
          className={`text-sm font-medium ${
            checked ? "text-muted-foreground line-through" : ""
          }`}
        >
          <span className="mr-2 text-muted-foreground">{step}.</span>
          {def.label}
        </p>
        {def.type === "copy" ? (
          <div className="mt-1 flex items-center">
            <code
              className={`rounded bg-muted px-2 py-0.5 text-sm ${
                checked ? "text-muted-foreground" : ""
              }`}
            >
              {def.value}
            </code>
            <CopyButton value={def.value} />
          </div>
        ) : (
          <p
            className={`mt-1 text-sm ${
              checked ? "text-muted-foreground" : "text-muted-foreground"
            }`}
            dangerouslySetInnerHTML={{ __html: def.instruction }}
          />
        )}
      </div>
    </div>
  );
}

export function ChatGptMerchantPage(): JSX.Element {
  const pubkey = useAuth((s) => s.pubkey);
  const authStatus = useAuth((s) => s.status);
  const relays = useRelays((s) => s.relays);
  const discoveryPageUrl = useOnboardingProgress((s) => s.discoveryPageUrl);
  const setChatgptSubmitted = useOnboardingProgress(
    (s) => s.setChatgptSubmitted
  );

  const [loading, setLoading] = useState(true);
  const [showWalkthrough, setShowWalkthrough] = useState(false);
  const [checkedSteps, setCheckedSteps] = useState<Set<number>>(new Set());
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
          merchantWebsite:
            profile.website || discoveryPageUrl || prev.merchantWebsite,
        }));
      } catch (error) {
        console.warn(
          "Failed to load profile for ChatGPT Merchant page",
          error
        );
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

  const toggleStep = (step: number) =>
    setCheckedSteps((prev) => {
      const next = new Set(prev);
      if (next.has(step)) next.delete(step);
      else next.add(step);
      return next;
    });

  if (loading) {
    return (
      <div className="container flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const steps: ChecklistStepDef[] = [
    { type: "copy", label: "First name", value: fields.firstName },
    { type: "copy", label: "Last name", value: fields.lastName },
    { type: "copy", label: "Work title", value: fields.workTitle },
    { type: "copy", label: "LinkedIn", value: fields.linkedIn },
    { type: "copy", label: "Work email", value: fields.workEmail },
    { type: "copy", label: "Company", value: fields.company },
    {
      type: "instruction",
      label: "Headquarter country",
      instruction: 'Select <strong>United States</strong> from the dropdown.',
    },
    {
      type: "copy",
      label: "Link to your merchant website",
      value: fields.merchantWebsite,
    },
    {
      type: "instruction",
      label: "Primary Product Categories",
      instruction:
        'Check <strong>Food &amp; Beverage</strong>. Leave all others unchecked.',
    },
    {
      type: "instruction",
      label: "We are interested in",
      instruction:
        'Check <strong>Integrating my product feed so my products show up in search results on ChatGPT</strong>. Leave <strong>Integrating Instant Checkout via the Agentic Commerce Protocol&hellip;</strong> unchecked.',
    },
    {
      type: "instruction",
      label: "Product Feed",
      instruction:
        "Check <strong>Our product feed is ready to go and meets OpenAI's specifications&hellip;</strong>",
    },
    {
      type: "instruction",
      label: "Feed Size - Unique SKU Count",
      instruction: 'Select <strong>0-1M</strong> from the dropdown.',
    },
    {
      type: "instruction",
      label: "Checkout Integration",
      instruction:
        'Check <strong>We have built or are committed to building our Checkout API according to the Agentic Commerce Protocol.</strong>',
    },
    {
      type: "copy",
      label: "Anything else you'd like us to know?",
      value: PRESET_FIELDS.freeText,
    },
  ];

  if (showWalkthrough) {
    return (
      <div className="container max-w-2xl py-10">
        <h1 className="text-2xl font-bold">ChatGPT Merchant Application</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Open the ChatGPT Application, then follow the steps below in order. Check off
          each step as you go.
        </p>

        <div className="mt-4 flex justify-center gap-3">
          <Button variant="outline" onClick={() => setShowWalkthrough(false)}>
            Back to Edit
          </Button>
          <Button
            onClick={() => {
              setChatgptSubmitted(true);
              window.open("https://chatgpt.com/merchants/#form", "_blank");
            }}
          >
            <ExternalLink className="mr-2 h-4 w-4" />
            Open ChatGPT Merchant Application
          </Button>
        </div>

        <Card className="mt-6 space-y-3 p-4">
          {steps.map((def, i) => (
            <ChecklistStep
              key={i}
              step={i + 1}
              def={def}
              checked={checkedSteps.has(i)}
              onToggle={() => toggleStep(i)}
            />
          ))}
        </Card>
      </div>
    );
  }

  return (
    <div className="container max-w-2xl py-10">
      <h1 className="text-2xl font-bold">ChatGPT Merchant Application</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        This page helps you apply to the ChatGPT Merchant Program. Synvya has
        pre-filled most of the application — you just need to provide your
        personal details below.
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
        <Button onClick={() => setShowWalkthrough(true)}>
          Prepare Application
        </Button>
      </div>
    </div>
  );
}
