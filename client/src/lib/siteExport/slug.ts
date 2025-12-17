export function slugify(input: string): string {
  const normalized = input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "") // strip diacritics
    .toLowerCase()
    .trim();

  // Replace & with "and", remove non-alphanum, collapse spaces/dashes
  const cleaned = normalized
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return cleaned.replace(/[ -]+/g, "-");
}

export function menuSlugFromMenuName(menuName: string): string {
  // Convert "Dinner Menu" -> "dinner", "Lunch Menu" -> "lunch"
  // If it doesn't end with Menu, fallback to generic slugify.
  const lower = menuName.toLowerCase().trim();
  const stripped = lower.endsWith(" menu") ? lower.slice(0, -" menu".length).trim() : lower;
  return slugify(stripped);
}

export function sectionNameFromTitle(title: string): string {
  // "Entrees Menu Section" -> "Entrees"
  return title.replace(/\s*Menu Section\s*$/i, "").trim();
}


