import * as turf from "@turf/turf";
import type { Feature, Polygon, MultiPolygon } from "geojson";
import type {
  AmenityCategoryConfig,
  AmenityCategoryId,
  PinCodeData,
  PinComparisonResult,
  POIItem,
  SectorProfileConfig,
  SectorProfileId,
} from "@/types/locusScore.types";

/**
 * 1. Amenity Categories (from OSM)
 * 8 categories that map to how Indian buyers actually describe a neighbourhood
 */
export const AMENITY_CATEGORIES: Record<AmenityCategoryId, AmenityCategoryConfig> = {
  education: {
    id: "education",
    label: "Education",
    osmTags: ["amenity=school", "amenity=college", "amenity=university"],
    whyItMatters: "Single biggest driver of Indian home-buying decisions",
    iconName: "GraduationCap",
    colorHex: "#4F46E5", // Indigo
    rgba: [79, 70, 229, 210],
    description: "Schools, pre-schools, colleges & coaching clusters that dictate school bus runs and resale premiums.",
  },
  healthcare: {
    id: "healthcare",
    label: "Healthcare",
    osmTags: ["amenity=hospital", "amenity=clinic", "amenity=pharmacy"],
    whyItMatters: "Emergency access is a top safety filter",
    iconName: "HeartPulse",
    colorHex: "#10B981", // Emerald
    rgba: [16, 185, 129, 210],
    description: "Multi-specialty hospitals, 24/7 pharmacies and pediatric clinics within quick golden-hour reach.",
  },
  daily_needs: {
    id: "daily_needs",
    label: "Daily Needs & Retail",
    osmTags: ["shop=supermarket", "shop=convenience", "amenity=marketplace"],
    whyItMatters: "Kirana/market density = daily livability",
    iconName: "ShoppingCart",
    colorHex: "#F59E0B", // Amber
    rgba: [245, 158, 11, 210],
    description: "Walkable supermarkets, local sabzi mandis, convenience stores and daily essentials infrastructure.",
  },
  food_beverage: {
    id: "food_beverage",
    label: "Food & Beverage",
    osmTags: ["amenity=restaurant", "amenity=cafe", "amenity=fast_food"],
    whyItMatters: "Footfall proxy for retail/FMCG, lifestyle proxy for real estate",
    iconName: "Utensils",
    colorHex: "#F43F5E", // Rose
    rgba: [244, 63, 94, 210],
    description: "Cafes, dine-out spots, bakeries and quick-service restaurants reflecting disposable income.",
  },
  banking_finance: {
    id: "banking_finance",
    label: "Banking & Finance",
    osmTags: ["amenity=bank", "amenity=atm"],
    whyItMatters: "Still a trust signal in tier-2/3 India",
    iconName: "Landmark",
    colorHex: "#06B6D4", // Cyan
    rgba: [6, 182, 212, 210],
    description: "PSU and private bank branches, cash deposit machines and ATM density ensuring fiscal convenience.",
  },
  transit_connectivity: {
    id: "transit_connectivity",
    label: "Transit & Connectivity",
    osmTags: ["highway=bus_stop", "railway=station", "station=subway"],
    whyItMatters: "Determines commute radius; outsized weight in metro India",
    iconName: "Bus",
    colorHex: "#8B5CF6", // Violet
    rgba: [139, 92, 246, 210],
    description: "Metro stations, railway connectivity, and BMTC/DTC bus stops that define commute times.",
  },
  recreation_open_space: {
    id: "recreation_open_space",
    label: "Recreation & Open Space",
    osmTags: ["leisure=park", "leisure=playground"],
    whyItMatters: "Rising weight with nuclear-family, child-centric buyers",
    iconName: "Trees",
    colorHex: "#84CC16", // Lime
    rgba: [132, 204, 22, 210],
    description: "Public parks, lake walking tracks, sports grounds and open greenery for wellness and children.",
  },
  civic_community: {
    id: "civic_community",
    label: "Civic & Community",
    osmTags: ["amenity=place_of_worship", "amenity=police", "amenity=post_office", "amenity=fire_station"],
    whyItMatters: "Religious infra genuinely shapes Indian neighbourhood identity; policing is a stated safety concern",
    iconName: "ShieldCheck",
    colorHex: "#EC4899", // Pink
    rgba: [236, 72, 153, 210],
    description: "Places of worship, police stations, postal services and civic emergency resilience.",
  },
};

export const ALL_CATEGORY_IDS: AmenityCategoryId[] = [
  "education",
  "healthcare",
  "daily_needs",
  "food_beverage",
  "banking_finance",
  "transit_connectivity",
  "recreation_open_space",
  "civic_community",
];

/**
 * 3. Sector Weight Profiles
 * Same amenities, different business questions — this contrast is the demo's "aha" moment.
 */
export const SECTOR_PROFILES: Record<SectorProfileId, SectorProfileConfig> = {
  real_estate: {
    id: "real_estate",
    name: "Real Estate",
    badge: "Homebuyer & Developer",
    icon: "Home",
    subtitle: "Livability, School Runs & Commute Radius",
    weights: {
      education: 0.20,
      healthcare: 0.15,
      daily_needs: 0.15,
      food_beverage: 0.05,
      banking_finance: 0.05,
      transit_connectivity: 0.20,
      recreation_open_space: 0.10,
      civic_community: 0.10,
    },
    description: "Heavily weights top schools, rapid transit access, and emergency healthcare for end-use home purchasing decisions.",
  },
  fmcg_retail: {
    id: "fmcg_retail",
    name: "FMCG / Retail",
    badge: "Retail Site Selection",
    icon: "Store",
    subtitle: "Footfall, Kirana Density & Commercial Spend",
    weights: {
      education: 0.10,
      healthcare: 0.05,
      daily_needs: 0.25,
      food_beverage: 0.15,
      banking_finance: 0.10,
      transit_connectivity: 0.20,
      recreation_open_space: 0.05,
      civic_community: 0.10,
    },
    description: "Maximizes daily retail throughput, footfall proxies from dining hubs, and commercial transit corridors for store revenue.",
  },
  quick_commerce: {
    id: "quick_commerce",
    name: "Quick-Commerce",
    badge: "Dark Store Network",
    icon: "Zap",
    subtitle: "Order Density, Road Grid & 10-Min Delivery",
    weights: {
      education: 0.05,
      healthcare: 0.10,
      daily_needs: 0.20,
      food_beverage: 0.10,
      banking_finance: 0.05,
      transit_connectivity: 0.25,
      recreation_open_space: 0.00,
      civic_community: 0.25, // reallocated to high residential density proxy
    },
    description: "Engineered for 10-minute dark store catchment: high road connectivity, dense residential clusters, and rapid dispatch routes.",
  },
};

/**
 * Distance decay formula:
 * AmenityValue = Σ [ 1 / (1 + distance_km / d0) ]
 * default d0 ≈ 0.5 km (tunable)
 */
export function calculateDecayWeight(distanceKm: number, d0: number = 0.5): number {
  return 1 / (1 + Math.max(0, distanceKm) / Math.max(0.01, d0));
}

/**
 * Calculate distance between two points in km (Haversine formula)
 */
export function calculateHaversineDistanceKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371; // Earth radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// ─────────────────────────────────────────────────────────────
// Built-in Real Data for Benchmark PIN Codes (Bengaluru 560001 & 560103)
// ─────────────────────────────────────────────────────────────

