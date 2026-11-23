/**
 * Amenity Category Definitions & Visual Styling Palette
 * ─────────────────────────────────────────────────────────────
 * Maps OSM tags and POI properties to clean, consistent categories
 * and rich high-contrast RGBA colors for map visualization.
 * ─────────────────────────────────────────────────────────────
 */

export const AMENITY_CATEGORY_COLORS: Record<string, [number, number, number, number]> = {
  Healthcare: [16, 185, 129, 230], // Emerald Green
  Education: [79, 70, 229, 230], // Indigo
  "Banking & Finance": [59, 130, 246, 230], // Blue
  "Food & Beverage": [249, 115, 22, 230], // Orange
  "Daily Needs & Retail": [168, 85, 247, 230], // Purple
  "Transit & Mobility": [6, 182, 212, 230], // Cyan
  "Recreation & Parks": [132, 204, 22, 230], // Lime Green
  "Civic & Community": [244, 63, 94, 230], // Rose Red
  Other: [245, 158, 11, 230], // Amber
};

export function getAmenityCategoryAndColor(p: Record<string, any>): {
  category: string;
  color: [number, number, number, number];
} {
  const tag = String(
    p.amenity || p.shop || p.leisure || p.highway || p.category || p.category_id || ""
  ).toLowerCase();

  if (
    tag.includes("hospital") ||
    tag.includes("clinic") ||
    tag.includes("pharmacy") ||
    tag.includes("doctor") ||
    tag.includes("dentist") ||
    tag.includes("health")
  ) {
    return { category: "Healthcare", color: AMENITY_CATEGORY_COLORS.Healthcare };
  }
  if (
    tag.includes("school") ||
    tag.includes("college") ||
    tag.includes("university") ||
    tag.includes("kindergarten") ||
    tag.includes("education") ||
    tag.includes("library")
  ) {
    return { category: "Education", color: AMENITY_CATEGORY_COLORS.Education };
  }
  if (
    tag.includes("bank") ||
    tag.includes("atm") ||
    tag.includes("financial") ||
    tag.includes("bureau_de_change")
  ) {
    return { category: "Banking & Finance", color: AMENITY_CATEGORY_COLORS["Banking & Finance"] };
  }
  if (
    tag.includes("restaurant") ||
    tag.includes("cafe") ||
    tag.includes("food") ||
    tag.includes("fast_food") ||
    tag.includes("bar") ||
    tag.includes("pub") ||
    tag.includes("bakery") ||
    tag.includes("beverage")
  ) {
    return { category: "Food & Beverage", color: AMENITY_CATEGORY_COLORS["Food & Beverage"] };
  }
  if (
    tag.includes("supermarket") ||
    tag.includes("grocery") ||
    tag.includes("convenience") ||
    tag.includes("mall") ||
    tag.includes("marketplace") ||
    tag.includes("retail") ||
    tag.includes("shop") ||
    tag.includes("daily_needs")
  ) {
    return { category: "Daily Needs & Retail", color: AMENITY_CATEGORY_COLORS["Daily Needs & Retail"] };
  }
  if (
    tag.includes("bus") ||
    tag.includes("station") ||
    tag.includes("transit") ||
    tag.includes("subway") ||
    tag.includes("fuel") ||
    tag.includes("parking") ||
    tag.includes("transport")
  ) {
    return { category: "Transit & Mobility", color: AMENITY_CATEGORY_COLORS["Transit & Mobility"] };
  }
  if (
    tag.includes("park") ||
    tag.includes("garden") ||
    tag.includes("playground") ||
    tag.includes("pitch") ||
    tag.includes("sports") ||
    tag.includes("recreation")
  ) {
    return { category: "Recreation & Parks", color: AMENITY_CATEGORY_COLORS["Recreation & Parks"] };
  }
  if (
    tag.includes("police") ||
    tag.includes("post_office") ||
    tag.includes("townhall") ||
    tag.includes("fire") ||
    tag.includes("worship") ||
    tag.includes("temple") ||
    tag.includes("mosque") ||
    tag.includes("church") ||
    tag.includes("community") ||
    tag.includes("civic")
  ) {
    return { category: "Civic & Community", color: AMENITY_CATEGORY_COLORS["Civic & Community"] };
  }

  const fallbackCat = p.category && typeof p.category === "string" ? p.category : "Other";
  return { category: fallbackCat, color: AMENITY_CATEGORY_COLORS.Other };
}
