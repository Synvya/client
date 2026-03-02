export interface SubscriptionStatus {
  npub: string;
  subscription_status:
    | "trialing"
    | "trial_expired"
    | "active"
    | "past_due"
    | "canceled"
    | "none";
  trial_start: string | null;
  trial_end: string | null;
  ai_pages_active: boolean;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  current_period_end: string | null;
}

function getApiBaseUrl(): string {
  const base = import.meta.env.VITE_API_BASE_URL as string | undefined;
  if (!base) {
    throw new Error("Missing VITE_API_BASE_URL");
  }
  return base.replace(/\/+$/, "");
}

async function handleResponse<T>(response: Response): Promise<T> {
  let json: unknown = null;
  try {
    json = await response.json();
  } catch {
    // Ignore JSON parsing errors
  }
  if (!response.ok) {
    const message =
      typeof json === "object" && json && "error" in json
        ? String((json as Record<string, unknown>).error)
        : `Request failed with status ${response.status}`;
    throw new Error(message);
  }
  return json as T;
}

export async function fetchSubscriptionStatus(
  npub: string
): Promise<SubscriptionStatus> {
  const base = getApiBaseUrl();
  const response = await fetch(`${base}/api/customers/status/${npub}`, {
    method: "GET",
    headers: { Accept: "application/json" },
  });
  return handleResponse<SubscriptionStatus>(response);
}

export async function createCheckoutSession(
  npub: string
): Promise<{ checkout_url: string }> {
  const base = getApiBaseUrl();
  const response = await fetch(`${base}/billing/create-checkout-session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ npub }),
  });
  return handleResponse<{ checkout_url: string }>(response);
}

export async function createPortalSession(
  npub: string
): Promise<{ portal_url: string }> {
  const base = getApiBaseUrl();
  const response = await fetch(`${base}/billing/create-portal-session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ npub }),
  });
  return handleResponse<{ portal_url: string }>(response);
}
