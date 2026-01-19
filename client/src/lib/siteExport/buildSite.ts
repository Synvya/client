import type { BusinessProfile } from "@/types/profile";
import type { SquareEventTemplate } from "@/services/square";
import { buildFoodEstablishmentSchema, buildMenuSchema } from "@/lib/schemaOrg";
import { buildExportSiteModel, renderSinglePageHtml, type ExportSiteModel } from "./templates";
import { slugify } from "./slug";

export function buildStaticSiteFiles(params: {
  profile: BusinessProfile;
  geohash?: string | null;
  menuEvents: SquareEventTemplate[] | null;
  merchantPubkey: string;
  profileTags?: string[][] | null;
  typeSlug: string;
  nameSlug: string;
}): { html: string; handle: string } {
  const { profile, geohash, menuEvents, merchantPubkey, profileTags } = params;
  const model = buildExportSiteModel({
    profile,
    geohash,
    menuEvents,
    merchantPubkey,
    typeSlug: params.typeSlug,
    nameSlug: params.nameSlug,
  });

  // Build FoodEstablishment schema
  const establishment = buildFoodEstablishmentSchema(profile, {
    geohash: geohash ?? null,
    pubkeyHex: merchantPubkey,
    kind0Tags: profileTags ?? undefined,
  }) as unknown as Record<string, unknown>;

  // Build menu schema with full nested structure
  const menusSchema =
    menuEvents && menuEvents.length
      ? buildMenuSchema(profile.displayName || profile.name, menuEvents, merchantPubkey, model.baseUrl)
      : [];

  // Consolidate schema: FoodEstablishment with full nested menus and menu items
  const consolidatedSchema = {
    "@context": "https://schema.org",
    ...establishment,
    ...(menusSchema.length > 0 ? { hasMenu: menusSchema } : {}),
  };

  // Generate handle from restaurant name (without extension)
  const handle = slugify(profile.name || profile.displayName || "restaurant");

  // Render single-page HTML
  const html = renderSinglePageHtml(model, consolidatedSchema);

  return { html, handle };
}