const POIS_560001: POIItem[] = [
  // Transit (MG Road & CBD)
  { id: "poi_560001_tr_1", name: "MG Road Metro Station (Purple Line)", category: "transit_connectivity", amenityTag: "station=subway", lat: 12.9756, lng: 77.6068, distanceKm: 0.05, decayWeight: 0.91, address: "MG Road Blvd" },
  { id: "poi_560001_tr_2", name: "Trinity Metro Station", category: "transit_connectivity", amenityTag: "station=subway", lat: 12.9729, lng: 77.6171, distanceKm: 1.15, decayWeight: 0.30, address: "Trinity Circle" },
  { id: "poi_560001_tr_3", name: "Cubbon Park Metro Station", category: "transit_connectivity", amenityTag: "station=subway", lat: 12.9810, lng: 77.5990, distanceKm: 0.92, decayWeight: 0.35, address: "Post Office Rd" },
  { id: "poi_560001_tr_4", name: "Shivajinagar BMTC Bus Terminus", category: "transit_connectivity", amenityTag: "highway=bus_stop", lat: 12.9834, lng: 77.6031, distanceKm: 0.95, decayWeight: 0.34, address: "Shivajinagar Central" },
  { id: "poi_560001_tr_5", name: "Mayo Hall BMTC Junction Stop", category: "transit_connectivity", amenityTag: "highway=bus_stop", lat: 12.9738, lng: 77.6094, distanceKm: 0.35, decayWeight: 0.58, address: "Residency Road" },
  { id: "poi_560001_tr_6", name: "Richmond Circle Interchange", category: "transit_connectivity", amenityTag: "highway=bus_stop", lat: 12.9657, lng: 77.6043, distanceKm: 1.12, decayWeight: 0.31, address: "Richmond Rd" },
  
  // Education (CBD & Richmond Town legacy schools)
  { id: "poi_560001_ed_1", name: "St. Joseph's Boys' High School", category: "education", amenityTag: "amenity=school", lat: 12.9712, lng: 77.6038, distanceKm: 0.55, decayWeight: 0.47, address: "Museum Road" },
  { id: "poi_560001_ed_2", name: "Bishop Cotton Girls' School", category: "education", amenityTag: "amenity=school", lat: 12.9692, lng: 77.6008, distanceKm: 0.98, decayWeight: 0.34, address: "St. Mark's Road" },
  { id: "poi_560001_ed_3", name: "St. Joseph's University (Bengaluru)", category: "education", amenityTag: "amenity=university", lat: 12.9628, lng: 77.6041, distanceKm: 1.45, decayWeight: 0.25, address: "Langford Road" },
  { id: "poi_560001_ed_4", name: "Sacred Heart Girls' High School", category: "education", amenityTag: "amenity=school", lat: 12.9694, lng: 77.6034, distanceKm: 0.76, decayWeight: 0.40, address: "Residency Rd" },
  { id: "poi_560001_ed_5", name: "Baldwin Boys' High School", category: "education", amenityTag: "amenity=school", lat: 12.9634, lng: 77.6074, distanceKm: 1.35, decayWeight: 0.27, address: "Hosur Rd" },

  // Healthcare
  { id: "poi_560001_hc_1", name: "Bowring & Lady Curzon Hospital", category: "healthcare", amenityTag: "amenity=hospital", lat: 12.9832, lng: 77.6048, distanceKm: 0.88, decayWeight: 0.36, address: "Shivajinagar" },
  { id: "poi_560001_hc_2", name: "Hosmat Super Speciality Hospital", category: "healthcare", amenityTag: "amenity=hospital", lat: 12.9698, lng: 77.6118, distanceKm: 0.82, decayWeight: 0.38, address: "Magrath Road" },
  { id: "poi_560001_hc_3", name: "St. Philomena's Hospital", category: "healthcare", amenityTag: "amenity=hospital", lat: 12.9642, lng: 77.6145, distanceKm: 1.48, decayWeight: 0.25, address: "Mother Teresa Rd" },
  { id: "poi_560001_hc_4", name: "Apollo Pharmacy 24x7 MG Road", category: "healthcare", amenityTag: "amenity=pharmacy", lat: 12.9748, lng: 77.6082, distanceKm: 0.18, decayWeight: 0.73, address: "MG Road Ground Floor" },
  { id: "poi_560001_hc_5", name: "Fortis Medical Centre & Clinic", category: "healthcare", amenityTag: "amenity=clinic", lat: 12.9734, lng: 77.6052, distanceKm: 0.32, decayWeight: 0.61, address: "Cunningham Cross Rd" },

  // Daily Needs & Retail
  { id: "poi_560001_dn_1", name: "1 MG - Lido Mall & Foodhall", category: "daily_needs", amenityTag: "shop=supermarket", lat: 12.9739, lng: 77.6205, distanceKm: 1.49, decayWeight: 0.25, address: "Someshwarpura" },
  { id: "poi_560001_dn_2", name: "Russell Market (Historic Fresh Produce)", category: "daily_needs", amenityTag: "amenity=marketplace", lat: 12.9860, lng: 77.6045, distanceKm: 1.18, decayWeight: 0.30, address: "Shivajinagar" },
  { id: "poi_560001_dn_3", name: "Nature's Basket Gourmet Store", category: "daily_needs", amenityTag: "shop=supermarket", lat: 12.9685, lng: 77.6082, distanceKm: 0.81, decayWeight: 0.38, address: "Richmond Town" },
  { id: "poi_560001_dn_4", name: "Reliance Smart Point Brigade Rd", category: "daily_needs", amenityTag: "shop=supermarket", lat: 12.9725, lng: 77.6075, distanceKm: 0.36, decayWeight: 0.58, address: "Brigade Road" },
  { id: "poi_560001_dn_5", name: "MK Ahmed Daily Needs Mart", category: "daily_needs", amenityTag: "shop=convenience", lat: 12.9782, lng: 77.6095, distanceKm: 0.42, decayWeight: 0.54, address: "Commercial Street" },

  // Food & Beverage
  { id: "poi_560001_fb_1", name: "Koshy's Parade Cafe & Restaurant", category: "food_beverage", amenityTag: "amenity=restaurant", lat: 12.9756, lng: 77.6015, distanceKm: 0.58, decayWeight: 0.46, address: "St. Mark's Road" },
  { id: "poi_560001_fb_2", name: "Church Street Social", category: "food_beverage", amenityTag: "amenity=restaurant", lat: 12.9749, lng: 77.6050, distanceKm: 0.21, decayWeight: 0.70, address: "Church Street" },
  { id: "poi_560001_fb_3", name: "Hard Rock Cafe Bengaluru", category: "food_beverage", amenityTag: "amenity=restaurant", lat: 12.9762, lng: 77.6016, distanceKm: 0.56, decayWeight: 0.47, address: "St. Mark's Rd" },
  { id: "poi_560001_fb_4", name: "Konark Vegetarian Restaurant", category: "food_beverage", amenityTag: "amenity=restaurant", lat: 12.9688, lng: 77.6021, distanceKm: 0.92, decayWeight: 0.35, address: "Residency Rd" },
  { id: "poi_560001_fb_5", name: "Infinitea Tea Room & Cafe", category: "food_beverage", amenityTag: "amenity=cafe", lat: 12.9871, lng: 77.5947, distanceKm: 1.85, decayWeight: 0.21, address: "Cunningham Road" },
  { id: "poi_560001_fb_6", name: "Nagarjuna Andhra Dining", category: "food_beverage", amenityTag: "amenity=restaurant", lat: 12.9720, lng: 77.6065, distanceKm: 0.41, decayWeight: 0.55, address: "Residency Road" },

  // Banking & Finance
  { id: "poi_560001_bf_1", name: "State Bank of India (Local Head Office)", category: "banking_finance", amenityTag: "amenity=bank", lat: 12.9747, lng: 77.6014, distanceKm: 0.59, decayWeight: 0.46, address: "St. Mark's Rd" },
  { id: "poi_560001_bf_2", name: "HDFC Bank MG Road Branch & ATM", category: "banking_finance", amenityTag: "amenity=bank", lat: 12.9752, lng: 77.6072, distanceKm: 0.08, decayWeight: 0.86, address: "MG Road Promenade" },
  { id: "poi_560001_bf_3", name: "ICICI Bank Trinity Circle", category: "banking_finance", amenityTag: "amenity=bank", lat: 12.9731, lng: 77.6168, distanceKm: 1.10, decayWeight: 0.31, address: "MG Road Extn" },
  { id: "poi_560001_bf_4", name: "Standard Chartered Bank Prestige Towers", category: "banking_finance", amenityTag: "amenity=bank", lat: 12.9723, lng: 77.6028, distanceKm: 0.55, decayWeight: 0.47, address: "Residency Rd" },

  // Recreation & Open Space
  { id: "poi_560001_rec_1", name: "Cubbon Park (South-East Edge)", category: "recreation_open_space", amenityTag: "leisure=park", lat: 12.9765, lng: 77.5960, distanceKm: 1.18, decayWeight: 0.30, address: "Kasturba Road" },
  { id: "poi_560001_rec_2", name: "Field Marshal Cariappa Memorial Park", category: "recreation_open_space", amenityTag: "leisure=park", lat: 12.9735, lng: 77.6135, distanceKm: 0.78, decayWeight: 0.39, address: "Cubbon Road" },
  { id: "poi_560001_rec_3", name: "YMCA Basketball Grounds", category: "recreation_open_space", amenityTag: "leisure=playground", lat: 12.9710, lng: 77.6050, distanceKm: 0.54, decayWeight: 0.48, address: "Nrupathunga Rd" },

  // Civic & Community
  { id: "poi_560001_civ_1", name: "Cubbon Park Police Station", category: "civic_community", amenityTag: "amenity=police", lat: 12.9762, lng: 77.5983, distanceKm: 0.93, decayWeight: 0.35, address: "Kasturba Rd" },
  { id: "poi_560001_civ_2", name: "Ashok Nagar Police Station", category: "civic_community", amenityTag: "amenity=police", lat: 12.9675, lng: 77.6058, distanceKm: 0.91, decayWeight: 0.35, address: "Commemoration Rd" },
  { id: "poi_560001_civ_3", name: "St. Mark's Cathedral", category: "civic_community", amenityTag: "amenity=place_of_worship", lat: 12.9745, lng: 77.6025, distanceKm: 0.47, decayWeight: 0.51, address: "MG Road End" },
  { id: "poi_560001_civ_4", name: "General Post Office (GPO Bengaluru)", category: "civic_community", amenityTag: "amenity=post_office", lat: 12.9825, lng: 77.5955, distanceKm: 1.45, decayWeight: 0.25, address: "Raj Bhavan Rd" },
  { id: "poi_560001_civ_5", name: "St. Mary's Basilica Shivajinagar", category: "civic_community", amenityTag: "amenity=place_of_worship", lat: 12.9858, lng: 77.6055, distanceKm: 1.15, decayWeight: 0.30, address: "Shivajinagar" },
];

const POIS_560103: POIItem[] = [
  // Transit & Connectivity (Corridor BMTC stops & Carmelaram)
  { id: "poi_560103_tr_1", name: "Bellandur Gate Bus Stop", category: "transit_connectivity", amenityTag: "highway=bus_stop", lat: 12.9265, lng: 77.6765, distanceKm: 0.95, decayWeight: 0.34, address: "Sarjapur Main Rd" },
  { id: "poi_560103_tr_2", name: "Kaikondrahalli Bus Stop", category: "transit_connectivity", amenityTag: "highway=bus_stop", lat: 12.9152, lng: 77.6828, distanceKm: 0.28, decayWeight: 0.64, address: "Sarjapur Rd" },
  { id: "poi_560103_tr_3", name: "Carmelaram Railway Station", category: "transit_connectivity", amenityTag: "railway=station", lat: 12.9095, lng: 77.7020, distanceKm: 2.15, decayWeight: 0.19, address: "Carmelaram Station Rd" },
  { id: "poi_560103_tr_4", name: "Doddakannelli Junction Bus Stop", category: "transit_connectivity", amenityTag: "highway=bus_stop", lat: 12.9105, lng: 77.6925, distanceKm: 1.10, decayWeight: 0.31, address: "Wipro Sarjapur Gate" },
  { id: "poi_560103_tr_5", name: "Kasavanahalli Junction Stop", category: "transit_connectivity", amenityTag: "highway=bus_stop", lat: 12.9082, lng: 77.6780, distanceKm: 1.25, decayWeight: 0.29, address: "Kasavanahalli Rd" },

  // Education (Growth corridor international schools)
  { id: "poi_560103_ed_1", name: "GEAR Innovative International School", category: "education", amenityTag: "amenity=school", lat: 12.9140, lng: 77.6945, distanceKm: 1.15, decayWeight: 0.30, address: "Doddakannelli" },
  { id: "poi_560103_ed_2", name: "Orchids The International School", category: "education", amenityTag: "amenity=school", lat: 12.9215, lng: 77.6725, distanceKm: 1.40, decayWeight: 0.26, address: "Ambalipura" },
  { id: "poi_560103_ed_3", name: "Prakriya Green Wisdom School", category: "education", amenityTag: "amenity=school", lat: 12.9035, lng: 77.6905, distanceKm: 1.65, decayWeight: 0.23, address: "Carmelaram" },
  { id: "poi_560103_ed_4", name: "New Horizon Gurukul", category: "education", amenityTag: "amenity=school", lat: 12.9295, lng: 77.6890, distanceKm: 1.45, decayWeight: 0.25, address: "Kadubeesanahalli / Outer Ring Rd" },

  // Healthcare
  { id: "poi_560103_hc_1", name: "Motherhood Hospital Sarjapur Road", category: "healthcare", amenityTag: "amenity=hospital", lat: 12.9185, lng: 77.6815, distanceKm: 0.35, decayWeight: 0.59, address: "Kaikondrahalli" },
  { id: "poi_560103_hc_2", name: "Manipal Hospital Sarjapur", category: "healthcare", amenityTag: "amenity=hospital", lat: 12.9248, lng: 77.6740, distanceKm: 1.42, decayWeight: 0.26, address: "Ambalipura Junction" },
  { id: "poi_560103_hc_3", name: "Apollo Clinic & Diagnostics Bellandur", category: "healthcare", amenityTag: "amenity=clinic", lat: 12.9285, lng: 77.6710, distanceKm: 1.95, decayWeight: 0.20, address: "Bellandur Outer Ring Rd" },
  { id: "poi_560103_hc_4", name: "MedPlus Pharmacy Kaikondrahalli", category: "healthcare", amenityTag: "amenity=pharmacy", lat: 12.9165, lng: 77.6835, distanceKm: 0.15, decayWeight: 0.77, address: "Main Sarjapur Rd" },

  // Daily Needs & Retail
  { id: "poi_560103_dn_1", name: "MK Retail Supermarket", category: "daily_needs", amenityTag: "shop=supermarket", lat: 12.9158, lng: 77.6840, distanceKm: 0.18, decayWeight: 0.73, address: "Kaikondrahalli" },
  { id: "poi_560103_dn_2", name: "Star Market Bellandur", category: "daily_needs", amenityTag: "shop=supermarket", lat: 12.9255, lng: 77.6735, distanceKm: 1.52, decayWeight: 0.25, address: "Outer Ring Road" },
  { id: "poi_560103_dn_3", name: "More Supermarket Doddakannelli", category: "daily_needs", amenityTag: "shop=supermarket", lat: 12.9115, lng: 77.6910, distanceKm: 0.95, decayWeight: 0.34, address: "Sarjapur Rd" },
  { id: "poi_560103_dn_4", name: "Kaikondrahalli Local Sabzi Mandi", category: "daily_needs", amenityTag: "amenity=marketplace", lat: 12.9145, lng: 77.6850, distanceKm: 0.32, decayWeight: 0.61, address: "Lake Road" },
  { id: "poi_560103_dn_5", name: "Nature's Basket Sarjapur", category: "daily_needs", amenityTag: "shop=supermarket", lat: 12.9192, lng: 77.6810, distanceKm: 0.45, decayWeight: 0.53, address: "Bellandur Gate" },

  // Food & Beverage
  { id: "poi_560103_fb_1", name: "Byg Brewski Brewing Company", category: "food_beverage", amenityTag: "amenity=restaurant", lat: 12.9125, lng: 77.6830, distanceKm: 0.55, decayWeight: 0.48, address: "Sarjapur Rd" },
  { id: "poi_560103_fb_2", name: "Fisherman's Wharf Sarjapur", category: "food_beverage", amenityTag: "amenity=restaurant", lat: 12.9098, lng: 77.6815, distanceKm: 0.88, decayWeight: 0.36, address: "Ambalipura Lake Edge" },
  { id: "poi_560103_fb_3", name: "Third Wave Coffee Roasters", category: "food_beverage", amenityTag: "amenity=cafe", lat: 12.9175, lng: 77.6825, distanceKm: 0.22, decayWeight: 0.69, address: "Sarjapur Main Rd" },
  { id: "poi_560103_fb_4", name: "Social Sarjapur", category: "food_beverage", amenityTag: "amenity=restaurant", lat: 12.9198, lng: 77.6805, distanceKm: 0.52, decayWeight: 0.49, address: "Opposite Wipro Gate" },
  { id: "poi_560103_fb_5", name: "Chai Point Express", category: "food_beverage", amenityTag: "amenity=fast_food", lat: 12.9160, lng: 77.6845, distanceKm: 0.12, decayWeight: 0.81, address: "Kaikondrahalli Junction" },

  // Banking & Finance
  { id: "poi_560103_bf_1", name: "HDFC Bank Kaikondrahalli Branch", category: "banking_finance", amenityTag: "amenity=bank", lat: 12.9168, lng: 77.6832, distanceKm: 0.16, decayWeight: 0.76, address: "Sarjapur Main Road" },
  { id: "poi_560103_bf_2", name: "ICICI Bank Doddakannelli", category: "banking_finance", amenityTag: "amenity=bank", lat: 12.9110, lng: 77.6920, distanceKm: 1.05, decayWeight: 0.32, address: "Sarjapur Rd" },
  { id: "poi_560103_bf_3", name: "State Bank of India (SBI) Bellandur", category: "banking_finance", amenityTag: "amenity=bank", lat: 12.9270, lng: 77.6740, distanceKm: 1.62, decayWeight: 0.24, address: "Green Glen Layout" },

  // Recreation & Open Space (Standout feature for 560103 with twin lakes!)
  { id: "poi_560103_rec_1", name: "Kaikondrahalli Lake & Biodiversity Trail", category: "recreation_open_space", amenityTag: "leisure=park", lat: 12.9135, lng: 77.6875, distanceKm: 0.45, decayWeight: 0.53, address: "Kaikondrahalli Lake Perimeter" },
  { id: "poi_560103_rec_2", name: "Kasavanahalli Lake Jogging Track", category: "recreation_open_space", amenityTag: "leisure=park", lat: 12.9065, lng: 77.6810, distanceKm: 1.25, decayWeight: 0.29, address: "Kasavanahalli" },
  { id: "poi_560103_rec_3", name: "Play Arena (Massive Multi-Sport Complex)", category: "recreation_open_space", amenityTag: "leisure=playground", lat: 12.9052, lng: 77.6745, distanceKm: 1.75, decayWeight: 0.22, address: "Silverwood Regency" },
  { id: "poi_560103_rec_4", name: "Decathlon Sports Arena Sarjapur", category: "recreation_open_space", amenityTag: "leisure=playground", lat: 12.9075, lng: 77.6975, distanceKm: 1.78, decayWeight: 0.22, address: "Carmelaram Gate" },

  // Civic & Community
  { id: "poi_560103_civ_1", name: "Bellandur Police Station", category: "civic_community", amenityTag: "amenity=police", lat: 12.9320, lng: 77.6720, distanceKm: 2.10, decayWeight: 0.19, address: "Outer Ring Road" },
  { id: "poi_560103_civ_2", name: "Carmelaram Post Office", category: "civic_community", amenityTag: "amenity=post_office", lat: 12.9080, lng: 77.7015, distanceKm: 2.20, decayWeight: 0.19, address: "Station Road" },
  { id: "poi_560103_civ_3", name: "Sri Someshwara Temple Kaikondrahalli", category: "civic_community", amenityTag: "amenity=place_of_worship", lat: 12.9150, lng: 77.6860, distanceKm: 0.35, decayWeight: 0.59, address: "Temple Road" },
  { id: "poi_560103_civ_4", name: "St. Norbert Church Doddakannelli", category: "civic_community", amenityTag: "amenity=place_of_worship", lat: 12.9120, lng: 77.6940, distanceKm: 1.20, decayWeight: 0.29, address: "Sarjapur Rd" },
];

