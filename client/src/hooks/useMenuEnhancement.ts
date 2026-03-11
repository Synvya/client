import { useState } from "react";
import type { MenuReviewState } from "@/lib/menuImport/types";
import { enrichMenuDescriptions, generateMenuItemImage } from "@/services/menuImport";

interface UseMenuEnhancementParams {
  reviewState: MenuReviewState | null;
  setReviewState: React.Dispatch<React.SetStateAction<MenuReviewState | null>>;
  setError: (msg: string | null) => void;
  setNotice: (msg: string | null) => void;
}

const ENRICH_BATCH_SIZE = 10;

export function useMenuEnhancement({
  reviewState,
  setReviewState,
  setError,
  setNotice,
}: UseMenuEnhancementParams) {
  const [enrichProgress, setEnrichProgress] = useState<{ current: number; total: number } | null>(null);
  const [imageGenProgress, setImageGenProgress] = useState<{ current: number; total: number } | null>(null);

  const handleEnrich = async () => {
    if (!reviewState) return;
    setError(null);

    const allItems = reviewState.items.map((i) => ({
      name: i.name,
      description: i.description,
      ingredients: i.ingredients,
    }));
    const total = allItems.length;
    setEnrichProgress({ current: 0, total });

    try {
      const enrichMap = new Map<string, string>();

      // Process in batches so the progress counter advances as each batch completes.
      for (let start = 0; start < total; start += ENRICH_BATCH_SIZE) {
        const batch = allItems.slice(start, start + ENRICH_BATCH_SIZE);
        const result = await enrichMenuDescriptions(batch, { name: "", cuisine: "", about: "" });
        for (const item of result.items) {
          enrichMap.set(item.name, item.enrichedDescription);
        }
        const done = Math.min(start + ENRICH_BATCH_SIZE, total);
        setEnrichProgress({ current: done, total });
      }

      setReviewState((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          items: prev.items.map((item) => ({
            ...item,
            enrichedDescription: enrichMap.get(item.name) || item.enrichedDescription,
          })),
        };
      });
      setNotice("Descriptions enriched successfully.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to enrich descriptions.";
      setError(message);
    } finally {
      setEnrichProgress(null);
    }
  };

  const handleGenerateImages = async () => {
    if (!reviewState) return;
    setError(null);

    const enabledItems = reviewState.items
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => item.imageGenStatus !== "done");

    if (!enabledItems.length) {
      setNotice("All items already have generated images.");
      return;
    }

    setImageGenProgress({ current: 0, total: enabledItems.length });

    for (let i = 0; i < enabledItems.length; i++) {
      const { item, index } = enabledItems[i];
      setImageGenProgress({ current: i + 1, total: enabledItems.length });

      setReviewState((prev) => {
        if (!prev) return prev;
        const items = [...prev.items];
        items[index] = { ...items[index], imageGenStatus: "generating" };
        return { ...prev, items };
      });

      try {
        const result = await generateMenuItemImage({
          itemName: item.name,
          imageDescription: item.imageDescription,
          cuisineContext: "",
        });

        setReviewState((prev) => {
          if (!prev) return prev;
          const items = [...prev.items];
          items[index] = { ...items[index], generatedImageUrl: result.url, imageGenStatus: "done" };
          return { ...prev, items };
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Image generation failed";
        setReviewState((prev) => {
          if (!prev) return prev;
          const items = [...prev.items];
          items[index] = { ...items[index], imageGenStatus: "error", imageGenError: message };
          return { ...prev, items };
        });
      }
    }

    setImageGenProgress(null);
    setNotice("Image generation complete.");
  };

  const handleRegenerateImage = async (index: number) => {
    if (!reviewState) return;
    const item = reviewState.items[index];
    if (!item) return;

    setReviewState((prev) => {
      if (!prev) return prev;
      const items = [...prev.items];
      items[index] = { ...items[index], imageGenStatus: "generating", imageGenError: undefined };
      return { ...prev, items };
    });

    try {
      const result = await generateMenuItemImage({
        itemName: item.name,
        imageDescription: item.imageDescription,
        cuisineContext: "",
      });
      setReviewState((prev) => {
        if (!prev) return prev;
        const items = [...prev.items];
        items[index] = { ...items[index], generatedImageUrl: result.url, imageGenStatus: "done" };
        return { ...prev, items };
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Image generation failed";
      setReviewState((prev) => {
        if (!prev) return prev;
        const items = [...prev.items];
        items[index] = { ...items[index], imageGenStatus: "error", imageGenError: message };
        return { ...prev, items };
      });
    }
  };

  return {
    enrichProgress,
    imageGenProgress,
    handleEnrich,
    handleGenerateImages,
    handleRegenerateImage,
  };
}
