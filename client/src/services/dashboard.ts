export interface BotAnalyticsRecord {
  npub: string;
  dateBotKey: string;
  date: string;
  bot: string;
  visitCount: number;
  pages: string[];
  handle: string;
  updatedAt: string;
}

interface BotAnalyticsResponse {
  items: BotAnalyticsRecord[];
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
    // Ignore JSON parsing errors; we'll throw a generic message below.
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

export async function fetchBotAnalytics(
  npub: string
): Promise<BotAnalyticsRecord[]> {
  const base = getApiBaseUrl();
  const response = await fetch(`${base}/dashboard/${npub}`, {
    method: "GET",
    headers: {
      Accept: "application/json",
    },
  });
  const data = await handleResponse<BotAnalyticsResponse>(response);
  return data.items;
}
