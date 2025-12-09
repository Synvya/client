import { ChangeEvent, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { decrypt as decryptNip49 } from "nostr-tools/nip49";
import { nip19 } from "nostr-tools";
import { Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/state/useAuth";
import { PrivacyPolicyDialog } from "@/components/PrivacyPolicyDialog";
import { TermsOfServiceDialog } from "@/components/TermsOfServiceDialog";
import dinedirectLogo from "@/assets/logo_light.png";

export function LandingPage(): JSX.Element {
  const status = useAuth((state) => state.status);
  const error = useAuth((state) => state.error);
  const initialize = useAuth((state) => state.initialize);
  const createNewIdentity = useAuth((state) => state.createNewIdentity);
  const importSecret = useAuth((state) => state.importSecret);
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [generalError, setGeneralError] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);
  const [encryptedKey, setEncryptedKey] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [privacyDialogOpen, setPrivacyDialogOpen] = useState(false);
  const [termsDialogOpen, setTermsDialogOpen] = useState(false);

  useEffect(() => {
    void initialize();
  }, [initialize]);

  useEffect(() => {
    if (status === "ready") {
      navigate("/app/profile", { replace: true });
    }
  }, [status, navigate]);

  const handleNewUser = async () => {
    if (!agreedToTerms) {
      setGeneralError("Please agree to the Terms of Service and Privacy Policy to continue.");
      return;
    }

    setCreating(true);
    setGeneralError(null);
    try {
      await createNewIdentity();
      navigate("/app/profile", { replace: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to create identity";
      setGeneralError(message);
    } finally {
      setCreating(false);
    }
  };

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    try {
      const text = await file.text();
      setEncryptedKey(text.trim());
      setSelectedFileName(file.name);
      setImportError(null);
      setPassword("");
      setConfirmPassword("");
      setShowPassword(false);
      setShowConfirmPassword(false);
      setAgreedToTerms(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to read file";
      setImportError(message);
    } finally {
      event.target.value = "";
    }
  };

  const handleImport = async () => {
    if (!encryptedKey) {
      setImportError("Select an encrypted key file first");
      return;
    }

    if (!password.trim()) {
      setImportError("Enter the password for this key");
      return;
    }

    if (password !== confirmPassword) {
      setImportError("Passwords do not match");
      return;
    }

    setImporting(true);
    setImportError(null);
    try {
      const secretBytes = decryptNip49(encryptedKey, password);
      const nsec = nip19.nsecEncode(secretBytes);
      await importSecret(nsec);
      navigate("/app/profile", { replace: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to decrypt file";
      setImportError(message);
    } finally {
      setImporting(false);
    }
  };

  const showSpinner = status === "loading" || status === "idle";

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 px-4">
      <div className="w-full max-w-2xl space-y-6 rounded-3xl border bg-card px-8 py-10 shadow-sm">
        <div className="space-y-2 text-center">
          <div className="flex justify-center">
            <img src={dinedirectLogo} alt="DineDirect logo" className="h-12 w-auto" />
          </div>
          <p className="text-sm text-muted-foreground">
            Start fresh or import your existing merchant key to continue.
          </p>
        </div>

        {showSpinner ? (
          <div className="flex min-h-[160px] items-center justify-center">
            <div className="flex flex-col items-center gap-2 text-sm text-muted-foreground">
              <div className="h-10 w-10 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              <span>Checking for existing identity…</span>
            </div>
          </div>
        ) : (
          <>
            {generalError ? (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {generalError}
              </div>
            ) : null}
            {status === "error" && error ? (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </div>
            ) : null}

            <div className="grid gap-6 sm:grid-cols-2">
              <div className="flex flex-col rounded-2xl border bg-muted/20 p-6">
                <h2 className="text-lg font-semibold">Sign Up</h2>
                <label className="mt-4 flex items-start gap-2 text-sm text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={agreedToTerms}
                    onChange={(event) => setAgreedToTerms(event.target.checked)}
                    className="mt-1 h-4 w-4 rounded border-input text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  />
                  <span>
                    I agree to the{" "}
                    <button
                      type="button"
                      onClick={() => setTermsDialogOpen(true)}
                      className="text-primary underline underline-offset-2 hover:no-underline"
                    >
                      Terms of Service
                    </button>{" "}
                    and{" "}
                    <button
                      type="button"
                      onClick={() => setPrivacyDialogOpen(true)}
                      className="text-primary underline underline-offset-2 hover:no-underline"
                    >
                      Privacy Policy
                    </button>
                    .
                  </span>
                </label>
                <div className="flex-1" />
                <Button
                  className="mt-6"
                  onClick={() => void handleNewUser()}
                  disabled={creating || importing || !agreedToTerms}
                >
                  {creating ? "Creating…" : "Sign Up"}
                </Button>
              </div>

              <div className="flex flex-col rounded-2xl border bg-muted/20 p-6">
                <h2 className="text-lg font-semibold">Log In</h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  Use the `business-encrypted-key.txt` file to restore your merchant identity.
                </p>
                <div className="mt-4 space-y-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={importing || creating}
                  >
                    {selectedFileName ? "Choose a different file" : "Select encrypted key file"}
                  </Button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".txt,.key,.nsec,text/plain"
                    className="hidden"
                    onChange={handleFileChange}
                  />
                  {selectedFileName ? (
                    <p className="text-xs text-muted-foreground">Selected: {selectedFileName}</p>
                  ) : null}
                </div>

                <div className="mt-4 grid gap-3">
                  <div className="grid gap-1.5">
                    <Label htmlFor="import-password">Password</Label>
                    <div className="relative">
                      <Input
                        id="import-password"
                        type={showPassword ? "text" : "password"}
                        autoComplete="current-password"
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        disabled={importing || creating}
                        className="pr-10"
                      />
                      <button
                        type="button"
                        aria-label={showPassword ? "Hide password" : "Show password"}
                        className="absolute inset-y-0 right-2 flex items-center text-muted-foreground transition hover:text-foreground"
                        onClick={() => setShowPassword((prev) => !prev)}
                        disabled={importing || creating}
                      >
                        {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="import-password-confirm">Confirm password</Label>
                    <div className="relative">
                      <Input
                        id="import-password-confirm"
                        type={showConfirmPassword ? "text" : "password"}
                        autoComplete="current-password"
                        value={confirmPassword}
                        onChange={(event) => setConfirmPassword(event.target.value)}
                        disabled={importing || creating}
                        className="pr-10"
                      />
                      <button
                        type="button"
                        aria-label={showConfirmPassword ? "Hide password" : "Show password"}
                        className="absolute inset-y-0 right-2 flex items-center text-muted-foreground transition hover:text-foreground"
                        onClick={() => setShowConfirmPassword((prev) => !prev)}
                        disabled={importing || creating}
                      >
                        {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>
                  {importError ? (
                    <p className="text-xs text-destructive">{importError}</p>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      Enter the password you used when exporting the encrypted key file.
                    </p>
                  )}
                  <Button
                    type="button"
                    className="mt-2"
                    onClick={() => void handleImport()}
                    disabled={importing || creating || !encryptedKey}
                  >
                    {importing ? "Decrypting…" : "Import encrypted key"}
                  </Button>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
      <TermsOfServiceDialog open={termsDialogOpen} onOpenChange={setTermsDialogOpen} />
      <PrivacyPolicyDialog open={privacyDialogOpen} onOpenChange={setPrivacyDialogOpen} />
    </div>
  );
}
