import { FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/state/useAuth";
import { useRelays } from "@/state/useRelays";
import { useOnboardingProgress } from "@/state/useOnboardingProgress";
import { KeyBackupDrawer } from "@/components/KeyBackupDrawer";
import { ChevronDown, ChevronUp, Copy, KeyRound, RadioTower, Check, Circle, AlertTriangle, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface ChecklistItemProps {
  label: string;
  isComplete: boolean;
  isWarning?: boolean;
  onClick: () => void;
}

function ChecklistItem({ label, isComplete, isWarning = false, onClick }: ChecklistItemProps): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-muted/50"
    >
      <div className="flex items-center gap-3">
        {isWarning ? (
          <AlertTriangle className="h-4 w-4 text-amber-500" />
        ) : isComplete ? (
          <div className="flex h-4 w-4 items-center justify-center rounded-full bg-emerald-500 text-white">
            <Check className="h-2.5 w-2.5" />
          </div>
        ) : (
          <Circle className="h-4 w-4 text-muted-foreground" />
        )}
        <span className={cn(
          isComplete && !isWarning && "text-muted-foreground",
          isWarning && "text-amber-700 font-medium"
        )}>
          {label}
        </span>
      </div>
      <ChevronRight className="h-4 w-4 text-muted-foreground" />
    </button>
  );
}

