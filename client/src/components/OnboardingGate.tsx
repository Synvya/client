import { useEffect, useMemo, useRef, useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/state/useAuth";
import { useRelays } from "@/state/useRelays";
import { useOnboardingProgress } from "@/state/useOnboardingProgress";
import { fetchLiveMenuData } from "@/lib/menu/menuFetch";
import { KeyBackupDrawer } from "@/components/KeyBackupDrawer";
import { Button } from "@/components/ui/button";

interface OnboardingGateProps {
  children: React.ReactNode;
}

export function OnboardingGate({ children }: OnboardingGateProps): JSX.Element {
  const status = useAuth((state) => state.status);
  const pubkey = useAuth((state) => state.pubkey);
  const initialize = useAuth((state) => state.initialize);
  const error = useAuth((state) => state.error);
  const needsBackup = useAuth((state) => state.needsBackup);
  const lastGeneratedNsec = useAuth((state) => state.lastGeneratedNsec);
  const markBackedUp = useAuth((state) => state.markBackedUp);
  const revealSecret = useAuth((state) => state.revealSecret);
  const relays = useRelays((state) => state.relays);
  const menuPublished = useOnboardingProgress((state) => state.menuPublished);
  const setMenuPublished = useOnboardingProgress((state) => state.setMenuPublished);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const menuCheckDone = useRef(false);

  useEffect(() => {
    if (status === "idle" || status === "error" || status === "needs-setup") {
      void initialize();
    }
  }, [status, initialize]);

  // Check menu published status on app load (e.g. after restoring from backup)
  useEffect(() => {
    if (menuPublished || menuCheckDone.current) return;
    if (status !== "ready" || !pubkey || !relays.length) return;

    menuCheckDone.current = true;

    (async () => {
      try {
        const data = await fetchLiveMenuData(pubkey, relays);
        setMenuPublished(data.items.length > 0);
      } catch {
        // Non-critical — menu checkmark just won't show until they visit Menu
      }
    })();
  }, [status, pubkey, relays, menuPublished, setMenuPublished]);

  useEffect(() => {
    if (needsBackup && lastGeneratedNsec) {
      setDrawerOpen(true);
    }
  }, [needsBackup, lastGeneratedNsec]);

  useEffect(() => {
    if (drawerOpen && needsBackup && !lastGeneratedNsec) {
      void revealSecret();
    }
  }, [drawerOpen, needsBackup, lastGeneratedNsec, revealSecret]);

  const fallback = useMemo(() => {
    if (status === "loading" || status === "idle") {
      return (
        <div className="flex min-h-[60vh] items-center justify-center">
          <div className="flex flex-col items-center gap-2 text-sm text-muted-foreground">
            <div className="h-10 w-10 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            <span>Preparing your Synvya identity…</span>
          </div>
        </div>
      );
    }

    if (status === "error") {
      return (
        <div className="mx-auto flex max-w-md flex-col items-center gap-4 rounded-md border bg-card p-6 text-center">
          <p className="text-sm text-destructive">{error ?? "Something went wrong while setting up"}</p>
          <Button onClick={() => void initialize()}>Try again</Button>
        </div>
      );
    }

    if (status === "needs-setup") {
      return <Navigate to="/" replace />;
    }

    return null;
  }, [status, error, initialize]);

  if (fallback) {
    return fallback;
  }

  return (
    <>
      {children}
      <KeyBackupDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        nsec={lastGeneratedNsec}
        requireConfirmation={needsBackup}
        onConfirm={() => {
          markBackedUp();
        }}
      />
    </>
  );
}
