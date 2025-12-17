import { describe, it, expect } from "vitest";
import { naddrForAddressableEvent } from "./naddr";

describe("siteExport naddr", () => {
  it("generates a stable naddr for known demo item", () => {
    // From internal/naddr/naddr_reference.txt
    const pubkey = "e01e4b0b3677204161b8d13d0a7b88e5d2e7dac2f7d2cc5530a3bc1dca3fbd2f";
    const identifier = "sq-c9ab1636203e078f";
    const expected =
      "naddr1qqfhxufdvvukzc33xcenvv3sxdjnqdecvcpzpcq7fv9nvaeqg9sm35fapfac3ewjuldv9a7je32npgaurh9rl0f0qvzqqqrkcghtkxua";

    expect(naddrForAddressableEvent({ identifier, pubkey, kind: 30402 })).toBe(expected);
  });
});