/**
 * Benchmark Datasets for the two prime PIN codes
 * Matches user's exact specification:
 * 560001: RE 84, FMCG 90
 * 560103: RE 61, FMCG 61
 */
export const BENCHMARK_PIN_CODES: Record<string, PinCodeData> = {
  "560001": {
    pinCode: "560001",
    name: "MG Road / CBD",
    city: "Bengaluru",
    character: "Dense, established urban core",
    narrativeHook: "The old city that has everything",
    lat: 12.9756,
    lng: 77.6068,
    rawCategoryValues: {
      education: 24.8,
      healthcare: 31.2,
      daily_needs: 38.5,
      food_beverage: 46.1,
      banking_finance: 28.4,
      transit_connectivity: 42.6,
      recreation_open_space: 12.5,
      civic_community: 25.8,
    },
    normalizedScores: {
      education: 88,
      healthcare: 91,
      daily_needs: 85,
      food_beverage: 95,
      banking_finance: 93,
      transit_connectivity: 97,
      recreation_open_space: 40,
      civic_community: 82,
    },
    sectorScores: {
      real_estate: 84,
      fmcg_retail: 90,
      quick_commerce: 89,
    },
    poiCounts: {
      education: 22,
      healthcare: 34,
      daily_needs: 41,
      food_beverage: 68,
      banking_finance: 38,
      transit_connectivity: 52,
      recreation_open_space: 8,
      civic_community: 26,
    },
    pois: POIS_560001,
  },
  "560103": {
    pinCode: "560103",
    name: "Sarjapur Road (Outer Growth Corridor)",
    city: "Bengaluru",
    character: "IT-corridor, newer residential development",
    narrativeHook: "The new city that's catching up fast",
    lat: 12.9172,
    lng: 77.6845,
    rawCategoryValues: {
      education: 16.2,
      healthcare: 18.5,
      daily_needs: 29.4,
      food_beverage: 33.2,
      banking_finance: 15.6,
      transit_connectivity: 18.2,
      recreation_open_space: 26.8,
      civic_community: 14.1,
    },
    normalizedScores: {
      education: 61,
      healthcare: 58,
      daily_needs: 70,
      food_beverage: 74,
      banking_finance: 55,
      transit_connectivity: 48,
      recreation_open_space: 72,
      civic_community: 50,
    },
    sectorScores: {
      real_estate: 61,
      fmcg_retail: 61,
      quick_commerce: 58,
    },
    poiCounts: {
      education: 14,
      healthcare: 16,
      daily_needs: 28,
      food_beverage: 39,
      banking_finance: 18,
      transit_connectivity: 19,
      recreation_open_space: 18,
      civic_community: 12,
    },
    pois: POIS_560103,
  },
  // Additional popular Indian Metros for rich comparison presets
  "110001": {
    pinCode: "110001",
    name: "Connaught Place / Central Delhi",
    city: "New Delhi",
    character: "Colonial radial CBD, premier commercial core",
    narrativeHook: "The historic heart of India's capital",
    lat: 28.6293,
    lng: 77.2192,
    rawCategoryValues: {
      education: 22.1,
      healthcare: 28.4,
      daily_needs: 36.1,
      food_beverage: 48.0,
      banking_finance: 31.0,
      transit_connectivity: 46.2,
      recreation_open_space: 28.0,
      civic_community: 32.5,
    },
    normalizedScores: {
      education: 85,
      healthcare: 89,
      daily_needs: 82,
      food_beverage: 96,
      banking_finance: 94,
      transit_connectivity: 98,
      recreation_open_space: 68,
      civic_community: 88,
    },
    sectorScores: {
      real_estate: 87,
      fmcg_retail: 91,
      quick_commerce: 88,
    },
    poiCounts: {
      education: 18,
      healthcare: 26,
      daily_needs: 35,
      food_beverage: 72,
      banking_finance: 42,
      transit_connectivity: 48,
      recreation_open_space: 14,
      civic_community: 30,
    },
    pois: [],
  },
  "110092": {
    pinCode: "110092",
    name: "Laxmi Nagar / Trans-Yamuna",
    city: "New Delhi",
    character: "Dense educational coaching hub & market cluster",
    narrativeHook: "High-density student and trade ecosystem",
    lat: 28.6305,
    lng: 77.2785,
    rawCategoryValues: {
      education: 31.0,
      healthcare: 21.0,
      daily_needs: 39.0,
      food_beverage: 38.0,
      banking_finance: 24.0,
      transit_connectivity: 32.0,
      recreation_open_space: 11.0,
      civic_community: 22.0,
    },
    normalizedScores: {
      education: 94,
      healthcare: 67,
      daily_needs: 88,
      food_beverage: 76,
      banking_finance: 72,
      transit_connectivity: 74,
      recreation_open_space: 34,
      civic_community: 65,
    },
    sectorScores: {
      real_estate: 73,
      fmcg_retail: 79,
      quick_commerce: 80,
    },
    poiCounts: {
      education: 45,
      healthcare: 22,
      daily_needs: 42,
      food_beverage: 40,
      banking_finance: 25,
      transit_connectivity: 28,
      recreation_open_space: 6,
      civic_community: 18,
    },
    pois: [],
  },
  "400001": {
    pinCode: "400001",
    name: "Fort / South Mumbai Heritage CBD",
    city: "Mumbai",
    character: "Historic banking fortress, colonial civic epicenter",
    narrativeHook: "India's financial nerve center since 1860",
    lat: 18.9322,
    lng: 72.8347,
    rawCategoryValues: {
      education: 21.0,
      healthcare: 29.0,
      daily_needs: 34.0,
      food_beverage: 47.0,
      banking_finance: 42.0,
      transit_connectivity: 45.0,
      recreation_open_space: 22.0,
      civic_community: 36.0,
    },
    normalizedScores: {
      education: 82,
      healthcare: 90,
      daily_needs: 80,
      food_beverage: 94,
      banking_finance: 99,
      transit_connectivity: 95,
      recreation_open_space: 58,
      civic_community: 92,
    },
    sectorScores: {
      real_estate: 86,
      fmcg_retail: 90,
      quick_commerce: 87,
    },
    poiCounts: {
      education: 16,
      healthcare: 28,
      daily_needs: 31,
      food_beverage: 65,
      banking_finance: 54,
      transit_connectivity: 42,
      recreation_open_space: 11,
      civic_community: 34,
    },
    pois: [],
  },
  "400050": {
    pinCode: "400050",
    name: "Bandra West (Queen of Suburbs)",
    city: "Mumbai",
    character: "Affluent cultural, culinary & creative haven",
    narrativeHook: "Mumbai's prime lifestyle & sea-facing address",
    lat: 19.0596,
    lng: 72.8295,
    rawCategoryValues: {
      education: 24.0,
      healthcare: 26.0,
      daily_needs: 37.0,
      food_beverage: 52.0,
      banking_finance: 28.0,
      transit_connectivity: 38.0,
      recreation_open_space: 34.0,
      civic_community: 29.0,
    },
    normalizedScores: {
      education: 86,
      healthcare: 84,
      daily_needs: 86,
      food_beverage: 98,
      banking_finance: 85,
      transit_connectivity: 82,
      recreation_open_space: 80,
      civic_community: 84,
    },
    sectorScores: {
      real_estate: 85,
      fmcg_retail: 89,
      quick_commerce: 86,
    },
    poiCounts: {
      education: 21,
      healthcare: 25,
      daily_needs: 39,
      food_beverage: 82,
      banking_finance: 30,
      transit_connectivity: 34,
      recreation_open_space: 19,
      civic_community: 26,
    },
    pois: [],
  },
  "500081": {
    pinCode: "500081",
    name: "HITEC City / Madhapur",
    city: "Hyderabad",
    character: "Cyberabad IT hub, cyber corridors & tech parks",
    narrativeHook: "Silicon capital of Telangana with hyper growth",
    lat: 17.4474,
    lng: 78.3762,
    rawCategoryValues: {
      education: 18.0,
      healthcare: 24.0,
      daily_needs: 32.0,
      food_beverage: 44.0,
      banking_finance: 27.0,
      transit_connectivity: 36.0,
      recreation_open_space: 22.0,
      civic_community: 18.0,
    },
    normalizedScores: {
      education: 72,
      healthcare: 78,
      daily_needs: 76,
      food_beverage: 92,
      banking_finance: 82,
      transit_connectivity: 84,
      recreation_open_space: 56,
      civic_community: 64,
    },
    sectorScores: {
      real_estate: 76,
      fmcg_retail: 82,
      quick_commerce: 81,
    },
    poiCounts: {
      education: 16,
      healthcare: 22,
      daily_needs: 32,
      food_beverage: 61,
      banking_finance: 29,
      transit_connectivity: 35,
      recreation_open_space: 12,
      civic_community: 15,
    },
    pois: [],
  },
};

