import type { ClientToolDefinition } from "@/config/clientTools/types";

export const LOCUS_SCORE_TOOLS: ClientToolDefinition[] = [
  {
    type: "function",
    name: "compare_pincodes_locus_score",
    description:
      "Compare two Indian PIN codes or postal zip codes using LocusScore AI Location Intelligence. Computes proximity-decayed amenity scores across 8 OSM categories (Education, Healthcare, Daily Needs & Retail, Food & Beverage, Banking & Finance, Transit & Connectivity, Recreation & Open Space, Civic & Community) with distance decay AmenityValue = Σ [ 1 / (1 + distance_km / d0) ] (d0 ≈ 0.5 km) and city-wide min-max normalization (0-100). Computes sector-weighted LocationScore for Real Estate (homebuyer), FMCG / Retail (store site selection), or Quick-Commerce (dark store catchment), or custom specified amenities. Automatically renders the POI markers with category colors and 1 km buffer boundaries on the map.",
    parameters: {
      type: "object",
      properties: {
        pinCodeA: {
          type: "string",
          description: "First 6-digit Indian PIN code or postal code (e.g. '560001').",
        },
        pinCodeB: {
          type: "string",
          description: "Second 6-digit Indian PIN code or postal code (e.g. '560103').",
        },
        sector: {
          type: "string",
          description:
            "Business sector profile for scoring weights: 'real_estate' (20% education, 15% healthcare, 15% daily needs, 5% F&B, 5% banking, 20% transit, 10% recreation, 10% civic), 'fmcg_retail' (10% education, 5% healthcare, 25% daily needs, 15% F&B, 10% banking, 20% transit, 5% recreation, 10% civic), or 'quick_commerce' (5% education, 10% healthcare, 20% daily needs, 10% F&B, 5% banking, 25% transit, 0% recreation, 25% civic).",
          enum: ["real_estate", "fmcg_retail", "quick_commerce"],
        },
        specificAmenities: {
          type: "array",
          description:
            "Optional specific amenity categories to focus on if requested by user (e.g. ['education', 'healthcare', 'transit_connectivity']).",
          items: {
            type: "string",
          },
        },
        d0: {
          type: "number",
          description: "Tunable distance decay parameter in km (default is 0.5).",
        },
        renderOnMap: {
          type: "boolean",
          description: "Whether to render amenity POI markers and 1 km buffer boundaries on the Deck.gl map (default: true).",
        },
      },
      required: ["pinCodeA", "pinCodeB"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: "function",
    name: "score_pincode_locus",
    description:
      "Calculate the LocusScore AI Location Intelligence for a single Indian PIN code or zip code across the 8 OSM amenity categories and sector weight profiles (Real Estate, FMCG / Retail, Quick-Commerce).",
    parameters: {
      type: "object",
      properties: {
        pinCode: {
          type: "string",
          description: "6-digit Indian PIN code to evaluate (e.g. '560001').",
        },
        sector: {
          type: "string",
          description:
            "Business sector profile: 'real_estate', 'fmcg_retail', or 'quick_commerce'.",
          enum: ["real_estate", "fmcg_retail", "quick_commerce"],
        },
        specificAmenities: {
          type: "array",
          description:
            "Optional specific amenity categories to focus on if requested by user (e.g. ['education', 'healthcare']).",
          items: {
            type: "string",
          },
        },
        d0: {
          type: "number",
          description: "Tunable distance decay parameter in km (default is 0.5).",
        },
        renderOnMap: {
          type: "boolean",
          description: "Whether to display amenity POI layers on the map (default: true).",
        },
      },
      required: ["pinCode"],
      additionalProperties: false,
    },
    strict: true,
  },
];
