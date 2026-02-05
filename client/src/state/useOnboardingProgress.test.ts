import { describe, it, expect, beforeEach } from "vitest";
import { useOnboardingProgress, getOnboardingProgressSnapshot } from "./useOnboardingProgress";

describe("useOnboardingProgress", () => {
  beforeEach(() => {
    // Reset state before each test
    useOnboardingProgress.getState().reset();
  });

  it("should initialize with default values", () => {
    const state = useOnboardingProgress.getState();
    expect(state.profilePublished).toBe(false);
    expect(state.menuPublished).toBe(false);
    expect(state.discoveryPageUrl).toBeNull();
    expect(state.keyBackedUp).toBe(false);
    expect(state.restaurantName).toBeNull();
  });

  describe("setProfilePublished", () => {
    it("should set profilePublished to true", () => {
      const { setProfilePublished } = useOnboardingProgress.getState();
      setProfilePublished(true);

      expect(useOnboardingProgress.getState().profilePublished).toBe(true);
    });

    it("should set profilePublished to false", () => {
      const { setProfilePublished } = useOnboardingProgress.getState();
      setProfilePublished(true);
      setProfilePublished(false);

      expect(useOnboardingProgress.getState().profilePublished).toBe(false);
    });
  });

  describe("setMenuPublished", () => {
    it("should set menuPublished to true", () => {
      const { setMenuPublished } = useOnboardingProgress.getState();
      setMenuPublished(true);

      expect(useOnboardingProgress.getState().menuPublished).toBe(true);
    });

    it("should set menuPublished to false", () => {
      const { setMenuPublished } = useOnboardingProgress.getState();
      setMenuPublished(true);
      setMenuPublished(false);

      expect(useOnboardingProgress.getState().menuPublished).toBe(false);
    });
  });

  describe("setDiscoveryPageUrl", () => {
    it("should set discoveryPageUrl to a URL", () => {
      const { setDiscoveryPageUrl } = useOnboardingProgress.getState();
      setDiscoveryPageUrl("https://synvya.com/restaurant/test/");

      expect(useOnboardingProgress.getState().discoveryPageUrl).toBe("https://synvya.com/restaurant/test/");
    });

    it("should update discoveryPageUrl", () => {
      const { setDiscoveryPageUrl } = useOnboardingProgress.getState();
      setDiscoveryPageUrl("https://synvya.com/restaurant/old/");
      setDiscoveryPageUrl("https://synvya.com/restaurant/new/");

      expect(useOnboardingProgress.getState().discoveryPageUrl).toBe("https://synvya.com/restaurant/new/");
    });

    it("should set discoveryPageUrl to null", () => {
      const { setDiscoveryPageUrl } = useOnboardingProgress.getState();
      setDiscoveryPageUrl("https://synvya.com/restaurant/test/");
      setDiscoveryPageUrl(null);

      expect(useOnboardingProgress.getState().discoveryPageUrl).toBeNull();
    });
  });

  describe("setKeyBackedUp", () => {
    it("should set keyBackedUp to true", () => {
      const { setKeyBackedUp } = useOnboardingProgress.getState();
      setKeyBackedUp(true);

      expect(useOnboardingProgress.getState().keyBackedUp).toBe(true);
    });

    it("should set keyBackedUp to false", () => {
      const { setKeyBackedUp } = useOnboardingProgress.getState();
      setKeyBackedUp(true);
      setKeyBackedUp(false);

      expect(useOnboardingProgress.getState().keyBackedUp).toBe(false);
    });
  });

  describe("setRestaurantName", () => {
    it("should set restaurantName", () => {
      const { setRestaurantName } = useOnboardingProgress.getState();
      setRestaurantName("Chickadee Bakeshop");

      expect(useOnboardingProgress.getState().restaurantName).toBe("Chickadee Bakeshop");
    });

    it("should update restaurantName", () => {
      const { setRestaurantName } = useOnboardingProgress.getState();
      setRestaurantName("Chickadee Bakeshop");
      setRestaurantName("The Local Cafe");

      expect(useOnboardingProgress.getState().restaurantName).toBe("The Local Cafe");
    });

    it("should set restaurantName to null", () => {
      const { setRestaurantName } = useOnboardingProgress.getState();
      setRestaurantName("Chickadee Bakeshop");
      setRestaurantName(null);

      expect(useOnboardingProgress.getState().restaurantName).toBeNull();
    });
  });

  describe("reset", () => {
    it("should reset all values to defaults", () => {
      const state = useOnboardingProgress.getState();
      
      // Set all values
      state.setProfilePublished(true);
      state.setMenuPublished(true);
      state.setDiscoveryPageUrl("https://synvya.com/restaurant/test/");
      state.setKeyBackedUp(true);
      state.setRestaurantName("Test Restaurant");

      // Verify they are set
      expect(useOnboardingProgress.getState().profilePublished).toBe(true);
      expect(useOnboardingProgress.getState().menuPublished).toBe(true);
      expect(useOnboardingProgress.getState().discoveryPageUrl).toBe("https://synvya.com/restaurant/test/");
      expect(useOnboardingProgress.getState().keyBackedUp).toBe(true);
      expect(useOnboardingProgress.getState().restaurantName).toBe("Test Restaurant");

      // Reset
      useOnboardingProgress.getState().reset();

      // Verify all are reset
      expect(useOnboardingProgress.getState().profilePublished).toBe(false);
      expect(useOnboardingProgress.getState().menuPublished).toBe(false);
      expect(useOnboardingProgress.getState().discoveryPageUrl).toBeNull();
      expect(useOnboardingProgress.getState().keyBackedUp).toBe(false);
      expect(useOnboardingProgress.getState().restaurantName).toBeNull();
    });
  });

  describe("state independence", () => {
    it("should update individual properties without affecting others", () => {
      const state = useOnboardingProgress.getState();
      
      state.setProfilePublished(true);
      expect(useOnboardingProgress.getState().profilePublished).toBe(true);
      expect(useOnboardingProgress.getState().menuPublished).toBe(false);
      expect(useOnboardingProgress.getState().discoveryPageUrl).toBeNull();

      state.setMenuPublished(true);
      expect(useOnboardingProgress.getState().profilePublished).toBe(true);
      expect(useOnboardingProgress.getState().menuPublished).toBe(true);
      expect(useOnboardingProgress.getState().discoveryPageUrl).toBeNull();

      state.setRestaurantName("Test");
      expect(useOnboardingProgress.getState().profilePublished).toBe(true);
      expect(useOnboardingProgress.getState().menuPublished).toBe(true);
      expect(useOnboardingProgress.getState().restaurantName).toBe("Test");
    });
  });
});

