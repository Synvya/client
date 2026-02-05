import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { publishDiscoveryPage } from "./discovery";

describe("publishDiscoveryPage", () => {
  const originalEnv = import.meta.env.VITE_API_BASE_URL;

  beforeEach(() => {
    import.meta.env.VITE_API_BASE_URL = "https://api.example.com";
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    import.meta.env.VITE_API_BASE_URL = originalEnv;
    vi.restoreAllMocks();
  });

  it("sends correct request to discovery endpoint", async () => {
    const mockResponse = {
      published: true,
      url: "https://synvya.com/restaurant/test-cafe/"
    };

    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResponse)
    } as Response);

    const result = await publishDiscoveryPage("restaurant", "test-cafe", "<html>Test</html>");

    expect(fetch).toHaveBeenCalledWith(
      "https://api.example.com/discovery/publish",
      expect.objectContaining({
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json"
        },
        body: JSON.stringify({
          typeSlug: "restaurant",
          nameSlug: "test-cafe",
          html: "<html>Test</html>"
        })
      })
    );

    expect(result).toBe("https://synvya.com/restaurant/test-cafe/");
  });

  it("handles trailing slash in API base URL", async () => {
    import.meta.env.VITE_API_BASE_URL = "https://api.example.com/";

    const mockResponse = {
      published: true,
      url: "https://synvya.com/restaurant/test-cafe/"
    };

    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResponse)
    } as Response);

    await publishDiscoveryPage("restaurant", "test-cafe", "<html>Test</html>");

    expect(fetch).toHaveBeenCalledWith(
      "https://api.example.com/discovery/publish",
      expect.anything()
    );
  });

  it("throws error when API base URL is not configured", async () => {
    import.meta.env.VITE_API_BASE_URL = "";

    await expect(publishDiscoveryPage("restaurant", "test", "<html></html>")).rejects.toThrow(
      "Missing VITE_API_BASE_URL"
    );
  });

  it("throws error on non-OK response", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ error: "Internal server error" })
    } as Response);

    await expect(publishDiscoveryPage("restaurant", "test", "<html></html>")).rejects.toThrow(
      "Failed to publish discovery page (500): Internal server error"
    );
  });

  it("throws error on non-OK response with non-JSON body", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 400,
      json: () => Promise.reject(new Error("Not JSON"))
    } as Response);

    await expect(publishDiscoveryPage("restaurant", "test", "<html></html>")).rejects.toThrow(
      "Failed to publish discovery page (400)"
    );
  });

  it("throws error on unexpected response format", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ published: false })
    } as Response);

    await expect(publishDiscoveryPage("restaurant", "test", "<html></html>")).rejects.toThrow(
      "Unexpected response from discovery publish endpoint"
    );
  });
});