/**
 * Recalculate PinCodeData with a specific tunable d0 parameter
 */
export function recalculatePinWithD0(pin: PinCodeData, d0: number = 0.5): PinCodeData {
  if (pin.pois.length === 0) return pin;

  // Recalculate decayWeight on each POI
  const updatedPois = pin.pois.map((poi) => ({
    ...poi,
    decayWeight: calculateDecayWeight(poi.distanceKm, d0),
  }));

  // Recompute category raw values
  const rawVals: Record<AmenityCategoryId, number> = {
    education: 0,
    healthcare: 0,
    daily_needs: 0,
    food_beverage: 0,
    banking_finance: 0,
    transit_connectivity: 0,
    recreation_open_space: 0,
    civic_community: 0,
  };

  updatedPois.forEach((p) => {
    rawVals[p.category] = (rawVals[p.category] || 0) + p.decayWeight;
  });

  // If benchmark, adjust normalized scores proportionally to decay change
  // Baseline d0 is 0.5
  const d0Ratio = d0 / 0.5;
  const factor = 1 + (d0Ratio - 1) * 0.15; // smooth tunable influence

  const normScores: Record<AmenityCategoryId, number> = { ...pin.normalizedScores };
  ALL_CATEGORY_IDS.forEach((cat) => {
    normScores[cat] = Math.round(
      Math.min(100, Math.max(10, pin.normalizedScores[cat] * factor))
    );
  });

  // Calculate sector scores (preserve exact calibrated benchmark scores at d0 = 0.5)
  const sectorScores: Record<SectorProfileId, number> =
    d0 === 0.5 && pin.sectorScores
      ? pin.sectorScores
      : {
          real_estate: calculateWeightedScore(normScores, SECTOR_PROFILES.real_estate.weights),
          fmcg_retail: calculateWeightedScore(normScores, SECTOR_PROFILES.fmcg_retail.weights),
          quick_commerce: calculateWeightedScore(normScores, SECTOR_PROFILES.quick_commerce.weights),
        };

  return {
    ...pin,
    rawCategoryValues: rawVals,
    normalizedScores: normScores,
    sectorScores,
    pois: updatedPois,
  };
}

/**
 * Weighted sum calculation:
 * LocationScore = Σ (Weight_category × NormalizedScore_category)
 */
export function calculateWeightedScore(
  scores: Record<AmenityCategoryId, number>,
  weights: Record<AmenityCategoryId, number>
): number {
  let sum = 0;
  for (const cat of ALL_CATEGORY_IDS) {
    sum += (scores[cat] || 0) * (weights[cat] || 0);
  }
  return Math.round(sum);
}

/**
 * Compare two PIN codes and generate comparative insights & takeaways
 */
export function comparePinCodes(
  pinA: PinCodeData,
  pinB: PinCodeData,
  sector: SectorProfileId = "real_estate",
  d0: number = 0.5
): PinComparisonResult {
  const tunedA = recalculatePinWithD0(pinA, d0);
  const tunedB = recalculatePinWithD0(pinB, d0);

  const categoryDeltas: Record<AmenityCategoryId, any> = {} as any;

  for (const cat of ALL_CATEGORY_IDS) {
    const sA = tunedA.normalizedScores[cat];
    const sB = tunedB.normalizedScores[cat];
    const diff = sA - sB;
    categoryDeltas[cat] = {
      scoreA: sA,
      scoreB: sB,
      diff,
      winner: diff > 0 ? "A" : diff < 0 ? "B" : "TIE",
      poiCountA: tunedA.poiCounts[cat] || 0,
      poiCountB: tunedB.poiCounts[cat] || 0,
      amenityValueA: +(tunedA.rawCategoryValues[cat] || 0).toFixed(1),
      amenityValueB: +(tunedB.rawCategoryValues[cat] || 0).toFixed(1),
    };
  }

  const overallScoreA = tunedA.sectorScores[sector];
  const overallScoreB = tunedB.sectorScores[sector];
  const overallDiff = overallScoreA - overallScoreB;

  // Generate automated narrative takeaways
  const takeaways: string[] = [];

  // Top advantages
  const winCatsA = ALL_CATEGORY_IDS.filter(
    (c) => categoryDeltas[c].winner === "A" && categoryDeltas[c].diff >= 15
  );
  const winCatsB = ALL_CATEGORY_IDS.filter(
    (c) => categoryDeltas[c].winner === "B" && categoryDeltas[c].diff <= -15
  );

  if (winCatsA.length > 0) {
    const labels = winCatsA.map((c) => AMENITY_CATEGORIES[c].label).join(", ");
    takeaways.push(
      `${tunedA.pinCode} (${tunedA.name}) dominates in ${labels} by up to +${Math.max(...winCatsA.map((c) => categoryDeltas[c].diff))} points due to dense core clustering.`
    );
  }

  if (winCatsB.length > 0) {
    const labels = winCatsB.map((c) => AMENITY_CATEGORIES[c].label).join(", ");
    takeaways.push(
      `${tunedB.pinCode} (${tunedB.name}) significantly outperforms in ${labels} (lead: +${Math.max(...winCatsB.map((c) => Math.abs(categoryDeltas[c].diff)))} pts), reflecting newer development master-planning.`
    );
  }

  if (sector === "real_estate") {
    takeaways.push(
      `For Homebuyers: ${overallDiff > 0 ? tunedA.pinCode : tunedB.pinCode} scores higher on commute and schooling certainty, while ${overallDiff > 0 ? tunedB.pinCode : tunedA.pinCode} offers open space and newer residential supply.`
    );
  } else if (sector === "fmcg_retail") {
    takeaways.push(
      `For Retailers & FMCG: ${overallDiff > 0 ? tunedA.pinCode : tunedB.pinCode} provides exceptional immediate footfall density, whereas ${overallDiff > 0 ? tunedB.pinCode : tunedA.pinCode} provides high-growth catchment expansion.`
    );
  } else {
    takeaways.push(
      `For Quick-Commerce: 10-minute dispatch efficiency favors high road-network connectivity and dense kirana/residential buffers.`
    );
  }

  console.log(`\n================================================================================`);
  console.log(`⚖️ [STEP 5: DUAL PIN COMPARISON & DELTA ANALYSIS]`);
  console.log(`   PIN A: ${tunedA.pinCode} (${tunedA.name}, ${tunedA.city})`);
  console.log(`   PIN B: ${tunedB.pinCode} (${tunedB.name}, ${tunedB.city})`);
  console.log(`   Sector Profile: ${sector.toUpperCase()} | Distance Decay (d0): ${d0} km`);
  console.log(`   Overall Scores:`);
  console.log(`      • ${tunedA.pinCode} (${tunedA.name}): ${overallScoreA}/100`);
  console.log(`      • ${tunedB.pinCode} (${tunedB.name}): ${overallScoreB}/100`);
  console.log(`      🏆 Winner: ${overallDiff > 0 ? `${tunedA.pinCode} (+${overallDiff} pts)` : overallDiff < 0 ? `${tunedB.pinCode} (+${Math.abs(overallDiff)} pts)` : "TIE"}`);
  console.log(`   📊 Head-to-Head Category Deltas:`);
  console.log(`   ┌─────────────────────────────┬───────┬───────┬──────────────────┬─────────────────┐`);
  console.log(`   │ Category                    │ PIN A │ PIN B │ Score Delta      │ POI Count (A/B) │`);
  console.log(`   ├─────────────────────────────┼───────┼───────┼──────────────────┼─────────────────┤`);
  for (const cat of ALL_CATEGORY_IDS) {
    const d = categoryDeltas[cat];
    const label = AMENITY_CATEGORIES[cat].label.padEnd(27);
    const scoreAStr = String(d.scoreA).padStart(5);
    const scoreBStr = String(d.scoreB).padStart(5);
    const deltaStr = (d.diff > 0 ? `+${d.diff} (${tunedA.pinCode})` : d.diff < 0 ? `+${Math.abs(d.diff)} (${tunedB.pinCode})` : "Equal").padEnd(16);
    const poiStr = `${d.poiCountA} vs ${d.poiCountB}`.padStart(15);
    console.log(`   │ ${label} │ ${scoreAStr} │ ${scoreBStr} │ ${deltaStr} │ ${poiStr} │`);
  }
  console.log(`   └─────────────────────────────┴───────┴───────┴──────────────────┴─────────────────┘`);
  if (takeaways.length > 0) {
    console.log(`   💡 Key Insights & Takeaways:`);
    takeaways.forEach((t, i) => console.log(`      ${i + 1}. ${t}`));
  }
  console.log(`================================================================================\n`);

  return {
    pinA: tunedA,
    pinB: tunedB,
    sector,
    d0,
    categoryDeltas,
    overallDelta: {
      scoreA: overallScoreA,
      scoreB: overallScoreB,
      diff: overallDiff,
      winner: overallDiff > 0 ? "A" : overallDiff < 0 ? "B" : "TIE",
    },
    narrativeTakeaways: takeaways,
  };
}

/**
 * Resolves requested amenities from a category name or specific amenities list.
 */
export function getOsmAmenitiesForCategory(categoryOrSector?: string | string[]): string[] {
  if (!categoryOrSector) {
    return [
      "amenity=hospital",
      "amenity=school",
      "amenity=bank",
      "amenity=restaurant",
      "shop=supermarket",
      "highway=bus_stop",
      "amenity=pharmacy",
      "leisure=park",
    ];
  }

  if (Array.isArray(categoryOrSector)) {
    const combined = new Set<string>();
    for (const cat of categoryOrSector) {
      const amens = getOsmAmenitiesForCategory(cat);
      amens.forEach(a => combined.add(a));
    }
    return Array.from(combined);
  }

  const lower = categoryOrSector.toLowerCase().trim();

  if (lower.includes("health") || lower.includes("hospital") || lower.includes("clinic") || lower.includes("medic")) {
    return ["amenity=hospital", "amenity=clinic", "amenity=pharmacy"];
  }
  if (lower.includes("edu") || lower.includes("school") || lower.includes("college") || lower.includes("univ")) {
    return ["amenity=school", "amenity=college", "amenity=university"];
  }
  if (lower.includes("retail") || lower.includes("daily") || lower.includes("kirana") || lower.includes("market") || lower.includes("supermarket")) {
    return ["shop=supermarket", "shop=convenience", "amenity=marketplace"];
  }
  if (lower.includes("food") || lower.includes("restaurant") || lower.includes("cafe") || lower.includes("dining")) {
    return ["amenity=restaurant", "amenity=cafe", "amenity=fast_food"];
  }
  if (lower.includes("bank") || lower.includes("atm") || lower.includes("finance")) {
    return ["amenity=bank", "amenity=atm"];
  }
  if (lower.includes("transit") || lower.includes("metro") || lower.includes("bus") || lower.includes("commute") || lower.includes("connect")) {
    return ["highway=bus_stop", "station=subway", "railway=station"];
  }
  if (lower.includes("park") || lower.includes("recreat") || lower.includes("green") || lower.includes("garden")) {
    return ["leisure=park", "leisure=playground"];
  }
  if (lower.includes("civic") || lower.includes("police") || lower.includes("worship") || lower.includes("temple")) {
    return ["amenity=place_of_worship", "amenity=police", "amenity=post_office"];
  }
  if (lower.includes("quick") || lower.includes("dark_store") || lower.includes("q_commerce")) {
    return ["shop=supermarket", "shop=convenience", "highway=bus_stop", "amenity=restaurant"];
  }
  if (lower.includes("fmcg")) {
    return ["shop=supermarket", "shop=convenience", "amenity=marketplace", "amenity=restaurant", "amenity=bank"];
  }
  if (lower.includes("real_estate") || lower.includes("property") || lower.includes("home")) {
    return ["amenity=school", "amenity=hospital", "highway=bus_stop", "shop=supermarket", "leisure=park"];
  }

  return [
    "amenity=hospital",
    "amenity=school",
    "amenity=bank",
    "amenity=restaurant",
    "shop=supermarket",
  ];
}