describe("getOnboardingProgressSnapshot", () => {
  beforeEach(() => {
    useOnboardingProgress.getState().reset();
  });

  it("should return current state values", () => {
    const state = useOnboardingProgress.getState();
    state.setProfilePublished(true);
    state.setRestaurantName("My Restaurant");
    state.setDiscoveryPageUrl("https://synvya.com/restaurant/my-restaurant/");

    const snapshot = getOnboardingProgressSnapshot();

    expect(snapshot.profilePublished).toBe(true);
    expect(snapshot.menuPublished).toBe(false);
    expect(snapshot.discoveryPageUrl).toBe("https://synvya.com/restaurant/my-restaurant/");
    expect(snapshot.keyBackedUp).toBe(false);
    expect(snapshot.restaurantName).toBe("My Restaurant");
  });

  it("should not include action functions", () => {
    const snapshot = getOnboardingProgressSnapshot();
    
    // Type check: snapshot should not have action functions
    expect(snapshot).not.toHaveProperty("setProfilePublished");
    expect(snapshot).not.toHaveProperty("setMenuPublished");
    expect(snapshot).not.toHaveProperty("setDiscoveryPageUrl");
    expect(snapshot).not.toHaveProperty("setKeyBackedUp");
    expect(snapshot).not.toHaveProperty("setRestaurantName");
    expect(snapshot).not.toHaveProperty("reset");
  });

  it("should return a new snapshot reflecting current state", () => {
    const snapshot1 = getOnboardingProgressSnapshot();
    expect(snapshot1.profilePublished).toBe(false);

    useOnboardingProgress.getState().setProfilePublished(true);

    const snapshot2 = getOnboardingProgressSnapshot();
    expect(snapshot2.profilePublished).toBe(true);
    
    // Original snapshot is unchanged (it's a copy)
    expect(snapshot1.profilePublished).toBe(false);
  });
});
