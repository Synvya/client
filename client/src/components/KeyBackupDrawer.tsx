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
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [encrypting, setEncrypting] = useState(false);
  const [encryptError, setEncryptError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const handleCopy = async () => {
    if (!nsec) return;
    try {
      await navigator.clipboard.writeText(nsec);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error("Failed to copy private key", error);
    }
  };

  useEffect(() => {
    setCopied(false);
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
          className="fixed left-1/2 top-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-2xl border bg-background p-6 shadow-lg"
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
                Copy your private key and store it in a safe place. This key gives you full control over your restaurant profile and should be kept secure.
              </Dialog.Description>
            </div>
          </div>

          <div className="mt-5 rounded-md border bg-muted/20 p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs uppercase tracking-wide text-muted-foreground">Private Key</span>
              <button
                type="button"
                onClick={handleCopy}
                className="flex items-center gap-1 text-xs font-medium text-primary hover:underline"
              >
                {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
            <div
              className={cn(
                "mt-2 rounded-md bg-background px-3 py-2 font-mono text-sm",
                !nsec && "text-destructive",
                "break-all"
              )}
            >
              {nsec ?? "Private key unavailable"}
            </div>
          </div>

          <div className="mt-6 space-y-3 rounded-md border bg-muted/20 p-4">
            <div>
              <h4 className="text-sm font-medium">Password-protected backup</h4>
              <p className="text-xs text-muted-foreground">
                Create a password-protected backup file that you can safely store. This encrypted file can be used to restore your restaurant profile if needed.
              </p>
            </div>

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
              variant="outline"
              className="flex items-center gap-2"
              onClick={() => void handleDownloadEncrypted()}
              disabled={encrypting || !nsec}
            >
              <Download className="h-4 w-4" />
              {encrypting ? "Creating backup…" : "Download password-protected backup"}
            </Button>
          </div>

          <div className="mt-6 flex items-center justify-end gap-2">
            {requireConfirmation ? (
              <Button type="button" variant="secondary" onClick={handleConfirm} disabled={!nsec}>
                I stored it safely
              </Button>
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
