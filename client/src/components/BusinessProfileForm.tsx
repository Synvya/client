import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/state/useAuth";
import { useRelays } from "@/state/useRelays";
import { useMemberOf } from "@/state/useMemberOf";
import type { BusinessProfile, BusinessType } from "@/types/profile";
import { buildProfileEvent } from "@/lib/events";
import { publishToRelays, getPool } from "@/lib/relayPool";
import { geocodeLocation } from "@/lib/geocode";
import { buildDmRelayEvent } from "@/lib/handlerEvents";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { uploadMedia } from "@/services/upload";
import type { Event } from "nostr-tools";
import { Image as ImageIcon, UploadCloud, Clock } from "lucide-react";
import { useBusinessProfile } from "@/state/useBusinessProfile";
import { OpeningHoursDialog } from "@/components/OpeningHoursDialog";
import type { OpeningHoursSpec } from "@/types/profile";

interface FormStatus {
  type: "idle" | "success" | "error";
  message: string | null;
  eventId?: string;
}

const businessTypes: { label: string; value: BusinessType }[] = [
  { label: "Bakery", value: "bakery" },
  { label: "Bar or Pub", value: "barOrPub" },
  { label: "Brewery", value: "brewery" },
  { label: "Cafe or Coffee Shop", value: "cafeOrCoffeeShop" },
  { label: "Distillery", value: "distillery" },
  { label: "Fast Food Restaurant", value: "fastFoodRestaurant" },
  { label: "Ice Cream Shop", value: "iceCreamShop" },
  { label: "Restaurant", value: "restaurant" },
  { label: "Winery", value: "winery" }
];

const allowedBusinessTypes = new Set<BusinessType>(businessTypes.map((item) => item.value));

/**
 * Maps Schema.org URL to BusinessType (camelCase)
 * e.g., "https://schema.org:BarOrPub" → "barOrPub"
 */
function schemaOrgUrlToBusinessType(url: string): BusinessType | null {
  if (!url.startsWith("https://schema.org:")) {
    return null;
  }
  const typeName = url.slice("https://schema.org:".length);
  // Convert PascalCase to camelCase
  const camelCase = typeName.charAt(0).toLowerCase() + typeName.slice(1);
  // Map to BusinessType
  const mapping: Record<string, BusinessType> = {
    "bakery": "bakery",
    "barOrPub": "barOrPub",
    "brewery": "brewery",
    "cafeOrCoffeeShop": "cafeOrCoffeeShop",
    "distillery": "distillery",
    "fastFoodRestaurant": "fastFoodRestaurant",
    "iceCreamShop": "iceCreamShop",
    "restaurant": "restaurant",
    "winery": "winery"
  };
  return mapping[camelCase] || null;
}

const usStates: { label: string; value: string }[] = [
  { label: "Alabama", value: "AL" },
  { label: "Alaska", value: "AK" },
  { label: "Arizona", value: "AZ" },
  { label: "Arkansas", value: "AR" },
  { label: "California", value: "CA" },
  { label: "Colorado", value: "CO" },
  { label: "Connecticut", value: "CT" },
  { label: "Delaware", value: "DE" },
  { label: "Florida", value: "FL" },
  { label: "Georgia", value: "GA" },
  { label: "Hawaii", value: "HI" },
  { label: "Idaho", value: "ID" },
  { label: "Illinois", value: "IL" },
  { label: "Indiana", value: "IN" },
  { label: "Iowa", value: "IA" },
  { label: "Kansas", value: "KS" },
  { label: "Kentucky", value: "KY" },
  { label: "Louisiana", value: "LA" },
  { label: "Maine", value: "ME" },
  { label: "Maryland", value: "MD" },
  { label: "Massachusetts", value: "MA" },
  { label: "Michigan", value: "MI" },
  { label: "Minnesota", value: "MN" },
  { label: "Mississippi", value: "MS" },
  { label: "Missouri", value: "MO" },
  { label: "Montana", value: "MT" },
  { label: "Nebraska", value: "NE" },
  { label: "Nevada", value: "NV" },
  { label: "New Hampshire", value: "NH" },
  { label: "New Jersey", value: "NJ" },
  { label: "New Mexico", value: "NM" },
  { label: "New York", value: "NY" },
  { label: "North Carolina", value: "NC" },
  { label: "North Dakota", value: "ND" },
  { label: "Ohio", value: "OH" },
  { label: "Oklahoma", value: "OK" },
  { label: "Oregon", value: "OR" },
  { label: "Pennsylvania", value: "PA" },
  { label: "Rhode Island", value: "RI" },
  { label: "South Carolina", value: "SC" },
  { label: "South Dakota", value: "SD" },
  { label: "Tennessee", value: "TN" },
  { label: "Texas", value: "TX" },
  { label: "Utah", value: "UT" },
  { label: "Vermont", value: "VT" },
  { label: "Virginia", value: "VA" },
  { label: "Washington", value: "WA" },
  { label: "West Virginia", value: "WV" },
  { label: "Wisconsin", value: "WI" },
  { label: "Wyoming", value: "WY" }
];

