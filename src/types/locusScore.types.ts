export type AmenityCategoryId =
  | "education"
  | "healthcare"
  | "daily_needs"
  | "food_beverage"
  | "banking_finance"
  | "transit_connectivity"
  | "recreation_open_space"
  | "civic_community";

export type SectorProfileId = "real_estate" | "fmcg_retail" | "quick_commerce";

export interface AmenityCategoryConfig {
  id: AmenityCategoryId;
  label: string;
  osmTags: string[];
  whyItMatters: string;
  iconName: string;
  colorHex: string;
  rgba: [number, number, number, number];
  description: string;
}

export interface SectorProfileConfig {
  id: SectorProfileId;
  name: string;
  badge: string;
  icon: string;
  subtitle: string;
  weights: Record<AmenityCategoryId, number>;
  description: string;
}

export interface POIItem {
  id: string;
  name: string;
  category: AmenityCategoryId;
  amenityTag: string;
  lat: number;
  lng: number;
  distanceKm: number;
  decayWeight: number; // 1 / (1 + distance_km / d0)
  address?: string;
}

export interface PinCodeData {
  pinCode: string;
  name: string;
  city: string;
  character: string;
  narrativeHook: string;
  lat: number;
  lng: number;
  rawCategoryValues: Record<AmenityCategoryId, number>;
  normalizedScores: Record<AmenityCategoryId, number>; // 0 to 100
  sectorScores: Record<SectorProfileId, number>; // weighted sum
  poiCounts: Record<AmenityCategoryId, number>;
  pois: POIItem[];
  polygonCoordinates?: [number, number][]; // optional polygon boundary
}

export interface CategoryComparisonDelta {
  scoreA: number;
  scoreB: number;
  diff: number; // scoreA - scoreB
  winner: "A" | "B" | "TIE";
  poiCountA: number;
  poiCountB: number;
  amenityValueA: number;
  amenityValueB: number;
}

export interface PinComparisonResult {
  pinA: PinCodeData;
  pinB: PinCodeData;
  sector: SectorProfileId;
  d0: number;
  categoryDeltas: Record<AmenityCategoryId, CategoryComparisonDelta>;
  overallDelta: {
    scoreA: number;
    scoreB: number;
    diff: number;
    winner: "A" | "B" | "TIE";
  };
  narrativeTakeaways: string[];
}
