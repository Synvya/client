import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  fetchSubscriptionStatus,
  createCheckoutSession,
  createPortalSession,
} from "@/services/billing";
import type { SubscriptionStatus } from "@/services/billing";
import { Button } from "@/components/ui/button";
import {
  Loader2,
  ExternalLink,
  AlertTriangle,
  CheckCircle,
  Clock,
  XCircle,
} from "lucide-react";

function TrialCountdown({ trialEnd }: { trialEnd: string }): JSX.Element {
  if (trialEnd === "forever") {
    return (
      <p className="text-sm text-muted-foreground">
        Permanent free plan — no payment required.
      </p>
    );
  }

  const end = new Date(trialEnd);
  const now = new Date();
  const daysLeft = Math.max(
    0,
    Math.ceil((end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
  );

  return (
    <p className="text-sm text-muted-foreground">
      {daysLeft} {daysLeft === 1 ? "day" : "days"} remaining in your free trial
      (ends{" "}
      {end.toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
      })}
      ).
    </p>
  );
}

function AiDiscoveryStatus({
  status,
  npub,
}: {
  status: SubscriptionStatus;
  npub: string;
}): JSX.Element {
  const [actionLoading, setActionLoading] = useState(false);

  const handleCheckout = async () => {
    setActionLoading(true);
    try {
      const { checkout_url } = await createCheckoutSession(npub);
      window.location.href = checkout_url;
    } catch (err) {
      console.error("Failed to create checkout session:", err);
      setActionLoading(false);
    }
  };

  const handlePortal = async () => {
    setActionLoading(true);
    try {
      const { portal_url } = await createPortalSession(npub);
      window.location.href = portal_url;
    } catch (err) {
      console.error("Failed to create portal session:", err);
      setActionLoading(false);
    }
  };

  const statusBadge = (label: string, color: string) => (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${color}`}>
      {label}
    </span>
  );

  switch (status.subscription_status) {
    case "trialing":
      return (
        <div className="rounded-lg border p-4 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h4 className="font-medium">AI Discovery</h4>
              {status.trial_end === "forever"
                ? statusBadge("Free Plan", "bg-emerald-100 text-emerald-700")
                : statusBadge("Free Trial", "bg-blue-100 text-blue-700")}
            </div>
          </div>
          <TrialCountdown trialEnd={status.trial_end || ""} />
          {status.trial_end !== "forever" && (
            <Button size="sm" onClick={handleCheckout} disabled={actionLoading}>
              {actionLoading && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              Add Payment Method
            </Button>
          )}
        </div>
      );

    case "active":
      return (
        <div className="rounded-lg border p-4 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h4 className="font-medium">AI Discovery</h4>
              {statusBadge("Active", "bg-emerald-100 text-emerald-700")}
            </div>
          </div>
          <p className="text-sm text-muted-foreground">
            $19.99/month — renews{" "}
            {status.current_period_end
              ? new Date(status.current_period_end).toLocaleDateString(
                  "en-US",
                  { month: "long", day: "numeric", year: "numeric" }
                )
              : "soon"}
            .
          </p>
          <Button variant="outline" size="sm" onClick={handlePortal} disabled={actionLoading}>
            {actionLoading && (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            )}
            <ExternalLink className="mr-2 h-4 w-4" />
            Manage Billing
          </Button>
        </div>
      );

    case "past_due":
      return (
        <div className="rounded-lg border border-amber-500/40 p-4 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h4 className="font-medium">AI Discovery</h4>
              {statusBadge("Past Due", "bg-amber-100 text-amber-700")}
            </div>
          </div>
          <p className="text-sm text-muted-foreground">
            Your last payment failed. AI discovery pages are paused until
            payment is updated.
          </p>
          <Button size="sm" onClick={handlePortal} disabled={actionLoading}>
            {actionLoading && (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            )}
            Update Payment Method
          </Button>
        </div>
      );

    case "canceled":
      return (
        <div className="rounded-lg border p-4 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h4 className="font-medium">AI Discovery</h4>
              {statusBadge("Canceled", "bg-gray-100 text-gray-600")}
            </div>
          </div>
          <p className="text-sm text-muted-foreground">
            Your AI discovery pages are no longer active. Resubscribe to
            restore them.
          </p>
          <Button size="sm" onClick={handleCheckout} disabled={actionLoading}>
            {actionLoading && (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            )}
            Resubscribe — $19.99/month
          </Button>
        </div>
      );

    case "trial_expired":
      return (
        <div className="rounded-lg border border-amber-500/40 p-4 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h4 className="font-medium">AI Discovery</h4>
              {statusBadge("Expired", "bg-amber-100 text-amber-700")}
            </div>
          </div>
          <p className="text-sm text-muted-foreground">
            Your free trial has ended. Subscribe to keep your AI discovery
            pages active.
          </p>
          <Button size="sm" onClick={handleCheckout} disabled={actionLoading}>
            {actionLoading && (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            )}
            Subscribe — $19.99/month
          </Button>
        </div>
      );

    default:
      return (
        <div className="rounded-lg border p-4 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h4 className="font-medium">AI Discovery</h4>
              {statusBadge("Not Subscribed", "bg-gray-100 text-gray-600")}
            </div>
          </div>
          <p className="text-sm text-muted-foreground">
            Make your restaurant discoverable by AI assistants.
          </p>
          <Button size="sm" onClick={handleCheckout} disabled={actionLoading}>
            {actionLoading && (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            )}
            Subscribe — $19.99/month
          </Button>
        </div>
      );
  }
}

export function BillingSection({ npub }: { npub: string | null }): JSX.Element {
  const [status, setStatus] = useState<SubscriptionStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();

  const checkoutSuccess = searchParams.get("success") === "true";
  const checkoutCanceled = searchParams.get("canceled") === "true";

  // Clear query params after reading
  useEffect(() => {
    if (checkoutSuccess || checkoutCanceled) {
      setSearchParams({}, { replace: true });
    }
  }, [checkoutSuccess, checkoutCanceled, setSearchParams]);

  useEffect(() => {
    if (!npub) return;
    let cancelled = false;

    (async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await fetchSubscriptionStatus(npub);
        if (!cancelled) setStatus(data);
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Failed to load billing status"
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [npub]);

  return (
    <section className="rounded-lg border bg-card p-6 shadow-sm">
      <h2 className="text-lg font-semibold">Subscriptions</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Manage your Synvya subscriptions.
      </p>

      <div className="mt-4 space-y-4">

      {checkoutSuccess && (
        <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3">
          <div className="flex items-center gap-2">
            <CheckCircle className="h-4 w-4 text-emerald-600" />
            <p className="text-sm font-medium text-emerald-700">
              Subscription activated! Your AI discovery pages are now live.
            </p>
          </div>
        </div>
      )}

      {checkoutCanceled && (
        <div className="rounded-lg border p-3">
          <p className="text-sm text-muted-foreground">
            Checkout was canceled. You can try again anytime.
          </p>
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-500/40 p-3">
          <p className="text-sm text-red-600">{error}</p>
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>Loading subscriptions...</span>
        </div>
      ) : (
        status && npub && <AiDiscoveryStatus status={status} npub={npub} />
      )}
      </div>
    </section>
  );
}
