/**
 * Tests for Direct Reservation Actions
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { acceptReservationDirect } from "./reservationActions";
import type { ReservationMessage } from "@/services/reservationService";
import type { ReservationRequest } from "@/types/reservation";
import type { Rumor } from "./nip59";
import type { Event } from "nostr-tools";
import { generateSecretKey, getPublicKey } from "nostr-tools";

// Mock dependencies
vi.mock("./reservationEvents", () => ({
  buildReservationResponse: vi.fn(),
}));

vi.mock("./nip59", () => ({
  createRumor: vi.fn(),
  wrapEvent: vi.fn(),
}));

vi.mock("./relayPool", () => ({
  publishToRelays: vi.fn(),
}));

vi.mock("./nostrKeys", () => ({
  npubFromPk: vi.fn((pk: string) => `npub${pk.slice(0, 10)}`),
}));

// Helper to create a mock reservation request message
function createMockRequestMessage(
  time: number,
  tzid: string,
  duration?: number
): ReservationMessage {
  const rumor: Rumor = {
    id: "rumor-id-123",
    kind: 9901,
    pubkey: "sender-pubkey",
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ["p", "sender-pubkey", "wss://relay.example.com"],
    ],
    content: "",
  };

  const payload: ReservationRequest = {
    party_size: 4,
    time,
    tzid,
    ...(duration !== undefined && { duration }),
  };

  return {
    rumor,
    type: "request",
    payload,
    senderPubkey: "sender-pubkey",
    giftWrap: {} as Event,
  };
}

describe("acceptReservationDirect", () => {
  const privateKey = generateSecretKey();
  const pubkey = getPublicKey(privateKey);
  const relays = ["wss://relay1.example.com", "wss://relay2.example.com"];
  const baseTime = 1760994000; // Monday, October 20, 2025 at 2:00 PM PDT
  const tzid = "America/Los_Angeles";

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset fetch mock
    global.fetch = vi.fn();
  });

  it("successfully accepts reservation with valid request", async () => {
    const request = createMockRequestMessage(baseTime, tzid);
    
    const { buildReservationResponse } = await import("./reservationEvents");
    const { createRumor, wrapEvent } = await import("./nip59");
    const { publishToRelays } = await import("./relayPool");

    const mockResponseTemplate = {
      kind: 9902,
      content: "",
      tags: [],
      created_at: Math.floor(Date.now() / 1000),
    };

    const mockRumor: Rumor = {
      ...mockResponseTemplate,
      id: "rumor-id-response",
      pubkey: pubkey,
    };

    const mockGiftWrapToRecipient = {
      id: "gift-wrap-recipient-id",
      kind: 1059,
      tags: [["p", "sender-pubkey"]],
    } as Event;

    const mockGiftWrapToSelf = {
      id: "gift-wrap-self-id",
      kind: 1059,
      tags: [["p", pubkey]],
    } as Event;

    const mockPublishResult = {
      eventId: "gift-wrap-recipient-id",
      results: [
        { relay: relays[0], success: true },
        { relay: relays[1], success: true },
      ],
      allFailed: false,
      someSucceeded: true,
    };

    vi.mocked(buildReservationResponse).mockReturnValue(mockResponseTemplate as any);
    vi.mocked(createRumor).mockReturnValue(mockRumor);
    vi.mocked(wrapEvent)
      .mockReturnValueOnce(mockGiftWrapToRecipient)
      .mockReturnValueOnce(mockGiftWrapToSelf);
    vi.mocked(publishToRelays).mockResolvedValue(mockPublishResult);

    await acceptReservationDirect(request, privateKey, relays, pubkey);

    // Verify buildReservationResponse was called correctly
    expect(buildReservationResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "confirmed",
        time: baseTime,
        tzid,
      }),
      privateKey,
      request.senderPubkey,
      "rumor-id-123",
      "wss://relay.example.com", // From p tag in request
      []
    );

    // Verify wrapEvent was called twice (recipient and self)
    expect(wrapEvent).toHaveBeenCalledTimes(2);
    expect(wrapEvent).toHaveBeenNthCalledWith(
      1,
      mockResponseTemplate,
      privateKey,
      request.senderPubkey
    );
    expect(wrapEvent).toHaveBeenNthCalledWith(
      2,
      mockResponseTemplate,
      privateKey,
      pubkey
    );

    // Verify publishToRelays was called twice
    expect(publishToRelays).toHaveBeenCalledTimes(2);
  });

  it("uses time and tzid from options when provided", async () => {
    const request = createMockRequestMessage(baseTime, tzid);
    const overrideTime = baseTime + 3600;
    const overrideTzid = "America/New_York";

    const { buildReservationResponse } = await import("./reservationEvents");
    const { createRumor, wrapEvent } = await import("./nip59");
    const { publishToRelays } = await import("./relayPool");

    const mockResponseTemplate = {
      kind: 9902,
      content: "",
      tags: [],
      created_at: Math.floor(Date.now() / 1000),
    };

    const mockRumor: Rumor = {
      ...mockResponseTemplate,
      id: "rumor-id-response",
      pubkey: pubkey,
    };

    const mockGiftWrap = {
      id: "gift-wrap-id",
      kind: 1059,
      tags: [],
    } as Event;

    const mockPublishResult = {
      eventId: "gift-wrap-id",
      results: [{ relay: relays[0], success: true }],
      allFailed: false,
      someSucceeded: true,
    };

    vi.mocked(buildReservationResponse).mockReturnValue(mockResponseTemplate as any);
    vi.mocked(createRumor).mockReturnValue(mockRumor);
    vi.mocked(wrapEvent).mockReturnValue(mockGiftWrap);
    vi.mocked(publishToRelays).mockResolvedValue(mockPublishResult);

    await acceptReservationDirect(
      request,
      privateKey,
      relays,
      pubkey,
      { time: overrideTime, tzid: overrideTzid }
    );

    // Verify buildReservationResponse was called with override values
    expect(buildReservationResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "confirmed",
        time: overrideTime,
        tzid: overrideTzid,
      }),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything()
    );
  });

  it("throws error when time and tzid are missing", async () => {
    const request = createMockRequestMessage(baseTime, tzid);
    // Remove time and tzid from payload
    (request.payload as any).time = undefined;
    (request.payload as any).tzid = undefined;

    await expect(
      acceptReservationDirect(request, privateKey, relays, pubkey)
    ).rejects.toThrow("Missing required time and tzid in reservation request");
  });

  it("tracks reservation in API when confirmed", async () => {
    const request = createMockRequestMessage(baseTime, tzid);
    
    const { buildReservationResponse } = await import("./reservationEvents");
    const { createRumor, wrapEvent } = await import("./nip59");
    const { publishToRelays } = await import("./relayPool");

    const mockResponseTemplate = {
      kind: 9902,
      content: "",
      tags: [],
      created_at: Math.floor(Date.now() / 1000),
    };

    const mockRumor: Rumor = {
      ...mockResponseTemplate,
      id: "rumor-id-response",
      pubkey: pubkey,
    };

    const mockGiftWrap = {
      id: "gift-wrap-id",
      kind: 1059,
      tags: [],
    } as Event;

    const mockPublishResult = {
      eventId: "gift-wrap-id",
      results: [{ relay: relays[0], success: true }],
      allFailed: false,
      someSucceeded: true,
    };

    vi.mocked(buildReservationResponse).mockReturnValue(mockResponseTemplate as any);
    vi.mocked(createRumor).mockReturnValue(mockRumor);
    vi.mocked(wrapEvent).mockReturnValue(mockGiftWrap);
    vi.mocked(publishToRelays).mockResolvedValue(mockPublishResult);

    // Set API base URL
    const originalEnv = import.meta.env.VITE_API_BASE_URL;
    import.meta.env.VITE_API_BASE_URL = "https://api.example.com";

    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    global.fetch = mockFetch;

    await acceptReservationDirect(request, privateKey, relays, pubkey);

    // Verify API tracking was called
    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.example.com/api/customers/reservations",
      expect.objectContaining({
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: expect.stringContaining("rumor-id-123")
      })
    );
    
    // Verify the body contains the expected data
    const fetchCall = (mockFetch as any).mock.calls[0];
    const body = JSON.parse(fetchCall[1].body);
    expect(body).toMatchObject({
      root_rumor_id: "rumor-id-123",
      reservation_timestamp: baseTime,
      month: "2025-10",
    });
    expect(body.npub).toMatch(/^npub/);

    // Restore
    import.meta.env.VITE_API_BASE_URL = originalEnv;
  });

  it("does not throw error when API tracking fails", async () => {
    const request = createMockRequestMessage(baseTime, tzid);
    
    const { buildReservationResponse } = await import("./reservationEvents");
    const { createRumor, wrapEvent } = await import("./nip59");
    const { publishToRelays } = await import("./relayPool");

    const mockResponseTemplate = {
      kind: 9902,
      content: "",
      tags: [],
      created_at: Math.floor(Date.now() / 1000),
    };

    const mockRumor: Rumor = {
      ...mockResponseTemplate,
      id: "rumor-id-response",
      pubkey: pubkey,
    };

    const mockGiftWrap = {
      id: "gift-wrap-id",
      kind: 1059,
      tags: [],
    } as Event;

    const mockPublishResult = {
      eventId: "gift-wrap-id",
      results: [{ relay: relays[0], success: true }],
      allFailed: false,
      someSucceeded: true,
    };

    vi.mocked(buildReservationResponse).mockReturnValue(mockResponseTemplate as any);
    vi.mocked(createRumor).mockReturnValue(mockRumor);
    vi.mocked(wrapEvent).mockReturnValue(mockGiftWrap);
    vi.mocked(publishToRelays).mockResolvedValue(mockPublishResult);

    // Set API base URL and make fetch fail
    const originalEnv = import.meta.env.VITE_API_BASE_URL;
    import.meta.env.VITE_API_BASE_URL = "https://api.example.com";

    const mockFetch = vi.fn().mockRejectedValue(new Error("API error"));
    global.fetch = mockFetch;

    // Should not throw
    await expect(
      acceptReservationDirect(request, privateKey, relays, pubkey)
    ).resolves.not.toThrow();

    // Restore
    import.meta.env.VITE_API_BASE_URL = originalEnv;
  });

  it("throws error when both gift wraps fail to publish", async () => {
    const request = createMockRequestMessage(baseTime, tzid);
    
    const { buildReservationResponse } = await import("./reservationEvents");
    const { createRumor, wrapEvent } = await import("./nip59");
    const { publishToRelays } = await import("./relayPool");

    const mockResponseTemplate = {
      kind: 9902,
      content: "",
      tags: [],
      created_at: Math.floor(Date.now() / 1000),
    };

    const mockRumor: Rumor = {
      ...mockResponseTemplate,
      id: "rumor-id-response",
      pubkey: pubkey,
    };

    const mockGiftWrap = {
      id: "gift-wrap-id",
      kind: 1059,
      tags: [],
    } as Event;

    vi.mocked(buildReservationResponse).mockReturnValue(mockResponseTemplate as any);
    vi.mocked(createRumor).mockReturnValue(mockRumor);
    vi.mocked(wrapEvent).mockReturnValue(mockGiftWrap);
    vi.mocked(publishToRelays).mockRejectedValue(new Error("Publish failed"));

    await expect(
      acceptReservationDirect(request, privateKey, relays, pubkey)
    ).rejects.toThrow("Failed to publish gift wraps");
  });

  it("does not throw error when only one gift wrap fails to publish", async () => {
    const request = createMockRequestMessage(baseTime, tzid);
    
    const { buildReservationResponse } = await import("./reservationEvents");
    const { createRumor, wrapEvent } = await import("./nip59");
    const { publishToRelays } = await import("./relayPool");

    const mockResponseTemplate = {
      kind: 9902,
      content: "",
      tags: [],
      created_at: Math.floor(Date.now() / 1000),
    };

    const mockRumor: Rumor = {
      ...mockResponseTemplate,
      id: "rumor-id-response",
      pubkey: pubkey,
    };

    const mockGiftWrap = {
      id: "gift-wrap-id",
      kind: 1059,
      tags: [],
    } as Event;

    const mockPublishResult = {
      eventId: "gift-wrap-id",
      results: [{ relay: relays[0], success: true }],
      allFailed: false,
      someSucceeded: true,
    };

    vi.mocked(buildReservationResponse).mockReturnValue(mockResponseTemplate as any);
    vi.mocked(createRumor).mockReturnValue(mockRumor);
    vi.mocked(wrapEvent).mockReturnValue(mockGiftWrap);
    // First publish succeeds, second fails
    vi.mocked(publishToRelays)
      .mockResolvedValueOnce(mockPublishResult)
      .mockRejectedValueOnce(new Error("Publish failed"));

    // Should not throw if at least one succeeds
    await expect(
      acceptReservationDirect(request, privateKey, relays, pubkey)
    ).resolves.not.toThrow();
  });

  it("extracts root rumor ID from e tag for non-request messages", async () => {
    const request = createMockRequestMessage(baseTime, tzid);
    // Make it look like a modification request
    request.type = "modification-request" as any;
    request.rumor.tags.push(["e", "root-rumor-id", "", "root"]);

    const { buildReservationResponse } = await import("./reservationEvents");
    const { createRumor, wrapEvent } = await import("./nip59");
    const { publishToRelays } = await import("./relayPool");

    const mockResponseTemplate = {
      kind: 9902,
      content: "",
      tags: [],
      created_at: Math.floor(Date.now() / 1000),
    };

    const mockRumor: Rumor = {
      ...mockResponseTemplate,
      id: "rumor-id-response",
      pubkey: pubkey,
    };

    const mockGiftWrap = {
      id: "gift-wrap-id",
      kind: 1059,
      tags: [],
    } as Event;

    const mockPublishResult = {
      eventId: "gift-wrap-id",
      results: [{ relay: relays[0], success: true }],
      allFailed: false,
      someSucceeded: true,
    };

    vi.mocked(buildReservationResponse).mockReturnValue(mockResponseTemplate as any);
    vi.mocked(createRumor).mockReturnValue(mockRumor);
    vi.mocked(wrapEvent).mockReturnValue(mockGiftWrap);
    vi.mocked(publishToRelays).mockResolvedValue(mockPublishResult);

    await acceptReservationDirect(request, privateKey, relays, pubkey);

    // Verify buildReservationResponse was called with root rumor ID from e tag
    expect(buildReservationResponse).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      "root-rumor-id",
      expect.anything(),
      expect.anything()
    );
  });

  it("throws error when root rumor ID cannot be found", async () => {
    const request = createMockRequestMessage(baseTime, tzid);
    // Make it look like a modification request without root e tag
    request.type = "modification-request" as any;
    request.rumor.tags = []; // Remove all tags

    await expect(
      acceptReservationDirect(request, privateKey, relays, pubkey)
    ).rejects.toThrow("Cannot find root rumor ID in message tags");
  });
});

