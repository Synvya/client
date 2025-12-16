import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { consumeSquareCodeVerifier, clearSquareState, getSquareState } from "@/lib/square/auth";
import { exchangeSquareCode } from "@/services/square";
import { useAuth } from "@/state/useAuth";
import { useRelays } from "@/state/useRelays";
import { resolveProfileLocation } from "@/lib/profileLocation";
import { useBusinessProfile } from "@/state/useBusinessProfile";

type ProcessingState = "initializing" | "exchanging" | "completed" | "error";

export function SquareCallbackPage(): JSX.Element {
  const navigate = useNavigate();
  const authStatus = useAuth((state) => state.status);
  const pubkey = useAuth((state) => state.pubkey);
  const initialize = useAuth((state) => state.initialize);
  const relays = useRelays((state) => state.relays);
  const { location: cachedProfileLocation, setLocation: setCachedProfileLocation } = useBusinessProfile((state) => ({
    location: state.location,
    setLocation: state.setLocation
  }));
  const [processing, setProcessing] = useState<ProcessingState>("initializing");
  const [error, setError] = useState<string | null>(null);
  const [handled, setHandled] = useState(false);

  useEffect(() => {
    if (authStatus === "idle" || authStatus === "error" || authStatus === "needs-setup") {
      void initialize();
    }
  }, [authStatus, initialize]);

  useEffect(() => {
    if (handled) {
      return;
    }
    if (authStatus !== "ready" || !pubkey) {
      return;
    }

    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const state = params.get("state");
    const storedState = getSquareState();
    const codeVerifier = consumeSquareCodeVerifier();

    if (!code) {
      clearSquareState();
      setError("Square authorization code missing. Please try connecting again.");
      setProcessing("error");
      setHandled(true);
      return;
    }
    if (!codeVerifier) {
      clearSquareState();
      setError("Square authorization session expired. Please start the connection again.");
      setProcessing("error");
      setHandled(true);
      return;
    }
    if (!state || !storedState || storedState !== state) {
      clearSquareState();
      setError("Unable to verify the Square authorization state. Please try again.");
      setProcessing("error");
      setHandled(true);
      return;
    }

    setHandled(true);
    setProcessing("exchanging");

    void (async () => {
      try {
        const profileLocation = await resolveProfileLocation(pubkey, relays, cachedProfileLocation);
        if (profileLocation && profileLocation !== cachedProfileLocation) {
          setCachedProfileLocation(profileLocation);
        }
        await exchangeSquareCode({
          code,
          codeVerifier,
          pubkey,
          profileLocation: profileLocation ?? undefined
        });
        clearSquareState();
        setProcessing("completed");
        setTimeout(() => {
          navigate("/app/settings?square=connected", { replace: true });
        }, 800);
      } catch (err) {
        clearSquareState();
        const message = err instanceof Error ? err.message : "Failed to complete Square connection.";
        setError(message);
        setProcessing("error");
      }
    })();
  }, [authStatus, pubkey, navigate, handled, relays, cachedProfileLocation, setCachedProfileLocation]);

  const statusMessage = useMemo(() => {
    switch (processing) {
      case "initializing":
        return "Preparing your Synvya identity…";
      case "exchanging":
        return "Finalizing your Square connection…";
      case "completed":
        return "Square connection completed. Redirecting…";
      default:
        return null;
    }
  }, [processing]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 px-4">
      <div className="w-full max-w-md rounded-lg border bg-card p-6 text-center shadow-sm">
        {processing !== "error" ? (
          <div className="flex flex-col items-center gap-4 text-sm text-muted-foreground">
            <div className="h-10 w-10 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            <span>{statusMessage}</span>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-4 text-sm text-muted-foreground">
            <span className="text-destructive">{error ?? "Unable to connect to Square."}</span>
            <Button onClick={() => navigate("/app/settings", { replace: true })}>Return to settings</Button>
          </div>
        )}
      </div>
    </div>
  );
}

export default SquareCallbackPage;