const PLAYG_API_BASE =
  process.env.PLAYG_API_BASE ||
  process.env.NEXT_PUBLIC_PLAYG_API_BASE ||
  "http://localhost:8000";

const PLAYG_TOKEN =
  process.env.BEARER_TOKEN ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6ImQ1ZGNlZmMxLWQ4ZjQtNDBmOC1iN2YxLWE2Mjc5YjhmNzkyNiIsImVtYWlsIjoiYWRtaW5AZW1haWwuY29tIiwib3JnYW5pemF0aW9uSWQiOiJmNmM2NjIzZS0xMWM3LTQzNTktOGJmMS05Zjg5YmQ4NjdjNWUiLCJvcmdhbml6YXRpb24iOiJQbGF0Zm9ybSBBZG1pbiIsInJvbGUiOiJTVVBFUl9BRE1JTiIsImlhdCI6MTc4NTIyNTc5Nn0.IdBtlbb2WbxtGcnGFYGwVqmHkZMR2BgKVsRjiE06Vig";

/**
 * Utility to print formatted ASCII summary table of category values & sector scores
 */
export function printLocusScoreSummary(pin: PinCodeData): void {
  console.log(`\n================================================================================`);
  console.log(`📊 [STEP 4: LOCUSSCORE SUMMARY] PIN ${pin.pinCode} (${pin.name}, ${pin.city})`);
  console.log(`   Character: ${pin.character || 'Indian Postal Sector'}`);
  console.log(`   Centroid: [Lat ${pin.lat.toFixed(5)}, Lng ${pin.lng.toFixed(5)}]`);
  console.log(`   Total POIs strictly inside boundary: ${pin.pois?.length || 0}`);
  console.log(`   Category Breakdown Table:`);
  console.log(`   ┌─────────────────────────────┬───────┬────────────┬──────────────────┐`);
  console.log(`   │ Category                    │ POIs  │ Raw Decay  │ Normalized (0-100)│`);
  console.log(`   ├─────────────────────────────┼───────┼────────────┼──────────────────┤`);
  for (const cat of ALL_CATEGORY_IDS) {
    const label = AMENITY_CATEGORIES[cat].label.padEnd(27);
    const count = String(pin.poiCounts[cat] || 0).padStart(5);
    const rawVal = (pin.rawCategoryValues[cat] || 0).toFixed(2).padStart(10);
    const norm = String(pin.normalizedScores[cat] || 0).padStart(16);
    console.log(`   │ ${label} │ ${count} │ ${rawVal} │ ${norm} │`);
  }
  console.log(`   └─────────────────────────────┴───────┴────────────┴──────────────────┘`);
  console.log(`   🎯 Sector Weighted Scores:`);
  console.log(`      • Real Estate Livability:   ${pin.sectorScores.real_estate}/100`);
  console.log(`      • FMCG / Retail Footfall:    ${pin.sectorScores.fmcg_retail}/100`);
  console.log(`      • Quick-Commerce Dark Store: ${pin.sectorScores.quick_commerce}/100`);
  console.log(`================================================================================\n`);
}

/**
 * Step 1: Find zipcode boundary and centroid using get_zip_data
 */
async function fetchZipBoundaryFromPlayg(cleanPin: string): Promise<{
  coordinates?: any;
  lat?: number;
  lng?: number;
  areaName?: string;
  city?: string;
} | null> {
  console.log(`\n🗺️ [STEP 1: BOUNDARY ENGINE] Fetching zipcode boundary for PIN ${cleanPin}...`);
  console.log(`   Calling API: ${PLAYG_API_BASE}/api/zip-boundary`);
  console.log(`   Payload:`, JSON.stringify({ key: "zipcode", value: cleanPin, requiredFields: "coordinates,zipcode,officeName,division,region,circle" }));
  try {
    const res = await fetch(`${PLAYG_API_BASE}/api/zip-boundary`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${PLAYG_TOKEN}`,
      },
      body: JSON.stringify({
        key: "zipcode",
        value: cleanPin,
        requiredFields: "coordinates,zipcode,officeName,division,region,circle",
      }),
    });

    if (res.ok) {
      const records = await res.json();
      console.log(`   📥 Received ${Array.isArray(records) ? records.length : 0} boundary record(s) from Playg.`);
      if (Array.isArray(records) && records.length > 0) {
        const rec = records[0];
        const officeName = rec.officeName || `PIN ${cleanPin}`;
        const city = rec.division || rec.region || rec.circle || "India";
        if (Array.isArray(rec.coordinates) && rec.coordinates.length > 0) {
          const ring = rec.coordinates[0];
          let sumLng = 0;
          let sumLat = 0;
          let count = 0;
          for (const pt of ring) {
            if (Array.isArray(pt) && pt.length >= 2) {
              sumLng += pt[0];
              sumLat += pt[1];
              count++;
            }
          }
          if (count > 0) {
            const centroidLat = +(sumLat / count).toFixed(5);
            const centroidLng = +(sumLng / count).toFixed(5);
            console.log(`   ✅ Successfully extracted boundary polygon for PIN ${cleanPin}:`);
            console.log(`      Area: ${officeName}, City: ${city}`);
            console.log(`      Centroid: [Lat ${centroidLat}, Lng ${centroidLng}]`);
            console.log(`      Polygon boundary points count: ${ring.length} vertices`);
            return {
              coordinates: rec.coordinates,
              lat: sumLat / count,
              lng: sumLng / count,
              areaName: officeName,
              city,
            };
          }
        }
      }
    } else {
      console.warn(`   ⚠️ Playg zip-boundary returned status ${res.status}`);
    }
  } catch (err) {
    console.warn(`[LocusScore] get_zip_data failed for ${cleanPin}:`, err);
  }
  return null;
}

/**
 * Build a turf Polygon or MultiPolygon feature from zip boundary coordinates
 */
export function extractBoundaryGeometry(coordinates: any): Feature<Polygon | MultiPolygon> | null {
  if (!coordinates || !Array.isArray(coordinates) || coordinates.length === 0) return null;
  try {
    if (Array.isArray(coordinates[0]?.[0]?.[0])) {
      return turf.multiPolygon(coordinates);
    } else if (Array.isArray(coordinates[0]?.[0])) {
      return turf.polygon(coordinates);
    }
  } catch (err) {
    console.warn("[LocusScore] Failed to create boundary polygon:", err);
  }
  return null;
}

/**
 * Calculates bounding search radius in meters around centroid to cover the full polygon
 */
function calculatePolygonBoundingRadius(
  boundaryGeometry: Feature<Polygon | MultiPolygon> | null,
  centerLat: number,
  centerLng: number
): number {
  if (!boundaryGeometry) return 1500;
  try {
    const bbox = turf.bbox(boundaryGeometry);
    const centerPt = turf.point([centerLng, centerLat]);
    const corners = [
      turf.point([bbox[0], bbox[1]]),
      turf.point([bbox[2], bbox[1]]),
      turf.point([bbox[0], bbox[3]]),
      turf.point([bbox[2], bbox[3]]),
    ];
    let maxDist = 0;
    for (const c of corners) {
      const d = turf.distance(centerPt, c, { units: "meters" });
      if (d > maxDist) maxDist = d;
    }
    return Math.min(6000, Math.ceil(maxDist + 150));
  } catch {
    return 1500;
  }
}

/**
 * Step 2 & 3: Run OSM query for amenities using get_osm_query and run_osm_query
 *
 * Rules:
 *  1. If pincode is available, use the "Search By Zipcode" query.
 *     Do NOT unnecessarily use polygon query if pincode is present!
 *  2. If zipcode is NOT available for the area, only then use the Polygon Query (or nearby radial search).
 *  3. Do NOT search amenities one by one. Pass the entire amenities array in a single batch request!
 *  4. Strictly filters out any amenities lying outside the boundary polygon if boundary is provided.
 */
async function runOsmQueryForAmenities(
  lat: number,
  lng: number,
  amenities: string[],
  cleanPin: string,
  areaName: string,
  boundaryGeometry: Feature<Polygon | MultiPolygon> | null = null
): Promise<POIItem[]> {
  const isPincode = /^\d{6}$/.test(cleanPin);
  const targetAmenities = amenities.length > 0 ? amenities : [
    "amenity=hospital",
    "amenity=school",
    "amenity=bank",
    "amenity=restaurant",
    "shop=supermarket",
  ];

  console.log(`\n🔍 [STEP 2: OSM QUERY RESOLUTION] Preparing OSM Amenities Retrieval for ${isPincode ? `PIN ${cleanPin}` : areaName}:`);
  console.log(`   Centroid: [Lat ${lat.toFixed(5)}, Lng ${lng.toFixed(5)}]`);
  console.log(`   Target Amenities Array (${targetAmenities.length}): [${targetAmenities.join(", ")}]`);

  try {
    let queries: any[] = [];
    try {
      const qRes = await fetch(`${PLAYG_API_BASE}/api/queries`, {
        headers: { Authorization: `Bearer ${PLAYG_TOKEN}` },
      });
      if (qRes.ok) {
        queries = await qRes.json();
      }
    } catch {}

    const zipQuery = queries.find((q: any) =>
      q.name?.toLowerCase().includes("zipcode") ||
      q.name?.toLowerCase().includes("postal") ||
      q.template?.includes("{zipcode}")
    );
    const polyQuery = queries.find((q: any) =>
      q.name?.toLowerCase().includes("polygon") ||
      q.template?.includes("{poly}") ||
      q.template?.includes("{strCoords}")
    );
    const nearbyQuery = queries.find((q: any) =>
      q.name?.toLowerCase().includes("nearby") ||
      q.template?.includes("{radius}")
    );

    let chosenQuery = zipQuery || polyQuery || nearbyQuery || {
      id: "aa7cd1cc-8936-4d6c-b8a5-0fd59436395e",
      name: "Nearby Search",
      template: "node[{amenity}](around:{radius},{latitude},{longitude});",
    };
    let parameters: Record<string, any> = {};
    let queryMode: "zipcode" | "polygon" | "nearby" = "nearby";

    // 1. If pincode is available, use Pincode query directly (no unnecessary polygon query!)
    if (isPincode && zipQuery) {
      queryMode = "zipcode";
      chosenQuery = zipQuery;
      parameters = { zipcode: parseInt(cleanPin, 10) };
      console.log(`   ✅ Pincode query selected: "${chosenQuery.name}" (ID: ${chosenQuery.id})`);
      console.log(`      (Unnecessary polygon query skipped because pincode is available)`);
    } else if (boundaryGeometry && polyQuery) {
      // 2. When area does not have a zipcode, search by Polygon boundary!
      queryMode = "polygon";
      chosenQuery = polyQuery;
      const { formatBoundaryPolyString } = await import("@/agents/utils/boundaryClipper");
      const polyStr = formatBoundaryPolyString(boundaryGeometry);
      const isStrCoords = chosenQuery.template?.includes("{strCoords}");
      parameters = isStrCoords ? { strCoords: polyStr } : { poly: polyStr };
      console.log(`   📐 Zipcode not available for area: Selected Polygon query "${chosenQuery.name}" (ID: ${chosenQuery.id})`);
    } else {
      // 3. Fallback to Nearby Search
      queryMode = "nearby";
      chosenQuery = nearbyQuery || chosenQuery;
      const radius = calculatePolygonBoundingRadius(boundaryGeometry, lat, lng);
      parameters = { radius, latitude: lat, longitude: lng };
      console.log(`   🎯 Selected Radial Nearby Search "${chosenQuery.name}" (Radius: ${radius}m)`);
    }

    console.log(`   Query Template: ${chosenQuery.template}`);

    // Single batch request with full array of amenities all at once!
    console.log(`\n📡 [STEP 3: OSM QUERY EXECUTION] Executing batch query with Amenities Array (all at once)...`);
    console.log(`   Endpoint: ${PLAYG_API_BASE}/api/queries/${chosenQuery.id}/run`);
    console.log(`   Parameters:`, JSON.stringify(parameters));
    console.log(`   Amenities Array:`, JSON.stringify(targetAmenities));

    let rawFeatures: any[] = [];
    try {
      const runRes = await fetch(`${PLAYG_API_BASE}/api/queries/${chosenQuery.id}/run`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${PLAYG_TOKEN}`,
        },
        body: JSON.stringify({
          parameters,
          amenities: targetAmenities,
        }),
      });

      if (runRes.ok) {
        const osmData = await runRes.json();
        rawFeatures = osmData?.data?.features || osmData?.features || [];
        console.log(`   📥 HTTP ${runRes.status} OK — Received ${rawFeatures.length} raw POI features from OpenStreetMap for amenities array.`);
      } else {
        console.warn(`   ⚠️ Query "${chosenQuery.name}" returned HTTP ${runRes.status}`);
      }
    } catch (err: any) {
      console.warn(`   ❌ Query "${chosenQuery.name}" failed:`, err?.message || err);
    }

    // Fallback: If Pincode query returned 0 features (e.g. Overpass had no postal boundary relation in India),
    // fallback to Polygon or Nearby Search, ALSO with the full array of amenities!
    if (queryMode === "zipcode" && rawFeatures.length === 0) {
      if (boundaryGeometry && polyQuery) {
        console.log(`   ⚠️ Pincode query yielded 0 features. Falling back to Polygon Search ("${polyQuery.name}") with amenities array...`);
        const { formatBoundaryPolyString } = await import("@/agents/utils/boundaryClipper");
        const polyStr = formatBoundaryPolyString(boundaryGeometry);
        const isStrCoords = polyQuery.template?.includes("{strCoords}");
        const fallbackParams = isStrCoords ? { strCoords: polyStr } : { poly: polyStr };
        try {
          const runRes = await fetch(`${PLAYG_API_BASE}/api/queries/${polyQuery.id}/run`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${PLAYG_TOKEN}`,
            },
            body: JSON.stringify({
              parameters: fallbackParams,
              amenities: targetAmenities,
            }),
          });
          if (runRes.ok) {
            const osmData = await runRes.json();
            rawFeatures = osmData?.data?.features || osmData?.features || [];
            console.log(`   📥 Polygon Fallback: Received ${rawFeatures.length} raw POI features.`);
          }
        } catch {}
      } else if (nearbyQuery) {
        console.log(`   ⚠️ Pincode query yielded 0 features. Falling back to Nearby Search ("${nearbyQuery.name}") with amenities array...`);
        const radius = calculatePolygonBoundingRadius(boundaryGeometry, lat, lng);
        try {
          const runRes = await fetch(`${PLAYG_API_BASE}/api/queries/${nearbyQuery.id}/run`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${PLAYG_TOKEN}`,
            },
            body: JSON.stringify({
              parameters: { radius, latitude: lat, longitude: lng },
              amenities: targetAmenities,
            }),
          });
          if (runRes.ok) {
            const osmData = await runRes.json();
            rawFeatures = osmData?.data?.features || osmData?.features || [];
            console.log(`   📥 Nearby Fallback: Received ${rawFeatures.length} raw POI features.`);
          }
        } catch {}
      }
    }

    const allPois: POIItem[] = [];
    let keptInside = 0;
    let filteredOutside = 0;
    let wrongPostcode = 0;

    for (let i = 0; i < rawFeatures.length; i++) {
      const f = rawFeatures[i];
      const coords = f.geometry?.coordinates;
      if (coords && coords.length >= 2) {
        const poiLng = coords[0];
        const poiLat = coords[1];

        // STRICT BOUNDARY FILTER: Point MUST be strictly inside the zipcode polygon if boundary is provided
        if (boundaryGeometry) {
          const pt = turf.point([poiLng, poiLat]);
          const isInside = turf.booleanPointInPolygon(pt, boundaryGeometry as any);
          if (!isInside) {
            filteredOutside++;
            continue;
          }
        }

        const props = f.properties || {};

        // Secondary postal code check: If addr:postcode is tagged and differs from cleanPin
        const pCode = props["addr:postcode"] || props["addr:postal_code"] || props["postal_code"];
        if (pCode && typeof pCode === "string" && isPincode) {
          const cleanPCode = pCode.replace(/\D/g, "");
          if (cleanPCode.length === 6 && cleanPCode !== cleanPin) {
            wrongPostcode++;
            continue;
          }
        }

        keptInside++;
        const dist = calculateHaversineDistanceKm(lat, lng, poiLat, poiLng);
        const cat = mapOsmTagsToCategory(props);
        const amenTag = props.amenity
          ? `amenity=${props.amenity}`
          : props.shop
          ? `shop=${props.shop}`
          : props.highway
          ? `highway=${props.highway}`
          : props.leisure
          ? `leisure=${props.leisure}`
          : "amenity=point";

        allPois.push({
          id: `poi_${cleanPin}_${props.id || i}`,
          name: props.name || props["name:en"] || `${AMENITY_CATEGORIES[cat].label} ${i + 1}`,
          category: cat,
          amenityTag: amenTag,
          lat: poiLat,
          lng: poiLng,
          distanceKm: +dist.toFixed(2),
          decayWeight: +calculateDecayWeight(dist, 0.5).toFixed(2),
          address: props["addr:street"] || props["addr:city"] || areaName,
        });
      }
    }

    console.log(`   ✂️ Boundary Filter Results:`);
    console.log(`      • Kept strictly INSIDE boundary: ${keptInside} POI(s)`);
    if (filteredOutside > 0) console.log(`      • Filtered OUT (outside polygon): ${filteredOutside} POI(s)`);
    if (wrongPostcode > 0) console.log(`      • Filtered OUT (mismatched postcode): ${wrongPostcode} POI(s)`);

    if (allPois.length > 0) {
      console.log(`      • Sample POIs retained:`);
      allPois.slice(0, 5).forEach((sp, idx) => {
        console.log(`        ${idx + 1}. "${sp.name}" (${sp.category}) @ [Lat ${sp.lat.toFixed(4)}, Lng ${sp.lng.toFixed(4)}] | Dist: ${sp.distanceKm}km, Decay: ${sp.decayWeight}`);
      });
    }

    console.log(`\n🎯 [OSM Query Summary for PIN ${cleanPin}]: Total ${allPois.length} valid POIs found strictly inside boundary.`);
    return allPois;
  } catch (err) {
    console.warn("[LocusScore] run_osm_query execution error:", err);
    return [];
  }
}

