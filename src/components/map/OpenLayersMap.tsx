"use client";

import React, { useEffect, useRef, useState } from "react";
import Map from "ol/Map";
import View from "ol/View";
import TileLayer from "ol/layer/Tile";
import OSM from "ol/source/OSM";
import XYZ from "ol/source/XYZ";
import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import GeoJSON from "ol/format/GeoJSON";
import { Style, Stroke, Fill, Circle as CircleStyle } from "ol/style";
import { toLonLat, fromLonLat } from "ol/proj";
import Draw from "ol/interaction/Draw";
import Modify from "ol/interaction/Modify";
import Select from "ol/interaction/Select";
import { click, pointerMove } from "ol/events/condition";
import { useMapStore } from "@/stores/useMapStore";
import { Feature } from "ol";

const getBaseMapSource = (baseMap: string) => {
  switch (baseMap) {
    case "carto-light":
      return new XYZ({
        url: 'https://{a-c}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',
        attributions: '© OpenStreetMap contributors © CARTO',
      });
    case "carto-dark":
      return new XYZ({
        url: 'https://{a-c}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
        attributions: '© OpenStreetMap contributors © CARTO',
      });
    case "satellite":
      return new XYZ({
        url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        attributions: 'Tiles © Esri',
      });
    case "osm":
    default:
      return new OSM();
  }
};

