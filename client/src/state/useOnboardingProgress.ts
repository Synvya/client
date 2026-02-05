import { create } from "zustand";
import { persist } from "zustand/middleware";

interface OnboardingProgressState {
  profilePublished: boolean;
  menuPublished: boolean;
  discoveryPublished: boolean;
  keyBackedUp: boolean;
  restaurantName: string | null;

  setProfilePublished: (published: boolean) => void;
  setMenuPublished: (published: boolean) => void;
  setDiscoveryPublished: (published: boolean) => void;
  setKeyBackedUp: (backedUp: boolean) => void;
  setRestaurantName: (name: string | null) => void;
  reset: () => void;
}

const initialState = {
  profilePublished: false,
  menuPublished: false,
  discoveryPublished: false,
  keyBackedUp: false,
  restaurantName: null
};

/**
 * Onboarding progress state management
 * Tracks completion status across Profile, Menu, Discovery tabs and key backup
 * Used by Header for completion indicators and Account page for checklist
 */
export const useOnboardingProgress = create<OnboardingProgressState>()(
  persist(
    (set) => ({
      ...initialState,
      setProfilePublished: (published) => set({ profilePublished: published }),
      setMenuPublished: (published) => set({ menuPublished: published }),
      setDiscoveryPublished: (published) => set({ discoveryPublished: published }),
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
  'setProfilePublished' | 'setMenuPublished' | 'setDiscoveryPublished' | 
  'setKeyBackedUp' | 'setRestaurantName' | 'reset'
> {
  const state = useOnboardingProgress.getState();
  return {
    profilePublished: state.profilePublished,
    menuPublished: state.menuPublished,
    discoveryPublished: state.discoveryPublished,
    keyBackedUp: state.keyBackedUp,
    restaurantName: state.restaurantName
  };
}