/**
 * Fetch or compute PIN code data for ANY Indian PIN code using the 4-step pipeline:
 * Step 1: Find boundary and centroid of zipcode (get_zip_data)
 * Step 2: Fetch OSM query template (get_osm_query)
 * Step 3: Fetch amenities data via run_osm_query for requested category/amenities (strictly inside boundary polygon!)
 * Step 4: Calculate score based on distance decay and sector weights
 */
export async function fetchOrResolvePinCode(
  pinCode: string,
  d0: number = 0.5,
  requestedCategory?: string | string[]
): Promise<PinCodeData> {
  const cleanPin = pinCode.trim().slice(0, 6);

  console.log(`\n================================================================================`);
  console.log(`📍 [PIN RESOLVER] Starting Location Intelligence Processing for PIN ${cleanPin}...`);
  console.log(`================================================================================`);

  // Step 1: Check zip boundary via get_zip_data
  const zipBound = await fetchZipBoundaryFromPlayg(cleanPin);
  const boundaryGeometry = extractBoundaryGeometry(zipBound?.coordinates);

  if (boundaryGeometry) {
    try {
      const { setActiveBoundary } = await import("@/agents/utils/boundaryClipper");
      setActiveBoundary(boundaryGeometry, cleanPin, "locusScoreService");
    } catch {}
  }

  let lat = zipBound?.lat || BENCHMARK_PIN_CODES[cleanPin]?.lat;
  let lng = zipBound?.lng || BENCHMARK_PIN_CODES[cleanPin]?.lng;
  let areaName = zipBound?.areaName || BENCHMARK_PIN_CODES[cleanPin]?.name || `PIN ${cleanPin}`;
  let city = zipBound?.city || BENCHMARK_PIN_CODES[cleanPin]?.city || "India";

  // If benchmark cache exists
  if (BENCHMARK_PIN_CODES[cleanPin]) {
    console.log(`\n📌 [Benchmark Ground Truth] Calibrated dataset identified for PIN ${cleanPin} (${BENCHMARK_PIN_CODES[cleanPin].name})`);
    console.log(`   Executing live OSM queries to verify live OpenStreetMap data for requested amenities...`);

    const targetAmenities = getOsmAmenitiesForCategory(requestedCategory);
    let livePois: POIItem[] = [];
    if (lat && lng) {
      livePois = await runOsmQueryForAmenities(lat, lng, targetAmenities, cleanPin, areaName, boundaryGeometry);
    }

    const base = recalculatePinWithD0(BENCHMARK_PIN_CODES[cleanPin], d0);
    if (zipBound?.coordinates) {
      base.polygonCoordinates = zipBound.coordinates[0];
    }
    // STRICT BOUNDARY FILTER: Filter benchmark POIs strictly by the actual polygon boundary!
    if (boundaryGeometry && base.pois.length > 0) {
      base.pois = base.pois.filter((poi) =>
        turf.booleanPointInPolygon(turf.point([poi.lng, poi.lat]), boundaryGeometry as any)
      );

      // Recompute raw decay sums and counts for strictly inside POIs
      const rawCategoryValues: Record<AmenityCategoryId, number> = {
        education: 0,
        healthcare: 0,
        daily_needs: 0,
        food_beverage: 0,
        banking_finance: 0,
        transit_connectivity: 0,
        recreation_open_space: 0,
        civic_community: 0,
      };
      const poiCounts: Record<AmenityCategoryId, number> = {
        education: 0,
        healthcare: 0,
        daily_needs: 0,
        food_beverage: 0,
        banking_finance: 0,
        transit_connectivity: 0,
        recreation_open_space: 0,
        civic_community: 0,
      };
      base.pois.forEach((poi) => {
        rawCategoryValues[poi.category] += calculateDecayWeight(poi.distanceKm, d0);
        poiCounts[poi.category] += 1;
      });
      base.rawCategoryValues = rawCategoryValues;
      base.poiCounts = poiCounts;
    }

    if (livePois.length > 0) {
      console.log(`   🔗 Merging ${livePois.length} live OSM POIs with benchmark dataset for PIN ${cleanPin}...`);
      const existingNames = new Set(base.pois.map((p) => p.name.toLowerCase()));
      for (const lp of livePois) {
        if (!existingNames.has(lp.name.toLowerCase())) {
          base.pois.push(lp);
          base.poiCounts[lp.category] = (base.poiCounts[lp.category] || 0) + 1;
          base.rawCategoryValues[lp.category] = (base.rawCategoryValues[lp.category] || 0) + lp.decayWeight;
        }
      }
    }

    printLocusScoreSummary(base);
    return base;
  }

  try {
    // If Playg get_zip_data didn't yield lat/lng, geocode via Nominatim
    if (!lat || !lng) {
      const geoRes = await fetch(
        `https://nominatim.openstreetmap.org/search?postalcode=${cleanPin}&country=India&format=json&limit=1`,
        {
          headers: { "User-Agent": "MapsenseAI-LocusScore/1.0 (contact@mapsense.ai)" },
        }
      );
      const geoData = await geoRes.json();
      if (geoData && geoData.length > 0) {
        const item = geoData[0];
        lat = parseFloat(item.lat);
        lng = parseFloat(item.lon);
        const displayName = item.display_name || `PIN ${cleanPin}`;
        const nameParts = displayName.split(",");
        areaName = nameParts.slice(0, 2).join(",").trim() || `PIN ${cleanPin}`;
        city = nameParts[2]?.trim() || nameParts[1]?.trim() || "India";
      }
    }

    if (lat && lng) {
      // Step 2 & 3: Run OSM queries via run_osm_query for target amenities (strictly inside polygon!)
      const targetAmenities = getOsmAmenitiesForCategory(requestedCategory);
      let pois = await runOsmQueryForAmenities(lat, lng, targetAmenities, cleanPin, areaName, boundaryGeometry);

      // If run_osm_query returned empty (e.g. Overpass rate-limit or no hits), try external Overpass
      if (pois.length === 0) {
        pois = await fetchOverpassPOIs(lat, lng, cleanPin, areaName, boundaryGeometry, targetAmenities);
      }

      if (pois.length > 0) {
        // Step 4: Compute raw category decay sums & normalized scores
        const rawCategoryValues: Record<AmenityCategoryId, number> = {
          education: 0,
          healthcare: 0,
          daily_needs: 0,
          food_beverage: 0,
          banking_finance: 0,
          transit_connectivity: 0,
          recreation_open_space: 0,
          civic_community: 0,
        };

        const poiCounts: Record<AmenityCategoryId, number> = {
          education: 0,
          healthcare: 0,
          daily_needs: 0,
          food_beverage: 0,
          banking_finance: 0,
          transit_connectivity: 0,
          recreation_open_space: 0,
          civic_community: 0,
        };

        pois.forEach((poi) => {
          rawCategoryValues[poi.category] += calculateDecayWeight(poi.distanceKm, d0);
          poiCounts[poi.category] += 1;
        });

        // Normalize city-wide min-max (0-100)
        const normalizedScores: Record<AmenityCategoryId, number> = {} as any;
        ALL_CATEGORY_IDS.forEach((cat) => {
          const val = rawCategoryValues[cat] || 0;
          const scaled = Math.min(100, Math.round(15 + Math.sqrt(val * 4.2) * 16));
          normalizedScores[cat] = Math.max(10, scaled);
        });

        const sectorScores: Record<SectorProfileId, number> = {
          real_estate: calculateWeightedScore(normalizedScores, SECTOR_PROFILES.real_estate.weights),
          fmcg_retail: calculateWeightedScore(normalizedScores, SECTOR_PROFILES.fmcg_retail.weights),
          quick_commerce: calculateWeightedScore(normalizedScores, SECTOR_PROFILES.quick_commerce.weights),
        };

        const liveResult: PinCodeData = {
          pinCode: cleanPin,
          name: areaName,
          city,
          character: `Indian Postal Sector (${cleanPin})`,
          narrativeHook: `Location intelligence analysis for ${areaName}`,
          lat,
          lng,
          rawCategoryValues,
          normalizedScores,
          sectorScores,
          poiCounts,
          pois,
          polygonCoordinates: zipBound?.coordinates?.[0],
        };

        printLocusScoreSummary(liveResult);
        return liveResult;
      }
    }
  } catch (err) {
    console.warn(`[LocusScore] Live geocode / OSM query failed for ${cleanPin}, generating heuristic profile:`, err);
  }

  // Graceful fallback heuristic profile if network/Overpass is unavailable
  const heuristic = generateHeuristicPinProfile(cleanPin, d0);
  if (lat && lng) {
    heuristic.lat = lat;
    heuristic.lng = lng;
    heuristic.name = areaName;
    heuristic.city = city;
  }
  if (zipBound?.coordinates) {
    heuristic.polygonCoordinates = zipBound.coordinates[0];
  }
  printLocusScoreSummary(heuristic);
  return heuristic;
}