export function SettingsPage(): JSX.Element {
  const navigate = useNavigate();
  const npub = useAuth((state) => state.npub);
  const revealSecret = useAuth((state) => state.revealSecret);
  const relays = useRelays((state) => state.relays);
  const addRelay = useRelays((state) => state.addRelay);
  const removeRelay = useRelays((state) => state.removeRelay);
  const resetRelays = useRelays((state) => state.resetRelays);
  
  const profilePublished = useOnboardingProgress((state) => state.profilePublished);
  const menuPublished = useOnboardingProgress((state) => state.menuPublished);
  const discoveryPublished = useOnboardingProgress((state) => state.discoveryPublished);
  const keyBackedUp = useOnboardingProgress((state) => state.keyBackedUp);
  const setKeyBackedUp = useOnboardingProgress((state) => state.setKeyBackedUp);
  
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerSecret, setDrawerSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [newRelay, setNewRelay] = useState("");
  const [busy, setBusy] = useState(false);
  const [advancedSettingsOpen, setAdvancedSettingsOpen] = useState(false);

  const handleReveal = async () => {
    setBusy(true);
    try {
      const secret = await revealSecret();
      if (secret) {
        setDrawerSecret(secret);
        setDrawerOpen(true);
      }
    } finally {
      setBusy(false);
    }
  };

  const handleBackupComplete = () => {
    setKeyBackedUp(true);
  };

  const handleDrawerOpenChange = (open: boolean) => {
    setDrawerOpen(open);
    // When drawer closes after viewing the key, mark backup as complete
    if (!open && drawerSecret) {
      setKeyBackedUp(true);
    }
  };

  const handleCopy = async (value: string | null | undefined) => {
    if (!value) return;
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleAddRelay = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = newRelay.trim();
    if (!trimmed) return;
    addRelay(trimmed);
    setNewRelay("");
  };

  return (
    <div className="container space-y-6 py-10">
      {/* Page Header */}
      <div className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">Account</h1>
        <p className="text-muted-foreground">
          Manage your restaurant identity and account settings.
        </p>
      </div>

      {/* Getting Started Checklist */}
      <section className="rounded-lg border bg-card p-6 shadow-sm">
        <h2 className="text-lg font-semibold">Getting Started</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Complete these steps to make your restaurant discoverable by AI assistants.
        </p>
        <div className="mt-4 divide-y rounded-lg border">
          <ChecklistItem
            label="Profile published"
            isComplete={profilePublished}
            onClick={() => navigate("/app/profile")}
          />
          <ChecklistItem
            label="Menu published"
            isComplete={menuPublished}
            onClick={() => navigate("/app/menu")}
          />
          <ChecklistItem
            label="Discovery page live"
            isComplete={discoveryPublished}
            onClick={() => navigate("/app/website")}
          />
          <ChecklistItem
            label={keyBackedUp ? "Key backed up" : "Key not backed up"}
            isComplete={keyBackedUp}
            isWarning={!keyBackedUp}
            onClick={handleReveal}
          />
        </div>
      </section>

      {/* Backup Warning - Show if key not backed up */}
      {!keyBackedUp && (
        <section className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-6">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 text-amber-600" />
            <div className="flex-1">
              <h3 className="font-semibold text-amber-800">Back up your key</h3>
              <p className="mt-1 text-sm text-amber-700">
                Your restaurant identity is only stored in this browser. Back it up now to avoid losing access if your browser data is cleared.
              </p>
              <Button
                onClick={handleReveal}
                disabled={busy}
                className="mt-3"
                variant="default"
              >
                <KeyRound className="mr-2 h-4 w-4" />
                {busy ? "Loading…" : "Backup Now"}
              </Button>
            </div>
          </div>
        </section>
      )}

      {/* Identity Section */}
      <section className="space-y-4 rounded-lg border bg-card p-6">
        <header className="flex items-center gap-3">
          <KeyRound className="h-5 w-5 text-muted-foreground" />
          <div>
            <h2 className="text-lg font-semibold">Identity</h2>
            <p className="text-sm text-muted-foreground">
              Your restaurant's unique identity on the Nostr network.
            </p>
          </div>
        </header>

        <div className="grid gap-3 text-sm">
          <div>
            <span className="text-xs uppercase text-muted-foreground">Public Key</span>
            <p className="font-mono break-all">{npub ?? "Loading…"}</p>
            <Button variant="link" className="px-0" onClick={() => handleCopy(npub)}>
              <Copy className="mr-2 h-3.5 w-3.5" />
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap gap-3">
          <Button onClick={handleReveal} disabled={busy} variant={keyBackedUp ? "outline" : "default"}>
            <KeyRound className="mr-2 h-4 w-4" />
            {keyBackedUp ? "View Key" : "Backup Restaurant Key"}
          </Button>
          {keyBackedUp && (
            <span className="flex items-center gap-1.5 text-sm text-emerald-600">
              <Check className="h-4 w-4" />
              Backed up
            </span>
          )}
        </div>
      </section>

      {/* Advanced Settings */}
      <section className="space-y-4 rounded-lg border bg-card p-6">
        <button
          type="button"
          onClick={() => setAdvancedSettingsOpen(!advancedSettingsOpen)}
          className="flex w-full items-center justify-between gap-3 text-left"
        >
          <div className="flex items-center gap-3">
            <RadioTower className="h-5 w-5 text-muted-foreground" />
            <div>
              <h2 className="text-lg font-semibold">Advanced Settings</h2>
            </div>
          </div>
          {advancedSettingsOpen ? (
            <ChevronUp className="h-5 w-5 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-5 w-5 text-muted-foreground" />
          )}
        </button>

        {advancedSettingsOpen && (
          <div className="space-y-4 pt-2">
            <div>
              <h3 className="mb-1 text-base font-semibold">Relays</h3>
              <p className="text-sm text-muted-foreground">Configure the relays where your information is published.</p>
            </div>

            <ul className="grid gap-2 text-sm">
              {relays.map((relay) => (
                <li key={relay} className="flex items-center justify-between rounded-md border bg-muted/40 px-3 py-2">
                  <span className="font-mono text-xs">{relay}</span>
                  <Button variant="ghost" size="sm" onClick={() => removeRelay(relay)}>
                    Remove
                  </Button>
                </li>
              ))}
            </ul>

            <form onSubmit={handleAddRelay} className="flex flex-wrap gap-2">
              <Input
                value={newRelay}
                onChange={(event) => setNewRelay(event.target.value)}
                placeholder="wss://relay.example.com"
                className="max-w-sm"
              />
              <Button type="submit">Add relay</Button>
              <Button type="button" variant="ghost" onClick={resetRelays}>
                Reset defaults
              </Button>
            </form>
          </div>
        )}
      </section>

      <KeyBackupDrawer
        open={drawerOpen}
        onOpenChange={handleDrawerOpenChange}
        nsec={drawerSecret}
        onConfirm={handleBackupComplete}
      />
    </div>
  );
}
