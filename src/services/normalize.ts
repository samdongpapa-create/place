import type { PlaceProfile } from "../core/types.js";

export function normalizePlace(p: PlaceProfile): PlaceProfile {
  const name = (p.name || "").trim();
  const tags = (p.tags || []).map((t) => t.trim()).filter(Boolean);
  const amenities = (p.amenities || []).map((t) => t.trim()).filter(Boolean);

  return {
    ...p,
    name: name || "UNKNOWN",
    tags: tags.length ? tags : undefined,
    amenities: amenities.length ? amenities : undefined,
    description: p.description?.trim() || undefined,
    directions: p.directions?.trim() || undefined
  };
}