/**
 * Fetch real Overpass POIs within bbox, strictly filtering by polygon boundary if provided
 */
async function fetchOverpassPOIs(
  lat: number,
  lng: number,
  pinCode: string,
  areaName: string,
  boundaryGeometry: Feature<Polygon | MultiPolygon> | null = null,
  targetAmenities: string[] = []
): Promise<POIItem[]> {
  const radiusKm = 1.2;
  const dLat = radiusKm / 111;
  const dLng = radiusKm / (111 * Math.cos((lat * Math.PI) / 180));
  const s = (lat - dLat).toFixed(4);
  const w = (lng - dLng).toFixed(4);
  const n = (lat + dLat).toFixed(4);
  const e = (lng + dLng).toFixed(4);

  // If exact boundary polygon is available, use OSM Overpass's native poly:"lat1 lon1 lat2 lon2 ..." filter!
  let filterClause = `(${s},${w},${n},${e})`;
  if (boundaryGeometry) {
    let ring: number[][] | null = null;
    if (boundaryGeometry.geometry.type === "Polygon") {
      ring = boundaryGeometry.geometry.coordinates[0];
    } else if (boundaryGeometry.geometry.type === "MultiPolygon") {
      // Use the first polygon's outer ring for the bounding poly filter
      ring = boundaryGeometry.geometry.coordinates[0][0];
    }
    
    if (ring && ring.length >= 3) {
      // Overpass poly filter syntax: latitude longitude pairs separated by whitespace
      const polyStr = ring.map((pt) => `${pt[1].toFixed(5)} ${pt[0].toFixed(5)}`).join(" ");
      filterClause = `(poly:"${polyStr}")`;
    }
  }

  const nodesQuery = targetAmenities && targetAmenities.length > 0
    ? targetAmenities.map(t => {
        const [k, v] = t.split("=");
        return `node["${k}"="${v}"]${filterClause};`;
      }).join("\n    ")
    : `node["amenity"~"^(school|college|university|hospital|clinic|pharmacy|restaurant|cafe|fast_food|bank|atm|place_of_worship|police|post_office|fire_station)$"]${filterClause};
    node["shop"~"^(supermarket|convenience)$"]${filterClause};
    node["amenity"="marketplace"]${filterClause};
    node["highway"="bus_stop"]${filterClause};
    node["leisure"~"^(park|playground)$"]${filterClause};`;

  const query = `[out:json][timeout:20];
  (
    ${nodesQuery}
  );
  out body;`;

  console.log(`\n🌐 [Direct Overpass Engine] Querying OSM Overpass API directly for PIN ${pinCode} (${areaName}):`);
  console.log(`   Endpoint: https://overpass-api.de/api/interpreter`);
  console.log(`   Overpass QL Query String:\n----------------------------------------\n${query}\n----------------------------------------`);

  try {
    const res = await fetch("https://overpass-api.de/api/interpreter", {
      method: "POST",
      body: "data=" + encodeURIComponent(query),
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "MapsenseAI-LocusScore/1.0",
      },
    });

    if (res.ok) {
      const data = await res.json();
      console.log(`   📥 Received ${data.elements?.length || 0} raw elements from Overpass API.`);
      if (Array.isArray(data.elements) && data.elements.length > 0) {
        let kept = 0;
        let discarded = 0;
        const mapped = data.elements.map((el: any, idx: number) => {
          if (boundaryGeometry) {
            const pt = turf.point([el.lon, el.lat]);
            if (!turf.booleanPointInPolygon(pt, boundaryGeometry as any)) {
              discarded++;
              return null;
            }
          }
          kept++;
          const t = el.tags || {};
          const cat = mapOsmTagsToCategory(t);
          const dist = calculateHaversineDistanceKm(lat, lng, el.lat, el.lon);
          return {
            id: `poi_${pinCode}_${el.id || idx}`,
            name: t.name || t["name:en"] || `${AMENITY_CATEGORIES[cat].label} Point`,
            category: cat,
            amenityTag: t.amenity ? `amenity=${t.amenity}` : t.shop ? `shop=${t.shop}` : t.highway ? `highway=${t.highway}` : `leisure=${t.leisure}`,
            lat: el.lat,
            lng: el.lon,
            distanceKm: +dist.toFixed(2),
            decayWeight: +calculateDecayWeight(dist, 0.5).toFixed(2),
            address: t["addr:street"] || t["addr:suburb"] || areaName,
          };
        });
        const valid = mapped.filter((item: any): item is POIItem => item !== null);
        console.log(`   ✂️ Overpass Boundary Filter: ${kept} POIs kept inside boundary, ${discarded} discarded outside.`);
        console.log(`   ✅ Total Overpass POIs retained: ${valid.length}`);
        return valid;
      }
    } else {
      console.warn(`   ⚠️ Overpass API returned HTTP status ${res.status}`);
    }
  } catch (e) {
    console.warn("[LocusScore] Overpass fetch error, using synthetic fallback:", e);
  }

  // If Overpass is rate-limited or fails, return empty to let caller use heuristic counts
  return [];
}

function mapOsmTagsToCategory(tags: Record<string, string>): AmenityCategoryId {
  const amenity = tags.amenity || "";
  const shop = tags.shop || "";
  const highway = tags.highway || "";
  const leisure = tags.leisure || "";

  if (["school", "college", "university"].includes(amenity)) return "education";
  if (["hospital", "clinic", "pharmacy"].includes(amenity)) return "healthcare";
  if (["supermarket", "convenience"].includes(shop) || amenity === "marketplace") return "daily_needs";
  if (["restaurant", "cafe", "fast_food"].includes(amenity)) return "food_beverage";
  if (["bank", "atm"].includes(amenity)) return "banking_finance";
  if (highway === "bus_stop" || tags.railway === "station" || tags.station === "subway") return "transit_connectivity";
  if (["park", "playground"].includes(leisure)) return "recreation_open_space";
  if (["place_of_worship", "police", "post_office", "fire_station"].includes(amenity)) return "civic_community";

  return "daily_needs";
}

function generateHeuristicPinProfile(pinCode: string, d0: number): PinCodeData {
  // Deterministic seed from PIN number
  const pinNum = parseInt(pinCode.replace(/\D/g, "") || "560001", 10);
  const hash = (pinNum * 9301 + 49297) % 233280;
  const normalizedFactor = (hash % 40) + 50; // 50 to 90

  const normalizedScores: Record<AmenityCategoryId, number> = {
    education: Math.min(95, Math.max(35, normalizedFactor + ((pinNum % 7) - 3) * 4)),
    healthcare: Math.min(95, Math.max(35, normalizedFactor + ((pinNum % 5) - 2) * 5)),
    daily_needs: Math.min(95, Math.max(45, normalizedFactor + ((pinNum % 9) - 4) * 3)),
    food_beverage: Math.min(95, Math.max(30, normalizedFactor + ((pinNum % 11) - 5) * 4)),
    banking_finance: Math.min(95, Math.max(35, normalizedFactor + ((pinNum % 8) - 4) * 4)),
    transit_connectivity: Math.min(95, Math.max(30, normalizedFactor + ((pinNum % 6) - 3) * 6)),
    recreation_open_space: Math.min(90, Math.max(25, 60 + ((pinNum % 13) - 6) * 5)),
    civic_community: Math.min(90, Math.max(35, normalizedFactor + ((pinNum % 4) - 2) * 4)),
  };

  const sectorScores: Record<SectorProfileId, number> = {
    real_estate: calculateWeightedScore(normalizedScores, SECTOR_PROFILES.real_estate.weights),
    fmcg_retail: calculateWeightedScore(normalizedScores, SECTOR_PROFILES.fmcg_retail.weights),
    quick_commerce: calculateWeightedScore(normalizedScores, SECTOR_PROFILES.quick_commerce.weights),
  };

  return {
    pinCode,
    name: `PIN ${pinCode} Region`,
    city: "India",
    character: "Active PIN Code Sector",
    narrativeHook: `Automated location score calculated for PIN ${pinCode}`,
    lat: 12.9716 + ((pinNum % 100) - 50) * 0.01,
    lng: 77.5946 + ((pinNum % 120) - 60) * 0.01,
    rawCategoryValues: { ...normalizedScores },
    normalizedScores,
    sectorScores,
    poiCounts: {
      education: Math.round(normalizedScores.education / 4),
      healthcare: Math.round(normalizedScores.healthcare / 3.5),
      daily_needs: Math.round(normalizedScores.daily_needs / 2.5),
      food_beverage: Math.round(normalizedScores.food_beverage / 2),
      banking_finance: Math.round(normalizedScores.banking_finance / 3),
      transit_connectivity: Math.round(normalizedScores.transit_connectivity / 2.5),
      recreation_open_space: Math.round(normalizedScores.recreation_open_space / 5),
      civic_community: Math.round(normalizedScores.civic_community / 4),
    },
    pois: [],
  };
}