export const OpenLayersMap = () => {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<Map | null>(null);
  const vectorSourceRef = useRef<VectorSource>(new VectorSource());
  const tileLayerRef = useRef<TileLayer<OSM | XYZ>>(new TileLayer({ source: new OSM() }));
  const [hoverInfo, setHoverInfo] = useState<{ props: Record<string, any>; x: number; y: number } | null>(null);

  const { 
    mapFeatures, 
    baseMap, 
    setMapViewState, 
    setBaseMap, 
    setMapInstance,
    interactionMode,
    setInteractionMode,
    setMapFeatures
  } = useMapStore();

  const interactionModeRef = useRef<string | null>(null);
  const isSyncingRef = useRef<boolean>(false);
  
  // Keep the ref updated with the latest mode for event listeners
  useEffect(() => {
    interactionModeRef.current = interactionMode;
  }, [interactionMode]);

  // Helper to sync local vector features back to the global store
  const syncFeaturesToStore = () => {
    isSyncingRef.current = true;
    const geojsonFormat = new GeoJSON();
    
    import('ol/geom/Polygon').then(({ fromCircle }) => {
      const features = vectorSourceRef.current.getFeatures().map(f => {
        const geom = f.getGeometry();
        if (geom && geom.getType() === 'Circle') {
          const polygonGeom = fromCircle(geom as any);
          const newFeature = f.clone();
          newFeature.setGeometry(polygonGeom);
          return newFeature;
        }
        return f;
      });

      try {
        const geojson = geojsonFormat.writeFeaturesObject(features, {
          featureProjection: "EPSG:3857",
        });
        setMapFeatures(geojson.features || []);
      } catch (e) {
        console.error("Failed to sync features to GeoJSON", e);
      }
      
      // Reset syncing flag shortly after to allow external updates
      setTimeout(() => {
        isSyncingRef.current = false;
      }, 100);
    });
  };

  useEffect(() => {
    if (tileLayerRef.current) {
      tileLayerRef.current.setSource(getBaseMapSource(baseMap));
    }
  }, [baseMap]);

  useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current) return;

    // Default styles for LLM-generated features
    const defaultStyle = new Style({
      stroke: new Stroke({
        color: "#3b82f6", // Blue-500
        width: 3,
      }),
      fill: new Fill({
        color: "rgba(59, 130, 246, 0.2)",
      }),
      image: new CircleStyle({
        radius: 6,
        fill: new Fill({ color: "#ef4444" }), // Red-500 for points
        stroke: new Stroke({ color: "white", width: 2 }),
      }),
    });

    const vectorLayer = new VectorLayer({
      source: vectorSourceRef.current,
      style: defaultStyle,
    });

    const map = new Map({
      target: mapRef.current,
      layers: [
        tileLayerRef.current,
        vectorLayer,
      ],
      view: new View({
        center: [0, 0], // Center at [0, 0] (EPSG:3857)
        zoom: 2,
      }),
      controls: [], // Hide default controls for a clean UI
    });

    mapInstanceRef.current = map;

    // Hover logic and dynamic cursors
    map.on("pointermove", (e) => {
      if (e.dragging) {
        setHoverInfo(null);
        return;
      }
      const pixel = map.getEventPixel(e.originalEvent);
      let hit = false;
      map.forEachFeatureAtPixel(pixel, (feature) => {
        const props = feature.getProperties() || {};

        // Don't show tooltip if properties only contain geometry
        if (Object.keys(props).length > 1) {
          const mouseEvent = e.originalEvent as MouseEvent;
          setHoverInfo({
            props: props,
            x: mouseEvent.clientX,
            y: mouseEvent.clientY,
          });
          hit = true;
        }
        return true; // stop at first feature
      });

      if (!hit) {
        setHoverInfo(null);
      }

      // Determine dynamic cursor based on interactionMode and hover state
      const currentMode = interactionModeRef.current;
      let cursor = "";
      
      if (currentMode?.startsWith("DRAW_")) {
        cursor = "crosshair";
      } else if (currentMode === "EDIT_GEOMETRY") {
        // Pen cursor
        cursor = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' fill='black' stroke='white' stroke-width='1' viewBox='0 0 16 16'%3E%3Cpath d='M12.854.146a.5.5 0 0 0-.707 0L10.5 1.793 14.207 5.5l1.647-1.646a.5.5 0 0 0 0-.708l-3-3zm.646 6.061L9.793 2.5 3.293 9H3v.5h.5v.5h.5v.5h.5v.5h.5v.5H6v-1.5l6.5-6.5z'/%3E%3C/svg%3E") 0 24, pointer`;
      } else if (currentMode === "DELETE_GEOMETRY") {
        // Trash cursor
        cursor = hit 
          ? `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' fill='red' stroke='white' stroke-width='1' viewBox='0 0 16 16'%3E%3Cpath d='M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0V6z'/%3E%3Cpath fill-rule='evenodd' d='M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1v1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4H4.118zM2.5 3V2h11v1h-11z'/%3E%3C/svg%3E") 12 12, pointer`
          : "no-drop";
      } else if (hit) {
        cursor = "pointer";
      }

      map.getTargetElement().style.cursor = cursor;
    });

    // Track map state for the LLM context
    map.on("moveend", () => {
      const view = map.getView();
      const centerProj = view.getCenter();
      if (centerProj) {
        const center = toLonLat(centerProj) as [number, number];
        setMapViewState({
          center: [center[0], center[1]],
          zoom: view.getZoom() || 0,
          rotation: (view.getRotation() * 180) / Math.PI,
        });
      }
    });

    setMapInstance(map);

    return () => {
      setMapInstance(null);
      map.setTarget(undefined);
      mapInstanceRef.current = null;
    };
  }, []);

  // Watch for new features from LLM
  useEffect(() => {
    if (!mapInstanceRef.current) return;
    if (isSyncingRef.current) return; // Ignore updates that we just synced ourselves

    const source = vectorSourceRef.current;
    source.clear(); // Clear old features on new chat actions? Or keep them? Let's keep them and just re-add all.
    // Actually, it's better to clear and draw all current mapFeatures

    if (mapFeatures.length === 0) return;

    const geojsonFormat = new GeoJSON();

    mapFeatures.forEach((featureObj) => {
      try {
        const features = geojsonFormat.readFeatures(featureObj, {
          featureProjection: "EPSG:3857",
        });
        source.addFeatures(features);
      } catch (e) {
        console.error("Failed to parse GeoJSON feature:", e);
      }
    });

    // Handle zooming
    const features = source.getFeatures();
    if (features.length > 0) {
      const lastFeature = features[features.length - 1];
      const props = lastFeature.getProperties();
      
      // If the latest feature is a marker with a specific zoom, zoom to it directly
      if (props.type === "marker" && props.zoom) {
        const geometry = lastFeature.getGeometry();
        if (geometry && geometry.getType() === 'Point') {
           const coords = (geometry as any).getCoordinates();
           mapInstanceRef.current.getView().animate({
             center: coords,
             zoom: props.zoom,
             duration: 1000,
           });
           return;
        }
      }

      // Otherwise, fit map to show all features
      const extent = source.getExtent();
      if (extent) {
        mapInstanceRef.current.getView().fit(extent, {
          padding: [100, 100, 100, 100],
          duration: 1000,
          maxZoom: 16, // Don't zoom in too close for single points
        });
      }
    }
  }, [mapFeatures]);

  // Manage interaction modes
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    // Remove all existing drawing/editing/hover interactions first
    map.getInteractions().forEach((interaction) => {
      // By convention, we can tag hover interactions by setting a property on them if needed,
      // but here we just clear all Draw, Modify, and Select interactions
      if (interaction instanceof Draw || interaction instanceof Modify || interaction instanceof Select) {
        map.removeInteraction(interaction);
      }
    });

    if (!interactionMode) return;

    let interaction: any = null;
    let hoverInteraction: Select | null = null;

    if (interactionMode === "DRAW_POINT") {
      interaction = new Draw({ source: vectorSourceRef.current, type: "Point" });
    } else if (interactionMode === "DRAW_LINE") {
      interaction = new Draw({ source: vectorSourceRef.current, type: "LineString" });
    } else if (interactionMode === "DRAW_POLYGON") {
      interaction = new Draw({ source: vectorSourceRef.current, type: "Polygon" });
    } else if (interactionMode === "DRAW_CIRCLE") {
      interaction = new Draw({ source: vectorSourceRef.current, type: "Circle" });
    } else if (interactionMode === "DRAW_RECTANGLE") {
      // OpenLayers doesn't have a native "Rectangle" type, but we can simulate it with a Circle and geometryFunction
      import("ol/interaction/Draw").then(({ createBox }) => {
        const boxInteraction = new Draw({
          source: vectorSourceRef.current,
          type: "Circle",
          geometryFunction: createBox(),
        });
        boxInteraction.on("drawend", () => {
          syncFeaturesToStore();
          // DO NOT setInteractionMode(null) here, so user can keep drawing
        });
        map.addInteraction(boxInteraction);
      });
      return; // Early return since it's async
    } else if (interactionMode === "EDIT_GEOMETRY") {
      // Hover Select for Edit Mode (Orange/Amber styling)
      const hoverEditStyle = new Style({
        stroke: new Stroke({ color: "#f59e0b", width: 4 }), // amber-500
        fill: new Fill({ color: "rgba(245, 158, 11, 0.3)" }),
        image: new CircleStyle({ radius: 8, fill: new Fill({ color: "#f59e0b" }) }),
      });
      hoverInteraction = new Select({
        condition: pointerMove,
        style: hoverEditStyle,
      });

      interaction = new Modify({ source: vectorSourceRef.current });
      interaction.on("modifyend", () => {
        syncFeaturesToStore();
      });
    } else if (interactionMode === "DELETE_GEOMETRY") {
      // Hover Select for Delete Mode (Red styling)
      const hoverDeleteStyle = new Style({
        stroke: new Stroke({ color: "#ef4444", width: 4 }), // red-500
        fill: new Fill({ color: "rgba(239, 68, 68, 0.3)" }),
        image: new CircleStyle({ radius: 8, fill: new Fill({ color: "#ef4444" }) }),
      });
      hoverInteraction = new Select({
        condition: pointerMove,
        style: hoverDeleteStyle,
      });

      interaction = new Select({ condition: click, style: hoverDeleteStyle });
      interaction.on("select", (e: any) => {
        if (e.selected.length > 0) {
          e.selected.forEach((feature: Feature) => {
            vectorSourceRef.current.removeFeature(feature);
          });
          interaction.getFeatures().clear();
          if (hoverInteraction) hoverInteraction.getFeatures().clear();
          syncFeaturesToStore();
          // DO NOT setInteractionMode(null) here, so user can keep deleting
        }
      });
    }

    if (hoverInteraction) {
      map.addInteraction(hoverInteraction);
    }

    if (interaction) {
      if (interaction instanceof Draw) {
        interaction.on("drawend", () => {
          // Wrap in timeout so the feature is actually in the source when we sync
          setTimeout(() => {
            syncFeaturesToStore();
            // DO NOT setInteractionMode(null) here, so user can keep drawing
          }, 0);
        });
      }
      map.addInteraction(interaction);
    }
    
    return () => {
      if (hoverInteraction && map) map.removeInteraction(hoverInteraction);
      if (interaction && map) map.removeInteraction(interaction);
    };
  }, [interactionMode, setInteractionMode]);

  // Listen for Enter/Escape to exit interaction mode
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Enter" || e.key === "Escape") {
        if (interactionModeRef.current) {
          setInteractionMode(null);
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [setInteractionMode]);

  // Determine active mode styles
  let interactionOverlayClasses = "pointer-events-none absolute inset-0 z-10 transition-all duration-300 ";
  let modeText = "";
  if (interactionMode === "DELETE_GEOMETRY") {
    interactionOverlayClasses += "ring-4 ring-inset ring-red-500 shadow-[inset_0_0_60px_rgba(239,68,68,0.4)]";
    modeText = "Delete Mode Active (Press Enter to exit)";
  } else if (interactionMode === "EDIT_GEOMETRY") {
    interactionOverlayClasses += "ring-4 ring-inset ring-amber-500 shadow-[inset_0_0_60px_rgba(245,158,11,0.4)]";
    modeText = "Edit Mode Active (Press Enter to exit)";
  } else if (interactionMode?.startsWith("DRAW_")) {
    interactionOverlayClasses += "ring-4 ring-inset ring-blue-500 shadow-[inset_0_0_60px_rgba(59,130,246,0.4)]";
    modeText = "Draw Mode Active (Press Enter to exit)";
  } else {
    interactionOverlayClasses += "opacity-0";
  }

  return (
    <div className="relative w-full h-full">
      <div className={interactionOverlayClasses} />
      {modeText && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 bg-background/90 backdrop-blur-md text-foreground px-4 py-2 rounded-full text-[13px] font-semibold shadow-lg border border-border/50 animate-in slide-in-from-top-4 pointer-events-none">
          {modeText}
        </div>
      )}
      <div ref={mapRef} className="w-full h-full bg-[#f8f9fa] dark:bg-[#0a0a0a]" />

      {/* Hover Tooltip */}
      {hoverInfo && (
        <div
          className="fixed z-50 pointer-events-none px-3 py-2 bg-background/95 backdrop-blur-sm border border-border rounded-md shadow-lg text-xs font-medium animate-in fade-in zoom-in-95 duration-100 min-w-[200px] max-w-[300px] max-h-[300px] overflow-hidden flex flex-col gap-1"
          style={{
            left: hoverInfo.x + 15,
            top: hoverInfo.y + 15,
          }}
        >
          {(() => {
            const p = hoverInfo.props || {};
            const title = p.name || p.instruction || p.title || "Map Location";
            const subtitle = p.full_address || p.place_formatted || "";
            const category = p.poi_category
              ? (Array.isArray(p.poi_category) ? p.poi_category.join(", ") : p.poi_category)
              : p.feature_type;
            const distance = p.distance ? `${(p.distance / 1000).toFixed(2)} km` : null;

            return (
              <div className="flex flex-col gap-1.5">
                <div className="font-semibold text-[13px] leading-tight">{title}</div>
                {subtitle && <div className="text-muted-foreground text-[10px] leading-tight">{subtitle}</div>}

                {(category || distance) && (
                  <div className="flex items-center flex-wrap gap-1.5 mt-1 pt-1.5 border-t border-border/50">
                    {category && <span className="text-[9px] font-medium bg-primary/10 text-primary px-1.5 py-0.5 rounded capitalize">{category}</span>}
                    {distance && <span className="text-[9px] font-medium bg-secondary text-secondary-foreground px-1.5 py-0.5 rounded">Dist: {distance}</span>}
                  </div>
                )}
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
};
