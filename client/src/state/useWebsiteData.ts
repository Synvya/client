import { create } from "zustand";
import { persist } from "zustand/middleware";
import { generateLDJsonScript } from "@/lib/schemaOrg";
import type { BusinessProfile } from "@/types/profile";
import type { SquareEventTemplate } from "@/services/square";

interface WebsiteDataState {
  schema: string | null;
  lastUpdated: Date | null;
  updateSchema: (
    profile: BusinessProfile,
    menuEvents?: SquareEventTemplate[] | null,
    geohash?: string | null
  ) => void;
  clearSchema: () => void;
}

/**
 * Website Data state management
 * Stores generated schema.org LD-JSON script for merchants to embed in their website
 */
export const useWebsiteData = create<WebsiteDataState>()(
  persist(
    (set) => ({
      schema: null,
      lastUpdated: null,
      updateSchema: (profile, menuEvents, geohash) => {
        try {
          const schema = generateLDJsonScript(profile, menuEvents, geohash);
          set({ schema, lastUpdated: new Date() });
        } catch (error) {
          console.error("Failed to generate schema:", error);
          // Don't update state if generation fails
        }
      },
      clearSchema: () => set({ schema: null, lastUpdated: null })
    }),
    {
      name: "synvya-website-data-storage",
      // Custom serialization to handle Date objects
      partialize: (state) => ({
        schema: state.schema,
        lastUpdated: state.lastUpdated?.toISOString() ?? null
      }),
      // Custom deserialization to convert ISO strings back to Date
      merge: (persistedState, currentState) => {
        const persisted = persistedState as Partial<{
          schema: string | null;
          lastUpdated: string | null;
        }>;
        return {
          ...currentState,
          schema: persisted.schema ?? currentState.schema,
          lastUpdated: persisted.lastUpdated ? new Date(persisted.lastUpdated) : currentState.lastUpdated
        };
      }
    }
  )
);

/**
 * Get current schema snapshot without subscribing to updates
 */
export function getSchemaSnapshot(): string | null {
  return useWebsiteData.getState().schema;
}

/**
 * Get last updated timestamp snapshot without subscribing to updates
 */
export function getLastUpdatedSnapshot(): Date | null {
  return useWebsiteData.getState().lastUpdated;
}