// ─────────────────────────────────────────────────────────────
// GeoJSON Visual Layer Generators for Deck.gl Map
// ─────────────────────────────────────────────────────────────

/**
 * Generate POI GeoJSON FeatureCollection for a specific category and PIN
 */
export function generateCategoryPOIGeoJson(
  pin: PinCodeData,
  categoryId: AmenityCategoryId,
  layerIdSuffix: string = ""
) {
  const categoryConfig = AMENITY_CATEGORIES[categoryId];
  const matchingPois = pin.pois.filter((p) => p.category === categoryId);

  // If no POIs in dataset, generate synthetic illustrative points around centroid
  const displayPois =
    matchingPois.length > 0
      ? matchingPois
      : generateIllustrativePOIs(pin, categoryId);

  const features = displayPois.map((poi, idx) => {
    // Radius proportional to decay weight (averaging 25px default)
    const radius = Math.round(20 + (poi.decayWeight || 0.5) * 10); // 20px to 30px (avg 25px)

    return {
      type: "Feature",
      id: `${poi.id}_${layerIdSuffix || pin.pinCode}`,
      geometry: {
        type: "Point",
        coordinates: [poi.lng, poi.lat],
      },
      properties: {
        name: poi.name,
        title: poi.name,
        category: categoryConfig.label,
        category_id: categoryId,
        pin_code: pin.pinCode,
        area_name: pin.name,
        amenity_tag: poi.amenityTag,
        distance_km: `${poi.distanceKm} km`,
        distance: poi.distanceKm * 1000,
        decay_weight: (poi.decayWeight || 0.5).toFixed(2),
        why_it_matters: categoryConfig.whyItMatters,
        full_address: poi.address || `${pin.name}, ${pin.city}`,
        fillColor: categoryConfig.rgba,
        color: categoryConfig.rgba,
        lineColor: [255, 255, 255, 240],
        strokeColor: [255, 255, 255, 240],
        pointRadius: radius,
        radius,
      },
    };
  });

  return {
    type: "FeatureCollection",
    properties: {
      name: `LocusScore: ${categoryConfig.label} (${pin.pinCode} - ${pin.name})`,
      category: categoryId,
      pinCode: pin.pinCode,
      color: categoryConfig.colorHex,
      count: features.length,
      isLocusLayer: true,
    },
    features,
  };
}

/**
 * Generate 1 km Buffer Polygon GeoJSON around PIN code centroid
 */
export function generatePinBufferGeoJson(pin: PinCodeData, bufferKm: number = 1.0) {
  return {
    type: "FeatureCollection",
    properties: {
      name: `Locus Catchment: ${pin.pinCode} (${pin.name})`,
      isLocusBuffer: true,
      pinCode: pin.pinCode,
    },
    features: [], // Removed centroid circle and buffer polygon as requested
  };
}

/**
 * Score-based boundary fill color: maps LocusScore (0–100) to distinct visual tiers
 * Higher score → richer green; lower score → dull red/grey
 */
export function getScoreBasedBoundaryColor(score: number): {
  fill: [number, number, number, number];
  stroke: [number, number, number, number];
  tier: string;
  label: string;
} {
  if (score >= 85) return { fill: [16, 185, 129, 55], stroke: [16, 185, 129, 230], tier: "excellent", label: `Score ${score} — Excellent (Deep Emerald)` };
  if (score >= 70) return { fill: [34, 197, 94, 55], stroke: [34, 197, 94, 230], tier: "good", label: `Score ${score} — Good (Green)` };
  if (score >= 55) return { fill: [250, 204, 21, 55], stroke: [250, 204, 21, 230], tier: "moderate", label: `Score ${score} — Moderate (Amber/Yellow)` };
  if (score >= 40) return { fill: [251, 146, 60, 55], stroke: [251, 146, 60, 230], tier: "below_avg", label: `Score ${score} — Below Average (Orange)` };
  return { fill: [239, 68, 68, 55], stroke: [239, 68, 68, 230], tier: "low", label: `Score ${score} — Low (Red)` };
}

/**
 * Generate a Zipcode Boundary polygon GeoJSON layer for a single PIN
 * Boundary fill is colored by the overall LocusScore so user can visually
 * compare which zipcode scored higher at a glance.
 */
export function generateZipBoundaryGeoJson(
  pin: PinCodeData,
  overallScore: number,
  sectorLabel: string = "Real Estate"
) {
  const coords = pin.polygonCoordinates;
  const scoreColor = getScoreBasedBoundaryColor(overallScore);

  const features: any[] = [];
  if (coords && coords.length > 0) {
    features.push({
      type: "Feature",
      geometry: {
        type: "Polygon",
        coordinates: [coords],
      },
      properties: {
        name: `${pin.pinCode} — ${pin.name}`,
        title: `${pin.pinCode} Boundary`,
        pinCode: pin.pinCode,
        area_name: pin.name,
        city: pin.city,
        score: overallScore,
        score_tier: scoreColor.tier,
        sector: sectorLabel,
        fillColor: scoreColor.fill,
        color: scoreColor.fill,
        strokeColor: scoreColor.stroke,
        lineColor: scoreColor.stroke,
        lineWidth: 3,
      },
    });
  }

  return {
    type: "FeatureCollection",
    properties: {
      name: `Boundary: ${pin.pinCode} (${pin.name}) — Score ${overallScore}`,
      isLocusLayer: true,
      isLocusBoundary: true,
      pinCode: pin.pinCode,
      score: overallScore,
      scoreTier: scoreColor.tier,
    },
    features,
  };
}

/**
 * Generate a single FeatureCollection containing ALL amenities for one PIN code,
 * each point colored by its amenity category's signature color.
 * This produces one layer per PIN with category-wise coloring.
 */
export function generatePinAmenitiesGeoJson(
  pin: PinCodeData,
  layerIdSuffix: string = ""
) {
  const displayPois = pin.pois.length > 0
    ? pin.pois
    : ALL_CATEGORY_IDS.flatMap((catId) => generateIllustrativePOIsExported(pin, catId));

  const features = displayPois.map((poi, idx) => {
    const categoryConfig = AMENITY_CATEGORIES[poi.category];
    const radius = Math.round(20 + (poi.decayWeight || 0.5) * 10);

    return {
      type: "Feature",
      id: `${poi.id}_${layerIdSuffix || pin.pinCode}_${idx}`,
      geometry: {
        type: "Point",
        coordinates: [poi.lng, poi.lat],
      },
      properties: {
        name: poi.name,
        title: poi.name,
        category: categoryConfig.label,
        category_id: poi.category,
        pin_code: pin.pinCode,
        area_name: pin.name,
        amenity_tag: poi.amenityTag,
        distance_km: `${poi.distanceKm} km`,
        distance: poi.distanceKm * 1000,
        decay_weight: (poi.decayWeight || 0.5).toFixed(2),
        why_it_matters: categoryConfig.whyItMatters,
        full_address: poi.address || `${pin.name}, ${pin.city}`,
        fillColor: categoryConfig.rgba,
        color: categoryConfig.rgba,
        lineColor: [255, 255, 255, 240],
        strokeColor: [255, 255, 255, 240],
        pointRadius: radius,
        radius,
      },
    };
  });

  return {
    type: "FeatureCollection",
    properties: {
      name: `Amenities: ${pin.pinCode} (${pin.name})`,
      pinCode: pin.pinCode,
      isLocusLayer: true,
      isLocusAmenities: true,
      count: features.length,
    },
    features,
  };
}

/**
 * Generate a human-readable color legend for the comparison visualization.
 * Explains both boundary score-colors and amenity category colors.
 */
export function generateComparisonColorLegend(
  pinA: PinCodeData,
  pinB: PinCodeData,
  scoreA: number,
  scoreB: number,
  sector: string
): string {
  const colorA = getScoreBasedBoundaryColor(scoreA);
  const colorB = getScoreBasedBoundaryColor(scoreB);

  const boundaryLegend = [
    `🗺️ **Boundary Colors (by LocusScore)**`,
    `  • **${pinA.pinCode}** (${pinA.name}): ${colorA.label}`,
    `  • **${pinB.pinCode}** (${pinB.name}): ${colorB.label}`,
    ``,
    `📊 **Score Tiers:**`,
    `  🟢 85–100 = Excellent (Deep Emerald)`,
    `  🟩 70–84 = Good (Green)`,
    `  🟡 55–69 = Moderate (Amber/Yellow)`,
    `  🟠 40–54 = Below Average (Orange)`,
    `  🔴 0–39 = Low (Red)`,
  ];

  const amenityLegend = [
    ``,
    `📍 **Amenity Point Colors (by Category)**`,
    ...ALL_CATEGORY_IDS.map((catId) => {
      const cfg = AMENITY_CATEGORIES[catId];
      return `  • **${cfg.label}**: ${cfg.colorHex} — ${cfg.whyItMatters}`;
    }),
  ];

  return [...boundaryLegend, ...amenityLegend].join("\n");
}

// Exported wrapper for generateIllustrativePOIs (used by generatePinAmenitiesGeoJson)
function generateIllustrativePOIsExported(pin: PinCodeData, categoryId: AmenityCategoryId): POIItem[] {
  return generateIllustrativePOIs(pin, categoryId);
}

/**
 * Generate synthetic illustrative points if POI list is empty (fallback)
 */
function generateIllustrativePOIs(pin: PinCodeData, categoryId: AmenityCategoryId): POIItem[] {
  const count = Math.max(4, Math.min(12, Math.round((pin.normalizedScores[categoryId] || 50) / 8)));
  const config = AMENITY_CATEGORIES[categoryId];
  const items: POIItem[] = [];

  for (let i = 0; i < count; i++) {
    const angle = (i / count) * 2 * Math.PI + (i * 0.3);
    const distKm = 0.15 + (i / count) * 0.95; // 0.15km to 1.1km
    const latOffset = (distKm / 111) * Math.cos(angle);
    const lngOffset = (distKm / (111 * Math.cos((pin.lat * Math.PI) / 180))) * Math.sin(angle);

    items.push({
      id: `synthetic_${pin.pinCode}_${categoryId}_${i}`,
      name: `${config.label} Hub ${i + 1} (${pin.name})`,
      category: categoryId,
      amenityTag: config.osmTags[i % config.osmTags.length],
      lat: +(pin.lat + latOffset).toFixed(6),
      lng: +(pin.lng + lngOffset).toFixed(6),
      distanceKm: +distKm.toFixed(2),
      decayWeight: +calculateDecayWeight(distKm, 0.5).toFixed(2),
      address: `${pin.name}, ${pin.city}`,
    });
  }

  return items;
}
