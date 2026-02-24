import { useState } from "react";
import type { MenuReviewState } from "@/lib/menuImport/types";
import { enrichMenuDescriptions, generateMenuItemImage } from "@/services/menuImport";

interface UseMenuEnhancementParams {
  reviewState: MenuReviewState | null;
  setReviewState: React.Dispatch<React.SetStateAction<MenuReviewState | null>>;
  setError: (msg: string | null) => void;
  setNotice: (msg: string | null) => void;
}

export function useMenuEnhancement({
  reviewState,
  setReviewState,
  setError,
  setNotice,
}: UseMenuEnhancementParams) {
  const [enriching, setEnriching] = useState(false);
  const [imageGenProgress, setImageGenProgress] = useState<{ current: number; total: number } | null>(null);

  const handleEnrich = async () => {
    if (!reviewState) return;
    setError(null);
    setEnriching(true);
    try {
      const result = await enrichMenuDescriptions(
        reviewState.items.map((i) => ({
          name: i.name,
          description: i.description,
          ingredients: i.ingredients,
        })),
        { name: "", cuisine: "", about: "" },
      );

      const enrichMap = new Map(result.items.map((i) => [i.name, i.enrichedDescription]));
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
      setEnriching(false);
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
    enriching,
    imageGenProgress,
    handleEnrich,
    handleGenerateImages,
    handleRegenerateImage,
  };
}
