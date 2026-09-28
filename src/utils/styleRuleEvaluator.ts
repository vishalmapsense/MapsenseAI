/**
 * Style Rule Evaluator
 * ─────────────────────────────────────────────────────────────
 * Robust evaluation engine for condition-based styling, value groups,
 * semantic region mapping (e.g. South vs North India), and dynamic filtering.
 * Shared across mapExecutor (for tagging) and DeckGLMap (for rendering).
 * ─────────────────────────────────────────────────────────────
 */

import type { StyleRule, RGBAColor } from "@/types/layerStyle.types";
import {
  resolveFeatureProperty,
  resolveFeaturePropertyValue,
  parseNumericValue,
} from "@/utils/propertyResolver";

// Built-in standard geographic classification for Indian states/UTs
export const INDIA_REGION_GROUPS: Record<string, string[]> = {
  South: [
    "tamil nadu",
    "kerala",
    "karnataka",
    "andhra pradesh",
    "telangana",
    "goa",
    "puducherry",
    "pondicherry",
    "lakshadweep",
  ],
  North: [
    "delhi",
    "nct of delhi",
    "punjab",
    "haryana",
    "himachal pradesh",
    "jammu and kashmir",
    "jammu & kashmir",
    "ladakh",
    "uttarakhand",
    "uttaranchal",
    "uttar pradesh",
    "rajasthan",
    "chandigarh",
  ],
  East: ["west bengal", "bihar", "jharkhand", "odisha", "orissa"],
  West: [
    "maharashtra",
    "gujarat",
    "dadra and nagar haveli and daman and diu",
    "daman and diu",
    "dadra and nagar haveli",
  ],
  Central: ["madhya pradesh", "chhattisgarh"],
  NorthEast: [
    "assam",
    "sikkim",
    "meghalaya",
    "tripura",
    "mizoram",
    "manipur",
    "nagaland",
    "arunachal pradesh",
  ],
};