function createInitialProfile(): BusinessProfile {
  return {
    name: "",
    displayName: "",
    about: "",
    website: "",
    nip05: "",
    picture: "",
    banner: "",
    businessType: "restaurant",
    categories: [],
    phone: "",
    email: "",
    street: "",
    city: "",
    state: "",
    zip: "",
    country: "US", // Default to US
    location: ""
  };
}

export function parseKind0ProfileEvent(event: Event): { patch: Partial<BusinessProfile>; categories: string[] } {
  const patch: Partial<BusinessProfile> = {};
  const categories: string[] = [];
  const openingHours: OpeningHoursSpec[] = [];
  let locationValue: string | undefined;

  try {
    const content = JSON.parse(event.content ?? "{}") as Record<string, unknown>;
    if (typeof content.name === "string") patch.name = content.name;
    if (typeof content.display_name === "string") patch.displayName = content.display_name;
    if (typeof content.about === "string") patch.about = content.about;
    if (typeof content.website === "string") patch.website = content.website;
    if (typeof content.nip05 === "string") patch.nip05 = content.nip05;
    if (typeof content.picture === "string") patch.picture = content.picture;
    if (typeof content.banner === "string") patch.banner = content.banner;
  } catch (error) {
    console.warn("Failed to parse profile content", error);
  }

  for (const tag of event.tags) {
    if (!Array.isArray(tag) || !tag.length) continue;

    if (tag[0] === "schema.org:FoodEstablishment" && typeof tag[1] === "string") {
      // New format: ["schema.org:FoodEstablishment", "Restaurant", "https://schema.org/FoodEstablishment"]
      // Convert PascalCase to camelCase (e.g., "Restaurant" -> "restaurant")
      const businessTypeValue = tag[1].charAt(0).toLowerCase() + tag[1].slice(1);
      if (allowedBusinessTypes.has(businessTypeValue as BusinessType)) {
        patch.businessType = businessTypeValue as BusinessType;
      }
    } else if (tag[0] === "l" && typeof tag[1] === "string") {
      // Try new Schema.org format first
      const businessType = schemaOrgUrlToBusinessType(tag[1]);
      if (businessType) {
        patch.businessType = businessType;
      } else if (tag[2] === "com.synvya.merchant" && allowedBusinessTypes.has(tag[1] as BusinessType)) {
        // Fallback to old format for backward compatibility
        patch.businessType = tag[1] as BusinessType;
      }
    } else if (tag[0] === "t" && typeof tag[1] === "string" && tag[1] !== "production") {
      categories.push(tag[1]);
    } else if ((tag[0] === "schema.org:FoodEstablishment:servesCuisine" || tag[0] === "schema.org:servesCuisine") && typeof tag[1] === "string") {
      patch.cuisine = tag[1];
    } else if ((tag[0] === "schema.org:FoodEstablishment:memberOf" || tag[0] === "schema.org:memberOf") && typeof tag[1] === "string") {
      // New format: ["schema.org:FoodEstablishment:memberOf", "https://snovalley.org", "https://schema.org/memberOf"]
      // Extract domain from URL (e.g., "https://snovalley.org" → "snovalley.org")
      // Backward compatibility: if value is not a URL, use it as-is
      const value = tag[1];
      if (value.startsWith("http://") || value.startsWith("https://")) {
        // Extract domain from URL
        try {
          const url = new URL(value);
          const hostname = url.hostname;
          // Store the domain (e.g., "snovalley.org")
          if (hostname) {
            patch.memberOf = hostname;
          }
        } catch {
          // If URL parsing fails, fall back to using value as-is
          patch.memberOf = value;
        }
      } else {
        // Backward compatibility: use value as-is if it's not a URL
        patch.memberOf = value;
      }
    } else if (tag[0] === "schema.org:FoodEstablishment:telephone" && typeof tag[1] === "string") {
      // Extract phone number from "tel:+155512345678" format
      const phoneValue = tag[1].startsWith("tel:") ? tag[1].slice(4) : tag[1];
      if (phoneValue) patch.phone = phoneValue;
    } else if (tag[0] === "schema.org:FoodEstablishment:email" && typeof tag[1] === "string") {
      // Extract email from "mailto:email@example.com" format
      const emailValue = tag[1].startsWith("mailto:") ? tag[1].slice(7) : tag[1];
      if (emailValue) patch.email = emailValue;
    } else if (tag[0] === "schema.org:PostalAddress:streetAddress" && typeof tag[1] === "string") {
      patch.street = tag[1];
    } else if (tag[0] === "schema.org:PostalAddress:addressLocality" && typeof tag[1] === "string") {
      patch.city = tag[1];
    } else if (tag[0] === "schema.org:PostalAddress:addressRegion" && typeof tag[1] === "string") {
      patch.state = tag[1];
    } else if (tag[0] === "schema.org:PostalAddress:postalCode" && typeof tag[1] === "string") {
      patch.zip = tag[1];
    } else if (tag[0] === "schema.org:PostalAddress:addressCountry" && typeof tag[1] === "string") {
      patch.country = tag[1];
    } else if (tag[0] === "schema.org:acceptsReservations" && typeof tag[1] === "string") {
      if (tag[1] === "False") {
        patch.acceptsReservations = false;
      } else if (tag[1] === "https://synvya.com") {
        patch.acceptsReservations = true;
      }
    } else if (tag[0] === "i" && typeof tag[1] === "string" && tag[1] === "rp") {
      patch.acceptsReservations = true;
    } else if ((tag[0] === "schema.org:FoodEstablishment:openingHours" || tag[0] === "schema.org:openingHours") && typeof tag[1] === "string") {
      // Parse comma-separated opening hours string: "Tu-Th 11:00-21:00, Fr-Sa 11:00-00:00, Su 12:00-21:00"
      const hoursString = tag[1];
      const hoursParts = hoursString.split(",").map(part => part.trim()).filter(Boolean);
      
      for (const part of hoursParts) {
        // Split by space to separate day range from time range
        const spaceIndex = part.indexOf(" ");
        if (spaceIndex === -1) continue;
        
        const dayRange = part.slice(0, spaceIndex).trim();
        const timeRange = part.slice(spaceIndex + 1).trim();
        const [startTime, endTime] = timeRange.split("-");
        
        if (startTime && endTime) {
          // Parse day range: "Tu-Th" or "Mo"
          const days: string[] = [];
          if (dayRange.includes("-")) {
            const [startDay, endDay] = dayRange.split("-");
            const dayOrder = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
            const startIndex = dayOrder.indexOf(startDay);
            const endIndex = dayOrder.indexOf(endDay);
            if (startIndex >= 0 && endIndex >= 0 && startIndex <= endIndex) {
              for (let i = startIndex; i <= endIndex; i++) {
                days.push(dayOrder[i]);
              }
            }
          } else {
            days.push(dayRange);
          }
          
          if (days.length > 0) {
            openingHours.push({ days, startTime, endTime });
          }
        }
      }
    } else if (tag[0] === "i" && typeof tag[1] === "string") {
      if (tag[1].startsWith("schema.org:telephone:")) {
        const phone = tag[1].slice("schema.org:telephone:".length);
        if (phone) patch.phone = phone;
      } else if (tag[1].startsWith("telephone:")) {
        // Backward compatibility: support old "telephone:" format
        const phone = tag[1].slice("telephone:".length);
        if (phone) patch.phone = phone;
      } else if (tag[1].startsWith("phone:")) {
        // Backward compatibility: support old "phone:" format
        const phone = tag[1].slice("phone:".length);
        if (phone) patch.phone = phone;
      } else if (tag[1].startsWith("schema.org:email:mailto:")) {
        const email = tag[1].slice("schema.org:email:mailto:".length);
        if (email) patch.email = email;
      } else if (tag[1].startsWith("email:mailto:")) {
        // Backward compatibility: support old "email:mailto:" format
        const email = tag[1].slice("email:mailto:".length);
        if (email) patch.email = email;
      } else if (tag[1].startsWith("schema.org:PostalAddress:streetAddress:")) {
        patch.street = tag[1].slice("schema.org:PostalAddress:streetAddress:".length);
      } else if (tag[1].startsWith("postalAddress:streetAddress:")) {
        // Backward compatibility: support old "postalAddress:" format
        patch.street = tag[1].slice("postalAddress:streetAddress:".length);
      } else if (tag[1].startsWith("schema.org:PostalAddress:addressLocality:")) {
        patch.city = tag[1].slice("schema.org:PostalAddress:addressLocality:".length);
      } else if (tag[1].startsWith("postalAddress:addressLocality:")) {
        // Backward compatibility: support old "postalAddress:" format
        patch.city = tag[1].slice("postalAddress:addressLocality:".length);
      } else if (tag[1].startsWith("schema.org:PostalAddress:addressRegion:")) {
        patch.state = tag[1].slice("schema.org:PostalAddress:addressRegion:".length);
      } else if (tag[1].startsWith("postalAddress:addressRegion:")) {
        // Backward compatibility: support old "postalAddress:" format
        patch.state = tag[1].slice("postalAddress:addressRegion:".length);
      } else if (tag[1].startsWith("schema.org:PostalAddress:postalCode:")) {
        patch.zip = tag[1].slice("schema.org:PostalAddress:postalCode:".length);
      } else if (tag[1].startsWith("postalAddress:postalCode:")) {
        // Backward compatibility: support old "postalAddress:" format
        patch.zip = tag[1].slice("postalAddress:postalCode:".length);
      } else if (tag[1].startsWith("schema.org:PostalAddress:addressCountry:")) {
        patch.country = tag[1].slice("schema.org:PostalAddress:addressCountry:".length);
      } else if (tag[1].startsWith("postalAddress:addressCountry:")) {
        // Backward compatibility: support old "postalAddress:" format
        patch.country = tag[1].slice("postalAddress:addressCountry:".length);
      } else if (tag[1].startsWith("location:")) {
        // Fallback to old format for backward compatibility
        locationValue = tag[1].slice("location:".length);
      }
    }
  }

  // Reconstruct location from postal address components if available
  if (patch.street || patch.city || patch.state || patch.zip) {
    const locationParts = [patch.street, patch.city, patch.state, patch.zip].filter(
      (value): value is string => Boolean(value)
    );
    if (locationParts.length >= 2) {
      patch.location = `${locationParts.join(", ")}, USA`;
    }
  } else if (locationValue) {
    // Fallback to old format
    patch.location = locationValue;
    const withoutCountry = locationValue.replace(/,?\s*USA$/i, "").trim();
    const parts = withoutCountry
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);

    if (parts[0]) patch.street = parts[0];
    if (parts[1]) patch.city = parts[1];
    if (parts[2]) patch.state = parts[2];
    if (parts[3]) patch.zip = parts[3];
  }

  if (categories.length) {
    patch.categories = categories;
  }

  if (openingHours.length > 0) {
    patch.openingHours = openingHours;
  }

  return { patch, categories };
}

