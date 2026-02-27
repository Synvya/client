import { create } from "zustand";
import { persist } from "zustand/middleware";

interface OnboardingProgressState {
  profilePublished: boolean;
  menuPublished: boolean;
  chatgptSubmitted: boolean;
  /** The published Synvya.com discovery page URL, or null if not published */
  discoveryPageUrl: string | null;
  keyBackedUp: boolean;
  restaurantName: string | null;

  setProfilePublished: (published: boolean) => void;
  setMenuPublished: (published: boolean) => void;
  setChatgptSubmitted: (submitted: boolean) => void;
  setDiscoveryPageUrl: (url: string | null) => void;
  setKeyBackedUp: (backedUp: boolean) => void;
  setRestaurantName: (name: string | null) => void;
  reset: () => void;
}

const initialState = {
  profilePublished: false,
  menuPublished: false,
  chatgptSubmitted: false,
  discoveryPageUrl: null as string | null,
  keyBackedUp: false,
  restaurantName: null as string | null
};

/**
 * Onboarding progress state management
 * Tracks completion status across Profile, Menu tabs, discovery page URL, and key backup
 * Used by Header for completion indicators and Account page for checklist
 * 
 * Note: Discovery is considered "published" when discoveryPageUrl is non-null
 */
export const useOnboardingProgress = create<OnboardingProgressState>()(
  persist(
    (set) => ({
      ...initialState,
      setProfilePublished: (published) => set({ profilePublished: published }),
      setMenuPublished: (published) => set({ menuPublished: published }),
      setChatgptSubmitted: (submitted) => set({ chatgptSubmitted: submitted }),
      setDiscoveryPageUrl: (url) => set({ discoveryPageUrl: url }),
      setKeyBackedUp: (backedUp) => set({ keyBackedUp: backedUp }),
      setRestaurantName: (name) => set({ restaurantName: name }),
      reset: () => set(initialState)
    }),
    {
      name: "synvya-onboarding-progress"
    }
  )
);

/**
 * Get a snapshot of the current onboarding progress state
 * Useful for non-reactive contexts
 */
export function getOnboardingProgressSnapshot(): Omit<OnboardingProgressState,
  'setProfilePublished' | 'setMenuPublished' | 'setChatgptSubmitted' | 'setDiscoveryPageUrl' |
  'setKeyBackedUp' | 'setRestaurantName' | 'reset'
> {
  const state = useOnboardingProgress.getState();
  return {
    profilePublished: state.profilePublished,
    menuPublished: state.menuPublished,
    chatgptSubmitted: state.chatgptSubmitted,
    discoveryPageUrl: state.discoveryPageUrl,
    keyBackedUp: state.keyBackedUp,
    restaurantName: state.restaurantName
  };
}
