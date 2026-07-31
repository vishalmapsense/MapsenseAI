export const getDynamicTools = (prompt: string): string[] => {
  const p = prompt.toLowerCase();
  const tools = new Set<string>();
  
  // Always include basic search & geocoding for general location understanding
  tools.add("search_and_geocode_tool");
  tools.add("reverse_geocode_tool");

  // Directions & Routing
  if (p.includes("route") || p.includes("direction") || p.includes("path") || p.includes("drive") || p.includes("walk") || p.includes("navigate") || p.includes("traffic") || p.includes("how to go")) {
    tools.add("directions_tool");
    tools.add("matrix_tool");
    tools.add("optimization_tool");
  }
  // Isochrone & Reachability
  if (p.includes("isochrone") || p.includes("reach") || p.includes("time") || p.includes("within") || p.includes("drive time") || p.includes("minutes")) {
    tools.add("isochrone_tool");
  }
  // POI & Category Search
  if (p.includes("category") || p.includes("restaurant") || p.includes("cafe") || p.includes("hotel") || p.includes("hospital") || p.includes("find") || p.includes("near") || p.includes("around") || p.includes("places")) {
    tools.add("category_search_tool");
    tools.add("ground_location_tool");
    tools.add("place_details_tool");
  }
  // Geometry & Spatial Analysis
  if (p.includes("buffer") || p.includes("radius")) {
    tools.add("buffer_tool");
  }
  if (p.includes("distance") || p.includes("far") || p.includes("length") || p.includes("measure")) {
    tools.add("distance_tool");
    tools.add("length_tool");
  }
  if (p.includes("area") || p.includes("size") || p.includes("square")) {
    tools.add("area_tool");
  }
  if (p.includes("intersect") || p.includes("overlap") || p.includes("difference") || p.includes("merge") || p.includes("union")) {
    tools.add("intersect_tool");
    tools.add("union_tool");
    tools.add("difference_tool");
  }
  if (p.includes("point") || p.includes("coordinate")) {
    tools.add("nearest_point_tool");
    tools.add("points_within_polygon_tool");
  }

  return Array.from(tools);
};