/** Normalizes a string for tolerant matching */
function normStr(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/**
 * Checks if a string value matches any member in a candidate list
 * using normalized exact, substring, or alias comparisons.
 */
export function matchesCandidateList(
  val: unknown,
  candidates: string[],
): boolean {
  if (val === null || val === undefined) return false;
  const nVal = normStr(val);
  if (!nVal) return false;

  for (const c of candidates) {
    const nC = normStr(c);
    if (!nC) continue;
    if (nVal === nC || nVal.includes(nC) || nC.includes(nVal)) {
      return true;
    }
  }
  return false;
}

/**
 * Evaluates a single StyleRule against feature properties.
 */
export function evaluateStyleRule(
  props: Record<string, any>,
  rule: StyleRule,
): boolean {
  if (!props || typeof props !== "object") return false;

  // 1. If explicit condition string provided (e.g. "lat < 20" or "st_nm IN ('Tamil Nadu', 'Kerala')")
  if (rule.condition && typeof rule.condition === "string") {
    const cond = rule.condition.trim();

    // Check "lat < 20", "latitude > 25", etc.
    const numCompareMatch = cond.match(
      /^([a-zA-Z0-9_]+)\s*(<=|>=|<|>|==|=)\s*([-\d.]+)$/i,
    );
    if (numCompareMatch) {
      const field = numCompareMatch[1];
      const op = numCompareMatch[2];
      const targetNum = parseFloat(numCompareMatch[3]);
      const rawVal = resolveFeaturePropertyValue(props, field);
      const num = parseNumericValue(rawVal);
      if (num !== null && !isNaN(num)) {
        if (op === "<") return num < targetNum;
        if (op === "<=") return num <= targetNum;
        if (op === ">") return num > targetNum;
        if (op === ">=") return num >= targetNum;
        if (op === "==" || op === "=") return num === targetNum;
      }
    }

    // Check IN list: field IN ('a', 'b')
    const inMatch = cond.match(/^([a-zA-Z0-9_]+)\s+IN\s*\(([^)]+)\)$/i);
    if (inMatch) {
      const field = inMatch[1];
      const items = inMatch[2]
        .split(",")
        .map((s) => s.trim().replace(/^['"]|['"]$/g, ""))
        .filter(Boolean);
      const rawVal = resolveFeaturePropertyValue(props, field);
      return matchesCandidateList(rawVal, items);
    }
  }

  // 2. Structured rule with field + operator + value
  const fieldName = rule.field;
  let rawVal = fieldName
    ? resolveFeaturePropertyValue(props, fieldName)
    : undefined;

  // If no field specified on rule, search string properties
  if (rawVal === undefined) {
    if (Array.isArray(rule.value)) {
      const strVals = Object.entries(props)
        .filter(([k]) => !k.startsWith("_"))
        .map(([, v]) => v);
      for (const sv of strVals) {
        if (matchesCandidateList(sv, rule.value.map(String))) {
          return true;
        }
      }
      return false;
    }
  }

  const op = (rule.operator || "equals").toLowerCase();
  const target = rule.value;

  switch (op) {
    case "in": {
      const list = Array.isArray(target)
        ? target.map(String)
        : typeof target === "string"
          ? target.split(",").map((s) => s.trim())
          : [String(target)];
      return matchesCandidateList(rawVal, list);
    }
    case "equals":
    case "==":
    case "=": {
      if (target === undefined || target === null) return rawVal === target;
      if (typeof target === "number") {
        const num = parseNumericValue(rawVal);
        return num !== null && num === target;
      }
      return normStr(rawVal) === normStr(target);
    }
    case "!=":
    case "not_equals": {
      return normStr(rawVal) !== normStr(target);
    }
    case "contains":
    case "includes": {
      const sVal = String(rawVal || "").toLowerCase();
      const sTarget = String(target || "").toLowerCase();
      return sVal.includes(sTarget);
    }
    case ">":
    case "<":
    case ">=":
    case "<=": {
      const num = parseNumericValue(rawVal);
      const targetNum = Number(target);
      if (num === null || isNaN(num) || isNaN(targetNum)) return false;
      if (op === ">") return num > targetNum;
      if (op === "<") return num < targetNum;
      if (op === ">=") return num >= targetNum;
      if (op === "<=") return num <= targetNum;
      return false;
    }
    case "between": {
      const num = parseNumericValue(rawVal);
      if (
        num === null ||
        isNaN(num) ||
        !Array.isArray(target) ||
        target.length < 2
      )
        return false;
      return num >= Number(target[0]) && num <= Number(target[1]);
    }
    default:
      return normStr(rawVal) === normStr(target);
  }
}

/**
 * Matches feature properties against valueGroups.
 * Returns the matching category name, or null if no group matched.
 */
export function matchValueGroup(
  props: Record<string, any>,
  valueGroups: Record<string, string[]>,
  preferredField?: string,
): string | null {
  if (!props || !valueGroups || typeof valueGroups !== "object") return null;

  // 1. Try preferredField first if provided
  if (preferredField) {
    const val = resolveFeaturePropertyValue(props, preferredField);
    if (val !== undefined && val !== null && val !== "") {
      for (const [groupName, values] of Object.entries(valueGroups)) {
        if (Array.isArray(values) && matchesCandidateList(val, values)) {
          return groupName;
        }
      }
    }
  }

  // 2. Scan all string properties of the feature
  const candidates: Array<{ key: string; val: any }> = [];
  for (const [k, v] of Object.entries(props)) {
    if (
      !k.startsWith("_") &&
      (typeof v === "string" || typeof v === "number")
    ) {
      candidates.push({ key: k, val: v });
    }
  }

  for (const [groupName, values] of Object.entries(valueGroups)) {
    if (!Array.isArray(values)) continue;
    for (const c of candidates) {
      if (matchesCandidateList(c.val, values)) {
        return groupName;
      }
    }
  }

  return null;
}

/**
 * Automatic semantic classifier for Indian regions.
 * If mapping or requested categories contain South / North / East / West / Central,
 * this resolves the feature property against Indian states and assigns the correct region.
 */
export function autoClassifyIndiaRegion(
  props: Record<string, any>,
  targetCategories: string[],
): string | null {
  if (!props || !targetCategories || targetCategories.length === 0) return null;

  const normTargets = new Map<string, string>();
  for (const tc of targetCategories) {
    normTargets.set(tc.toLowerCase().replace(/[^a-z]/g, ""), tc);
  }

  // Collect all text properties
  const propVals = Object.entries(props)
    .filter(([k]) => !k.startsWith("_"))
    .map(([, v]) => String(v || ""));

  for (const [regionName, states] of Object.entries(INDIA_REGION_GROUPS)) {
    const cleanRegion = regionName.toLowerCase();
    // Check if targetCategories includes this region (e.g. "South" or "North")
    let matchedTargetName: string | undefined;
    for (const [normT, origT] of normTargets.entries()) {
      if (
        normT === cleanRegion ||
        cleanRegion.includes(normT) ||
        normT.includes(cleanRegion)
      ) {
        matchedTargetName = origT;
        break;
      }
    }

    if (!matchedTargetName) continue;

    for (const pv of propVals) {
      if (matchesCandidateList(pv, states)) {
        return matchedTargetName;
      }
    }
  }

  return null;
}

/**
 * Finds which property column in sampleProps contains values matching any of the candidate values.
 */
export function findMatchingPropertyForValues(
  sampleProps: Record<string, any>,
  values: string[],
): string | null {
  if (!sampleProps || !values || values.length === 0) return null;

  for (const [key, val] of Object.entries(sampleProps)) {
    if (key.startsWith("_")) continue;
    if (matchesCandidateList(val, values)) {
      return key;
    }
  }
  return null;
}
