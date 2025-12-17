import { describe, it, expect } from "vitest";
import {
  isValidEventFormat,
  extractCollectionRefs,
  extractProductRefs,
  deduplicateEvents
} from "./nostrEventProcessing";
import type { Event } from "nostr-tools";
import type { SquareEventTemplate } from "@/services/square";

describe("nostrEventProcessing", () => {
  const testPubkey = "e01e4b0b3677204161b8d13d0a7b88e5d2e7dac2f7d2cc5530a3bc1dca3fbd2f";

  describe("isValidEventFormat", () => {
    it("should accept events with correct 'a' tag format", () => {
      const event: SquareEventTemplate = {
        kind: 30402,
        created_at: Date.now(),
        content: "",
        tags: [["a", "30405:pubkey123:Entrees"]]
      };

      expect(isValidEventFormat(event)).toBe(true);
    });

    it("should reject events with wrong 'a' tag format (multiple elements)", () => {
      const event: SquareEventTemplate = {
        kind: 30402,
        created_at: Date.now(),
        content: "",
        tags: [["a", "30405", "pubkey123", "Entrees"]]
      };

      expect(isValidEventFormat(event)).toBe(false);
    });

    it("should reject events with invalid address string format", () => {
      const event: SquareEventTemplate = {
        kind: 30402,
        created_at: Date.now(),
        content: "",
        tags: [["a", "invalid-format"]]
      };

      expect(isValidEventFormat(event)).toBe(false);
    });

    it("should reject events with wrong kind in address", () => {
      const event: SquareEventTemplate = {
        kind: 30402,
        created_at: Date.now(),
        content: "",
        tags: [["a", "99999:pubkey123:Entrees"]]
      };

      expect(isValidEventFormat(event)).toBe(false);
    });

    it("should accept events without 'a' tags", () => {
      const event: SquareEventTemplate = {
        kind: 30402,
        created_at: Date.now(),
        content: "",
        tags: [["d", "product-1"], ["title", "Product"]]
      };

      expect(isValidEventFormat(event)).toBe(true);
    });

    it("should accept events with multiple correct 'a' tags", () => {
      const event: SquareEventTemplate = {
        kind: 30402,
        created_at: Date.now(),
        content: "",
        tags: [
          ["a", "30405:pubkey123:Entrees"],
          ["a", "30405:pubkey123:Dinner"]
        ]
      };

      expect(isValidEventFormat(event)).toBe(true);
    });
  });

  describe("extractCollectionRefs", () => {
    it("should extract collection d-tags from correct format", () => {
      const event: SquareEventTemplate = {
        kind: 30402,
        created_at: Date.now(),
        content: "",
        tags: [
          ["a", `30405:${testPubkey}:Entrees`],
          ["a", `30405:${testPubkey}:Dinner`]
        ]
      };

      const refs = extractCollectionRefs(event, testPubkey);
      expect(refs).toHaveLength(2);
      expect(refs).toContain("Entrees");
      expect(refs).toContain("Dinner");
    });

    it("should ignore 'a' tags with wrong pubkey", () => {
      const event: SquareEventTemplate = {
        kind: 30402,
        created_at: Date.now(),
        content: "",
        tags: [
          ["a", `30405:${testPubkey}:Entrees`],
          ["a", "30405:wrongpubkey:Dinner"]
        ]
      };

      const refs = extractCollectionRefs(event, testPubkey);
      expect(refs).toHaveLength(1);
      expect(refs).toContain("Entrees");
    });

    it("should return empty array for events without 'a' tags", () => {
      const event: SquareEventTemplate = {
        kind: 30402,
        created_at: Date.now(),
        content: "",
        tags: [["d", "product-1"], ["title", "Product"]]
      };

      const refs = extractCollectionRefs(event, testPubkey);
      expect(refs).toHaveLength(0);
    });

    it("should ignore legacy format 'a' tags", () => {
      const event: SquareEventTemplate = {
        kind: 30402,
        created_at: Date.now(),
        content: "",
        tags: [
          ["a", "30405", testPubkey, "Entrees"], // Legacy format - should be ignored
          ["a", `30405:${testPubkey}:Dinner`] // Correct format
        ]
      };

      const refs = extractCollectionRefs(event, testPubkey);
      expect(refs).toHaveLength(1);
      expect(refs).toContain("Dinner");
    });
  });

  describe("extractProductRefs", () => {
    it("should extract product d-tags from correct format", () => {
      const event: SquareEventTemplate = {
        kind: 30405,
        created_at: Date.now(),
        content: "",
        tags: [
          ["a", `30402:${testPubkey}:product-1`],
          ["a", `30402:${testPubkey}:product-2`]
        ]
      };

      const refs = extractProductRefs(event, testPubkey);
      expect(refs).toHaveLength(2);
      expect(refs).toContain("product-1");
      expect(refs).toContain("product-2");
    });
  });

  describe("deduplicateEvents", () => {
    it("should filter invalid events first", () => {
      const events: Event[] = [
        {
          id: "1",
          kind: 30402,
          pubkey: testPubkey,
          created_at: 1000,
          content: "",
          sig: "sig1",
          tags: [["a", "30405:pubkey123:Entrees"]] // Correct format
        },
        {
          id: "2",
          kind: 30402,
          pubkey: testPubkey,
          created_at: 2000,
          content: "",
          sig: "sig2",
          tags: [["a", "30405", "pubkey123", "Dinner"]] // Wrong format - should be filtered
        }
      ];

      const result = deduplicateEvents(events, testPubkey);
      expect(result).toHaveLength(1);
      expect(result[0].created_at).toBe(1000);
    });

    it("should deduplicate by d-tag first (keep latest)", () => {
      const events: Event[] = [
        {
          id: "1",
          kind: 30402,
          pubkey: testPubkey,
          created_at: 1000,
          content: "",
          sig: "sig1",
          tags: [
            ["d", "product-1"],
            ["title", "Product"]
          ]
        },
        {
          id: "2",
          kind: 30402,
          pubkey: testPubkey,
          created_at: 2000,
          content: "Updated content",
          sig: "sig2",
          tags: [
            ["d", "product-1"], // Same d-tag
            ["title", "Product"]
          ]
        }
      ];

      const result = deduplicateEvents(events, testPubkey);
      expect(result).toHaveLength(1);
      expect(result[0].created_at).toBe(2000);
      expect(result[0].content).toBe("Updated content");
    });

    it("should deduplicate by name second (keep latest)", () => {
      const events: Event[] = [
        {
          id: "1",
          kind: 30402,
          pubkey: testPubkey,
          created_at: 1000,
          content: "",
          sig: "sig1",
          tags: [
            ["d", "product-1"],
            ["title", "Bacalao"]
          ]
        },
        {
          id: "2",
          kind: 30402,
          pubkey: testPubkey,
          created_at: 2000,
          content: "Updated",
          sig: "sig2",
          tags: [
            ["d", "product-2"], // Different d-tag
            ["title", "Bacalao"] // Same title
          ]
        }
      ];

      const result = deduplicateEvents(events, testPubkey);
      expect(result).toHaveLength(1);
      expect(result[0].created_at).toBe(2000);
      expect(result[0].content).toBe("Updated");
      // Should keep the one with d-tag "product-2" (latest)
      const dTag = result[0].tags.find((t) => t[0] === "d")?.[1];
      expect(dTag).toBe("product-2");
    });

    it("should handle both deduplication passes correctly", () => {
      const events: Event[] = [
        // Same d-tag, different timestamps
        {
          id: "1",
          kind: 30402,
          pubkey: testPubkey,
          created_at: 1000,
          content: "Old",
          sig: "sig1",
          tags: [
            ["d", "product-1"],
            ["title", "Bacalao"]
          ]
        },
        {
          id: "2",
          kind: 30402,
          pubkey: testPubkey,
          created_at: 2000,
          content: "Newer",
          sig: "sig2",
          tags: [
            ["d", "product-1"], // Same d-tag - first pass should keep this
            ["title", "Bacalao"]
          ]
        },
        // Different d-tag, same title, newer timestamp
        {
          id: "3",
          kind: 30402,
          pubkey: testPubkey,
          created_at: 3000,
          content: "Newest",
          sig: "sig3",
          tags: [
            ["d", "product-3"], // Different d-tag
            ["title", "Bacalao"] // Same title - second pass should keep this
          ]
        }
      ];

      const result = deduplicateEvents(events, testPubkey);
      // After first pass: keep id "2" (same d-tag, latest) and id "3" (different d-tag)
      // After second pass: keep id "3" (same title, latest)
      expect(result).toHaveLength(1);
      expect(result[0].created_at).toBe(3000);
      expect(result[0].content).toBe("Newest");
    });

    it("should handle events without d-tags", () => {
      const events: Event[] = [
        {
          id: "1",
          kind: 30402,
          pubkey: testPubkey,
          created_at: 1000,
          content: "",
          sig: "sig1",
          tags: [["title", "Product"]] // No d-tag
        },
        {
          id: "2",
          kind: 30402,
          pubkey: testPubkey,
          created_at: 2000,
          content: "",
          sig: "sig2",
          tags: [["title", "Product"]] // No d-tag, same title
        }
      ];

      const result = deduplicateEvents(events, testPubkey);
      // Should deduplicate by name (second pass)
      expect(result).toHaveLength(1);
      expect(result[0].created_at).toBe(2000);
    });

    it("should handle events without titles", () => {
      const events: Event[] = [
        {
          id: "1",
          kind: 30402,
          pubkey: testPubkey,
          created_at: 1000,
          content: "",
          sig: "sig1",
          tags: [["d", "product-1"]] // No title
        },
        {
          id: "2",
          kind: 30402,
          pubkey: testPubkey,
          created_at: 2000,
          content: "",
          sig: "sig2",
          tags: [["d", "product-1"]] // Same d-tag, no title
        }
      ];

      const result = deduplicateEvents(events, testPubkey);
      // Should deduplicate by d-tag (first pass)
      expect(result).toHaveLength(1);
      expect(result[0].created_at).toBe(2000);
    });
  });
});

