import type { BusinessType } from "@/types/profile";

export type EstablishmentTypeSlug =
  | "bakery"
  | "bar"
  | "brewery"
  | "cafe"
  | "distillery"
  | "fast-food"
  | "ice-cream"
  | "restaurant"
  | "winery";

export function mapBusinessTypeToEstablishmentSlug(businessType: BusinessType): EstablishmentTypeSlug {
  switch (businessType) {
    case "bakery":
      return "bakery";
    case "barOrPub":
      return "bar";
    case "brewery":
      return "brewery";
    case "cafeOrCoffeeShop":
      return "cafe";
    case "distillery":
      return "distillery";
    case "fastFoodRestaurant":
      return "fast-food";
    case "iceCreamShop":
      return "ice-cream";
    case "restaurant":
      return "restaurant";
    case "winery":
      return "winery";
  }
}