export function BusinessProfileForm(): JSX.Element {
  const signEvent = useAuth((state) => state.signEvent);
  const pubkey = useAuth((state) => state.pubkey);
  const authStatus = useAuth((state) => state.status);
  const relays = useRelays((state) => state.relays);
  const memberOfDomain = useMemberOf((state) => state.domain);
  const setProfileLocation = useBusinessProfile((state) => state.setLocation);
  const setProfileBusinessType = useBusinessProfile((state) => state.setBusinessType);
  const [profile, setProfile] = useState<BusinessProfile>(createInitialProfile);
  const [categoriesInput, setCategoriesInput] = useState("");
  const [cuisineInput, setCuisineInput] = useState("");
  const [status, setStatus] = useState<FormStatus>({ type: "idle", message: null });
  const [publishing, setPublishing] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<{ picture: File | null; banner: File | null }>({
    picture: null,
    banner: null
  });
  const [previewUrls, setPreviewUrls] = useState<{ picture: string | null; banner: string | null }>({
    picture: null,
    banner: null
  });
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [openingHoursDialogOpen, setOpeningHoursDialogOpen] = useState(false);
  const pictureInputRef = useRef<HTMLInputElement | null>(null);
  const bannerInputRef = useRef<HTMLInputElement | null>(null);
  const loadingProfileRef = useRef(false);
  const originalBusinessTypeRef = useRef<BusinessType | null>(null);

  const derivedCategories = useMemo(() => {
    if (!categoriesInput) return [];
    return categoriesInput
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
  }, [categoriesInput]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setStatus({ type: "idle", message: null });

    const nip05 = profile.name ? `${profile.name}@synvya.com` : "";

    const payload: BusinessProfile = {
      ...profile,
      nip05,
      categories: derivedCategories,
      cuisine: cuisineInput?.trim() || undefined,
      phone: profile.phone?.trim() || undefined,
      email: profile.email?.trim() || undefined,
      street: profile.street?.trim() || undefined,
      city: profile.city?.trim() || undefined,
      state: profile.state?.trim() || undefined,
      zip: profile.zip?.trim() || undefined,
      memberOf: profile.memberOf || memberOfDomain || undefined
    };

    if (!relays.length) {
      setStatus({ type: "error", message: "Add at least one relay before publishing" });
      return;
    }

    let pictureUrl = profile.picture;
    let bannerUrl = profile.banner;

    try {
      setPublishing(true);


      if (pendingFiles.picture) {
        pictureUrl = await uploadMedia(pendingFiles.picture, "picture");
      }

      if (pendingFiles.banner) {
        bannerUrl = await uploadMedia(pendingFiles.banner, "banner");
      }

      const locationParts = [payload.street, payload.city, payload.state, payload.zip].filter(
        (value): value is string => Boolean(value)
      );
      const fullLocation = locationParts.length >= 2 ? `${locationParts.join(", ")}, USA` : undefined;

      const finalPayload: BusinessProfile = {
        ...payload,
        picture: pictureUrl,
        banner: bannerUrl,
        location: fullLocation
      };
      setProfileLocation(fullLocation ?? null);

      // Geocode location to get geohash, latitude, and longitude
      let geohash: string | null = null;
      let latitude: number | null = null;
      let longitude: number | null = null;
      if (fullLocation) {
        try {
          const geocodeResult = await geocodeLocation(fullLocation);
          geohash = geocodeResult.geohash;
          latitude = geocodeResult.latitude;
          longitude = geocodeResult.longitude;
        } catch (error) {
          console.warn("Failed to geocode location", error);
          // Continue without geo data if geocoding fails
        }
      }

      const template = buildProfileEvent(finalPayload, { geohash, latitude, longitude });
      const signed = await signEvent(template);
      await publishToRelays(signed, relays);

      // If this is a restaurant, publish NIP-17 DM relay event
      if (finalPayload.businessType === "restaurant" && pubkey) {
        try {
          // Build and sign DM relay event (kind 10050) as per NIP-17
          const dmRelayTemplate = buildDmRelayEvent(relays);
          const dmRelayEvent = await signEvent(dmRelayTemplate);
          await publishToRelays(dmRelayEvent, relays);
        } catch (error) {
          console.warn("Failed to publish DM relay event:", error);
          // Don't fail the whole operation if DM relay event fails
        }
      }

      setProfile((prev) => ({
        ...prev,
        picture: pictureUrl,
        banner: bannerUrl,
        phone: payload.phone ?? "",
        email: payload.email ?? "",
        cuisine: payload.cuisine ?? "",
        street: payload.street ?? "",
        city: payload.city ?? "",
        state: payload.state ?? "",
        zip: payload.zip ?? "",
        location: fullLocation ?? "",
        categories: derivedCategories,
        nip05
      }));

      // Update original business type for future change detection
      originalBusinessTypeRef.current = finalPayload.businessType;
      setProfileBusinessType(finalPayload.businessType);

      setPendingFiles({ picture: null, banner: null });
      setPreviewUrls((prev) => {
        if (prev.picture) URL.revokeObjectURL(prev.picture);
        if (prev.banner) URL.revokeObjectURL(prev.banner);
        return { picture: null, banner: null };
      });

      setStatus({ type: "success", message: "Profile published to relays", eventId: signed.id });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to publish profile";
      setStatus({ type: "error", message });
    } finally {
      setPublishing(false);
    }
  };

  const updateField = <K extends keyof BusinessProfile>(field: K, value: BusinessProfile[K]) => {
    setProfile((prev) => ({ ...prev, [field]: value }));
  };

  const handleNameChange = (value: string) => {
    setProfile((prev) => ({
      ...prev,
      name: value,
      nip05: value ? `${value}@synvya.com` : ""
    }));
  };

  const handleFileSelect = (file: File, kind: keyof typeof pendingFiles) => {
    setPendingFiles((prev) => ({ ...prev, [kind]: file }));
    setPreviewUrls((prev) => {
      const nextUrl = URL.createObjectURL(file);
      if (prev[kind]) {
        URL.revokeObjectURL(prev[kind]!);
      }
      return { ...prev, [kind]: nextUrl };
    });
    setStatus({ type: "idle", message: null });
  };

  useEffect(() => {
    return () => {
      if (previewUrls.picture) URL.revokeObjectURL(previewUrls.picture);
      if (previewUrls.banner) URL.revokeObjectURL(previewUrls.banner);
    };
  }, [previewUrls.picture, previewUrls.banner]);

  useEffect(() => {
    if (profileLoaded || loadingProfileRef.current) {
      return;
    }

    if (authStatus !== "ready" || !pubkey || !relays.length) {
      return;
    }

    let cancelled = false;
    const pool = getPool();
    loadingProfileRef.current = true;

    (async () => {
      try {
        const event = await pool.get(relays, {
          kinds: [0],
          authors: [pubkey]
        });

        if (!event || cancelled) {
          return;
        }

        const { patch, categories } = parseKind0ProfileEvent(event);

        setProfileLocation(patch.location ?? null);
        setProfileBusinessType(patch.businessType ?? null);

        if (cancelled) {
          return;
        }

        setProfile((prev) => ({
          ...prev,
          ...patch,
          categories: patch.categories ?? prev.categories,
          phone: patch.phone ?? prev.phone,
          email: patch.email ?? prev.email,
          street: patch.street ?? prev.street,
          city: patch.city ?? prev.city,
          state: patch.state ?? prev.state,
          zip: patch.zip ?? prev.zip,
          location: patch.location ?? prev.location,
          memberOf: patch.memberOf ?? prev.memberOf
        }));

        // Store the original business type to detect changes
        if (patch.businessType) {
          originalBusinessTypeRef.current = patch.businessType;
        }

        if (categories.length) {
          setCategoriesInput(categories.join(", "));
        }

        if (patch.cuisine) {
          setCuisineInput(patch.cuisine);
        }
      } catch (error) {
        console.warn("Failed to load existing profile", error);
      } finally {
        if (!cancelled) {
          loadingProfileRef.current = false;
          setProfileLoaded(true);
        }
      }
    })();

    return () => {
      cancelled = true;
      loadingProfileRef.current = false;
    };
  }, [authStatus, profileLoaded, pubkey, relays]);

  return (
    <form onSubmit={handleSubmit} className="space-y-8">
      <section className="grid gap-6 rounded-lg border bg-card p-6 shadow-sm">
        <header>
          <h2 className="text-lg font-semibold">Profile</h2>
        </header>

        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="handle">Handle</Label>
            <Input
              id="handle"
              required
              placeholder="myshop"
              value={profile.name}
              onChange={(event) => handleNameChange(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">Lowercase handle without spaces.</p>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="displayName">Display Name</Label>
            <Input
              id="displayName"
              placeholder="My Shop"
              value={profile.displayName}
              onChange={(event) => updateField("displayName", event.target.value)}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="about">About</Label>
            <Textarea
              id="about"
              placeholder="Tell customers about your business"
              value={profile.about}
              onChange={(event) => updateField("about", event.target.value)}
              rows={10}
              className="whitespace-pre-wrap font-mono text-sm"
            />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="website">Website</Label>
              <Input
                id="website"
                type="url"
                placeholder="https://myshop.com"
                value={profile.website}
                onChange={(event) => updateField("website", event.target.value)}
              />
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="phone">Phone</Label>
              <Input
                id="phone"
                placeholder="(555) 123-4567"
                value={profile.phone ?? ""}
                onChange={(event) => updateField("phone", event.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="contact@your-restaurant.com"
                value={profile.email ?? ""}
                onChange={(event) => updateField("email", event.target.value)}
              />
            </div>
          </div>

          {(profile.memberOf || memberOfDomain) && (
            <div className="grid gap-2">
              <Label htmlFor="memberOf">Member Of</Label>
              <Input
                id="memberOf"
                readOnly
                value={profile.memberOf || memberOfDomain || ""}
                className="bg-muted cursor-not-allowed"
              />
              <p className="text-xs text-muted-foreground">Organization membership (read-only).</p>
            </div>
          )}

          <div className="grid gap-4 md:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="street">Street</Label>
              <Input
                id="street"
                placeholder="123 Main St"
                value={profile.street ?? ""}
                onChange={(event) => updateField("street", event.target.value)}
              />
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="city">City</Label>
              <Input
                id="city"
                placeholder="San Francisco"
                value={profile.city ?? ""}
                onChange={(event) => updateField("city", event.target.value)}
              />
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="state">State</Label>
              <select
                id="state"
                className="h-10 rounded-md border border-input bg-transparent px-3 text-sm"
                value={profile.state ?? ""}
                onChange={(event) => updateField("state", event.target.value)}
              >
                <option value="">Select a state</option>
                {usStates.map((state) => (
                  <option key={state.value} value={state.value}>
                    {state.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="zip">Zip code</Label>
              <Input
                id="zip"
                placeholder="98052"
                value={profile.zip ?? ""}
                onChange={(event) => updateField("zip", event.target.value)}
              />
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="businessType">Food Establishment Type</Label>
            <select
              id="businessType"
              className="h-10 rounded-md border border-input bg-transparent px-3 text-sm"
              value={profile.businessType}
              onChange={(event) => updateField("businessType", event.target.value as BusinessType)}
            >
              {businessTypes.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground">Required tag that categorizes the business for AI discovery.</p>
          </div>

          <div className="flex items-center gap-2">
            <input
              id="acceptsReservations"
              type="checkbox"
              className="h-4 w-4 rounded border-gray-300"
              checked={profile.acceptsReservations ?? false}
              onChange={(event) => updateField("acceptsReservations", event.target.checked)}
            />
            <Label htmlFor="acceptsReservations" className="cursor-pointer">
              Accepts Reservations
            </Label>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="categories">Categories</Label>
            <Input
              id="categories"
              placeholder="bakery, local, sweets"
              value={categoriesInput}
              onChange={(event) => setCategoriesInput(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">Comma separated values.</p>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="cuisine">Cuisine</Label>
            <Input
              id="cuisine"
              placeholder="Italian, Seafood"
              value={cuisineInput}
              onChange={(event) => setCuisineInput(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">Comma separated values.</p>
          </div>
          <div className="grid gap-2">
            <Label>Opening Hours</Label>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpeningHoursDialogOpen(true)}
              className="justify-start"
            >
              <Clock className="mr-2 h-4 w-4" />
              {profile.openingHours && profile.openingHours.length > 0
                ? profile.openingHours
                    .map((spec) => {
                      const dayRange =
                        spec.days.length === 1
                          ? spec.days[0]
                          : `${spec.days[0]}-${spec.days[spec.days.length - 1]}`;
                      return `${dayRange} ${spec.startTime}-${spec.endTime}`;
                    })
                    .join(", ")
                : "Set opening hours"}
            </Button>
          </div>
        </div>
      </section>

      <section className="grid gap-6 rounded-lg border bg-card p-6 shadow-sm">
        <header className="flex items-center gap-3">
          <ImageIcon className="h-5 w-5 text-muted-foreground" />
          <div>
            <h3 className="text-lg font-semibold">Media</h3>
            <p className="text-sm text-muted-foreground">Upload a profile picture and banner.</p>
          </div>
        </header>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="picture">Profile Picture</Label>
            <div className="flex items-center gap-3">
              <Input
                id="picture"
                readOnly
                value={pendingFiles.picture ? pendingFiles.picture.name : profile.picture}
                placeholder="Select an image…"
              />
              <input
                ref={pictureInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) {
                    handleFileSelect(file, "picture");
                    event.target.value = "";
                  }
                }}
              />
              <Button
                type="button"
                variant="outline"
                disabled={publishing}
                onClick={() => pictureInputRef.current?.click()}
              >
                <UploadCloud className="mr-2 h-4 w-4" />
                {pendingFiles.picture ? "Change" : "Upload"}
              </Button>
            </div>
            {(pendingFiles.picture ? previewUrls.picture : profile.picture) && (
              <img
                src={(pendingFiles.picture ? previewUrls.picture : profile.picture) ?? undefined}
                alt="Profile preview"
                className="h-32 w-32 rounded-md object-cover"
              />
            )}
          </div>

          <div className="grid gap-2">
            <Label htmlFor="banner">Profile Banner</Label>
            <div className="flex items-center gap-3">
              <Input
                id="banner"
                readOnly
                value={pendingFiles.banner ? pendingFiles.banner.name : profile.banner}
                placeholder="Select an image…"
              />
              <input
                ref={bannerInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) {
                    handleFileSelect(file, "banner");
                    event.target.value = "";
                  }
                }}
              />
              <Button
                type="button"
                variant="outline"
                disabled={publishing}
                onClick={() => bannerInputRef.current?.click()}
              >
                <UploadCloud className="mr-2 h-4 w-4" />
                {pendingFiles.banner ? "Change" : "Upload"}
              </Button>
            </div>
            {(pendingFiles.banner ? previewUrls.banner : profile.banner) && (
              <img
                src={(pendingFiles.banner ? previewUrls.banner : profile.banner) ?? undefined}
                alt="Banner preview"
                className="h-32 w-full rounded-md object-cover"
              />
            )}
          </div>
        </div>
      </section>

      <section className="grid gap-4 rounded-lg border bg-card p-6 shadow-sm">
        <Button type="submit" disabled={publishing}>
          {publishing ? "Publishing…" : "Publish Profile"}
        </Button>

        {status.message && (
          <div
            className={`rounded-md border p-3 text-sm ${
              status.type === "success" ? "border-green-200 bg-green-100 text-green-700" : "border-destructive/40 bg-destructive/10 text-destructive"
            }`}
          >
            <p>{status.message}</p>
            {status.eventId && status.type === "success" ? (
              <p className="mt-1 font-mono text-xs text-muted-foreground">Event ID: {status.eventId}</p>
            ) : null}
          </div>
        )}
      </section>

      <OpeningHoursDialog
        open={openingHoursDialogOpen}
        onOpenChange={setOpeningHoursDialogOpen}
        openingHours={profile.openingHours ?? []}
        onSave={(hours) => updateField("openingHours", hours)}
      />
    </form>
  );
}
