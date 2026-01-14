import { FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/state/useAuth";
import { useRelays } from "@/state/useRelays";
import { KeyBackupDrawer } from "@/components/KeyBackupDrawer";
import { ChevronDown, ChevronUp, Copy, KeyRound, RadioTower } from "lucide-react";

export function SettingsPage(): JSX.Element {
  const npub = useAuth((state) => state.npub);
  const revealSecret = useAuth((state) => state.revealSecret);
  const relays = useRelays((state) => state.relays);
  const addRelay = useRelays((state) => state.addRelay);
  const removeRelay = useRelays((state) => state.removeRelay);
  const resetRelays = useRelays((state) => state.resetRelays);
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

  // Square integration has moved to /app/menu

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
    <div className="container space-y-8 py-10">
      <section className="space-y-4 rounded-lg border bg-card p-6">
        <header className="flex items-center gap-3">
          <KeyRound className="h-5 w-5 text-muted-foreground" />
          <div>
            <h2 className="text-lg font-semibold">Identity</h2>
            <p className="text-sm text-muted-foreground">Back up your restaurant keys to maintain access across devices and prevent loss if browser data is cleared.</p>
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
          <Button onClick={handleReveal} disabled={busy}>
            <KeyRound className="mr-2 h-4 w-4" /> Backup Restaurant Key
          </Button>
        </div>
      </section>

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

      <KeyBackupDrawer open={drawerOpen} onOpenChange={setDrawerOpen} nsec={drawerSecret} />
    </div>
  );
}
