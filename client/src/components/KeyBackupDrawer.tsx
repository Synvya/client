import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useState } from "react";
import { nip19 } from "nostr-tools";
import { encrypt as encryptNip49 } from "nostr-tools/nip49";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { Check, Copy, Shield, Download, Eye, EyeOff } from "lucide-react";

interface KeyBackupDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  nsec: string | null;
  requireConfirmation?: boolean;
  onConfirm?: () => void;
}

export function KeyBackupDrawer({ open, onOpenChange, nsec, requireConfirmation = false, onConfirm }: KeyBackupDrawerProps): JSX.Element {
  const [copied, setCopied] = useState(false);
  const [downloaded, setDownloaded] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [encrypting, setEncrypting] = useState(false);
  const [encryptError, setEncryptError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const backupCompleted = downloaded || copied;

  const handleCopy = async () => {
    if (!nsec) return;
    try {
      await navigator.clipboard.writeText(nsec);
      setCopied(true);
    } catch (error) {
      console.error("Failed to copy private key", error);
    }
  };

  useEffect(() => {
    setCopied(false);
    setDownloaded(false);
    setPassword("");
    setConfirmPassword("");
    setEncryptError(null);
    setEncrypting(false);
    setShowPassword(false);
    setShowConfirmPassword(false);
  }, [nsec]);

  const handleConfirm = () => {
    onConfirm?.();
    onOpenChange(false);
  };

  const handleDownloadEncrypted = async () => {
    if (!nsec) {
      setEncryptError("Private key unavailable");
      return;
    }

    if (!password.trim()) {
      setEncryptError("Please enter a password to protect your backup");
      return;
    }

    if (password !== confirmPassword) {
      setEncryptError("Passwords do not match");
      return;
    }

    try {
      setEncrypting(true);
      setEncryptError(null);
      const decoded = nip19.decode(nsec);
      if (decoded.type !== "nsec") {
        throw new Error("Provided key is not an nsec");
      }
      const secretBytes = decoded.data instanceof Uint8Array ? decoded.data : new Uint8Array(decoded.data);
      const encrypted = encryptNip49(secretBytes, password);
      const blob = new Blob([encrypted], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "restaurant-encrypted-key.txt";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setDownloaded(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to encrypt key";
      setEncryptError(message);
    } finally {
      setEncrypting(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-2xl border bg-background p-6 shadow-lg max-h-[90vh] overflow-y-auto"
          onInteractOutside={(event) => {
            if (requireConfirmation) {
              event.preventDefault();
            }
          }}
          onEscapeKeyDown={(event) => {
            if (requireConfirmation) {
              event.preventDefault();
            }
          }}
        >
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Shield className="h-5 w-5" />
            </span>
            <div>
              <Dialog.Title className="text-lg font-semibold">Back up your restaurant key</Dialog.Title>
              <Dialog.Description className="text-sm text-muted-foreground">
                If you lose access to this device, you'll need this backup to recover your restaurant profile.
              </Dialog.Description>
            </div>
          </div>

          {/* Step 1 — Download encrypted backup (Required) */}
          <div className="mt-5 space-y-3 rounded-md border bg-muted/20 p-4">
            <div className="flex items-center gap-2">
              <span className={cn(
                "flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold",
                downloaded ? "bg-primary text-primary-foreground" : "bg-primary/10 text-primary"
              )}>
                {downloaded ? <Check className="h-3.5 w-3.5" /> : "1"}
              </span>
              <div>
                <h4 className="text-sm font-medium">Download your encrypted backup</h4>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              You'll need this password to restore your account — we cannot recover it for you.
            </p>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="backup-password">Password</Label>
                <div className="relative">
                  <Input
                    id="backup-password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="new-password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    className="pr-10"
                  />
                  <button
                    type="button"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    className="absolute inset-y-0 right-2 flex items-center text-muted-foreground transition hover:text-foreground"
                    onClick={() => setShowPassword((prev) => !prev)}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="backup-password-confirm">Confirm password</Label>
                <div className="relative">
                  <Input
                    id="backup-password-confirm"
                    type={showConfirmPassword ? "text" : "password"}
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    className="pr-10"
                  />
                  <button
                    type="button"
                    aria-label={showConfirmPassword ? "Hide password" : "Show password"}
                    className="absolute inset-y-0 right-2 flex items-center text-muted-foreground transition hover:text-foreground"
                    onClick={() => setShowConfirmPassword((prev) => !prev)}
                  >
                    {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
            </div>

            {encryptError ? <p className="text-xs text-destructive">{encryptError}</p> : null}

            <Button
              type="button"
              className="flex items-center gap-2"
              onClick={() => void handleDownloadEncrypted()}
              disabled={encrypting || !nsec}
            >
              <Download className="h-4 w-4" />
              {encrypting ? "Creating backup…" : downloaded ? "Downloaded" : "Download encrypted backup"}
            </Button>
          </div>

          {/* Step 2 — Copy raw private key (Optional) */}
          <div className="mt-4 space-y-3 rounded-md border bg-muted/10 p-4">
            <div className="flex items-center gap-2">
              <span className={cn(
                "flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold",
                copied ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
              )}>
                {copied ? <Check className="h-3.5 w-3.5" /> : "2"}
              </span>
              <div className="flex items-center gap-2">
                <h4 className="text-sm font-medium">Copy your raw private key</h4>
                <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Optional</span>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Advanced: save your raw key to a password manager or other secure location.
            </p>
            <div
              className={cn(
                "rounded-md bg-background px-3 py-2 font-mono text-sm",
                !nsec && "text-destructive",
                "break-all"
              )}
            >
              {nsec ?? "Private key unavailable"}
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="flex items-center gap-1"
              onClick={() => void handleCopy()}
              disabled={!nsec}
            >
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? "Copied" : "Copy to clipboard"}
            </Button>
          </div>

          <div className="mt-6 flex flex-col items-end gap-1.5">
            {requireConfirmation ? (
              <>
                <Button type="button" variant="secondary" onClick={handleConfirm} disabled={!nsec || !backupCompleted}>
                  I stored it safely
                </Button>
                {!backupCompleted && (
                  <p className="text-xs text-muted-foreground">
                    Complete at least one backup method above to continue
                  </p>
                )}
              </>
            ) : (
              <Dialog.Close asChild>
                <Button type="button" variant="secondary">
                  Close
                </Button>
              </Dialog.Close>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
