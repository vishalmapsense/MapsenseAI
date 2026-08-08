"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import DeckGL from "@deck.gl/react";
import { GeoJsonLayer, IconLayer } from "@deck.gl/layers";
import { FlyToInterpolator, WebMercatorViewport } from "@deck.gl/core";
import Map from "react-map-gl/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";
import type { StyleSpecification } from "maplibre-gl";
import {
  EditableGeoJsonLayer,
  DrawCircleFromCenterMode,
  DrawLineStringMode,
  DrawPointMode,
  DrawPolygonMode,
  DrawRectangleMode,
  ModifyMode,
} from "@deck.gl-community/editable-layers";
import { useMapStore } from "@/stores/useMapStore";
import { useChatStore } from "@/stores/useChatStore";
import * as turf from "@turf/turf";

const createRasterStyle = (
  id: string,
  tiles: string[],
  attribution: string,
  maxzoom: number,
): StyleSpecification => ({
  version: 8,
  sources: {
    [id]: {
      type: "raster",
      tiles,
      tileSize: 256,
      attribution,
      maxzoom,
    },
  },
  layers: [
    {
      id,
      type: "raster",
      source: id,
      minzoom: 0,
      maxzoom,
    },
  ],
});

const getBaseMapStyle = (baseMap: string): string | StyleSpecification => {
  switch (baseMap) {
    case "carto-light":
      return createRasterStyle(
        "carto-light",
        [
          "https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png",
          "https://b.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png",
          "https://c.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png",
          "https://d.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png",
        ],
        "© OpenStreetMap contributors © CARTO",
        20,
      );
    case "carto-dark":
      return createRasterStyle(
        "carto-dark",
        [
          "https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
          "https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
          "https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
          "https://d.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
        ],
        "© OpenStreetMap contributors © CARTO",
        20,
      );
    case "satellite":
      return createRasterStyle(
        "esri-satellite",
        ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
        "Tiles © Esri",
        22,
      );
    case "osm":
    default:
      return createRasterStyle(
        "osm",
        [
          "https://a.tile.openstreetmap.org/{z}/{x}/{y}.png",
          "https://b.tile.openstreetmap.org/{z}/{x}/{y}.png",
          "https://c.tile.openstreetmap.org/{z}/{x}/{y}.png",
        ],
        "© OpenStreetMap contributors",
        19,
      );
  }
};

const RAW_GEOMETRY_TYPES = [
  "Point",
  "MultiPoint",
  "LineString",
  "MultiLineString",
  "Polygon",
  "MultiPolygon",
  "GeometryCollection",
];

const normalizeGeoJson = (featureObj: any) => {
  if (!featureObj) return null;
  if (RAW_GEOMETRY_TYPES.includes(featureObj.type)) {
    return {
      type: "FeatureCollection",
      features: [{ type: "Feature", geometry: featureObj, properties: {} }],
    };
  }
  if (featureObj.type === "Feature") {
    return { type: "FeatureCollection", features: [featureObj] };
  }
  return featureObj;
};

const getFeatureProperties = (feature: any, layerIndex: number, featureIndex: number) => ({
  ...(feature.properties || {}),
  _layerIndex: layerIndex,
  _featureIndex: featureIndex,
});

const markerIconSvg = encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" width="96" height="128" viewBox="0 0 96 128">
  <defs>
    <radialGradient id="shadow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#000000" stop-opacity="0.36"/>
      <stop offset="100%" stop-color="#000000" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="pin" x1="24" y1="8" x2="72" y2="96" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#38bdf8"/>
      <stop offset="46%" stop-color="#0ea5e9"/>
      <stop offset="100%" stop-color="#075985"/>
    </linearGradient>
    <linearGradient id="edge" x1="18" y1="12" x2="78" y2="100" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#e0f2fe"/>
      <stop offset="100%" stop-color="#0369a1"/>
    </linearGradient>
  </defs>
  <ellipse cx="48" cy="116" rx="24" ry="8" fill="url(#shadow)"/>
  <path d="M48 6C25.9 6 8 23.9 8 46c0 30.4 40 70 40 70s40-39.6 40-70C88 23.9 70.1 6 48 6Z" fill="url(#edge)"/>
  <path d="M48 12c-18.8 0-34 15.2-34 34 0 24.3 34 59.5 34 59.5S82 70.3 82 46c0-18.8-15.2-34-34-34Z" fill="url(#pin)"/>
  <path d="M30 22c7.8-8.2 21.5-10.6 33.2-5.2C49.8 17 39 22.1 32.6 32.2c-4.7 7.5-5.7 16.4-3 24.5C21.6 46.6 21.7 30.8 30 22Z" fill="#ffffff" opacity="0.28"/>
  <circle cx="48" cy="45" r="15" fill="#f8fafc"/>
  <circle cx="48" cy="45" r="8" fill="#0284c7"/>
</svg>
`);

const MARKER_ICON_ATLAS = `data:image/svg+xml;charset=utf-8,${markerIconSvg}`;
const MARKER_ICON_MAPPING = {
  marker: {
    x: 0,
    y: 0,
    width: 96,
    height: 128,
    anchorX: 48,
    anchorY: 116,
    mask: false,
  },
};

const getPointMarkers = (normalized: any, layerIndex: number) => {
  const markers: any[] = [];

  (normalized?.features || []).forEach((feature: any, featureIndex: number) => {
    const geometry = feature.geometry;
    if (!geometry) return;

    const properties = getFeatureProperties(feature, layerIndex, featureIndex);

    if (geometry.type === "Point") {
      markers.push({
        position: geometry.coordinates,
        properties,
      });
    } else if (geometry.type === "MultiPoint") {
      geometry.coordinates.forEach((position: number[], pointIndex: number) => {
        markers.push({
          position,
          properties: { ...properties, _pointIndex: pointIndex },
        });
      });
    }
  });

  return markers;
};

export const DeckGLMap = () => {
  const {
    mapFeatures,
    baseMap,
    viewState,
    setViewState,
    interactionMode,
    setInteractionMode,
    selectedLayerIndex,
    setSelectedLayerIndex,
    setMapFeatures,
    hoverInfo,
    setHoverInfo,
    zoomTrigger
  } = useMapStore();

  const containerRef = useRef<HTMLDivElement | null>(null);
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  const [drawFeatures, setDrawFeatures] = useState<any>({
    type: "FeatureCollection",
    features: []
  });

  const handledZoomTriggerRef = useRef(zoomTrigger);

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;

    const updateSize = () => {
      const rect = node.getBoundingClientRect();
      setViewportSize({
        width: Math.max(1, Math.round(rect.width)),
        height: Math.max(1, Math.round(rect.height)),
      });
    };

    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const fitToGeoJson = (geojson: any, transitionDuration = 1000) => {
    const normalized = normalizeGeoJson(geojson);
    if (!normalized?.features?.length) return;

    const bbox = turf.bbox(normalized);
    if (bbox.some((value) => !Number.isFinite(value))) return;

    const [minLng, minLat, maxLng, maxLat] = bbox;
    const center = turf.center(normalized).geometry.coordinates;
    const width = viewportSize.width || (typeof window !== "undefined" ? window.innerWidth : 1024);
    const height = viewportSize.height || (typeof window !== "undefined" ? window.innerHeight : 768);

    if (minLng === maxLng && minLat === maxLat) {
      setViewState({
        longitude: center[0],
        latitude: center[1],
        zoom: Math.max(viewState.zoom, 13),
        transitionDuration,
        transitionInterpolator: new FlyToInterpolator(),
      });
      return;
    }

    const fitted = new WebMercatorViewport({
      width,
      height,
      longitude: viewState.longitude,
      latitude: viewState.latitude,
      zoom: viewState.zoom,
      pitch: viewState.pitch,
      bearing: viewState.bearing,
    }).fitBounds(
      [
        [minLng, minLat],
        [maxLng, maxLat],
      ],
      { padding: Math.min(100, Math.max(32, Math.floor(Math.min(width, height) * 0.12))) },
    );

    setViewState({
      longitude: fitted.longitude,
      latitude: fitted.latitude,
      zoom: Math.min(fitted.zoom, 18),
      transitionDuration,
      transitionInterpolator: new FlyToInterpolator(),
    });
  };

  const editableData = useMemo(() => {
    if (interactionMode !== "EDIT_GEOMETRY") return drawFeatures;

    const features = mapFeatures.flatMap((featureObj, layerIndex) => {
      const normalized = normalizeGeoJson(featureObj);
      return (normalized?.features || []).map((feature: any, featureIndex: number) => ({
        ...feature,
        properties: getFeatureProperties(feature, layerIndex, featureIndex),
      }));
    });

    return { type: "FeatureCollection", features };
  }, [drawFeatures, interactionMode, mapFeatures]);

  // Handle explicit zoom trigger
  useEffect(() => {
    if (zoomTrigger <= handledZoomTriggerRef.current || mapFeatures.length === 0) {
      return;
    }

    handledZoomTriggerRef.current = zoomTrigger;

    try {
      const allFeatures = mapFeatures.reduce((acc, f) => {
        let nf = f;
        if (nf?.type === "Feature") nf = { type: "FeatureCollection", features: [nf] };
        if (nf?.features) acc.push(...nf.features);
        return acc;
      }, []);

      if (allFeatures.length > 0) {
        const fc = turf.featureCollection(allFeatures);
        fitToGeoJson(fc);
      }
    } catch (e) {
      console.error("Failed to zoom to all features", e);
    }
  }, [zoomTrigger, mapFeatures]);

  // Listen for Enter/Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Enter" || e.key === "Escape") {
        if (interactionMode) {
          setInteractionMode(null);
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [interactionMode, setInteractionMode]);

  // Determine drawing mode
  const getEditMode = () => {
    switch (interactionMode) {
      case "DRAW_POINT": return DrawPointMode;
      case "DRAW_LINE": return DrawLineStringMode;
      case "DRAW_POLYGON": return DrawPolygonMode;
      case "DRAW_RECTANGLE": return DrawRectangleMode;
      case "DRAW_CIRCLE": return DrawCircleFromCenterMode;
      case "EDIT_GEOMETRY": return ModifyMode;
      default: return null;
    }
  };

  const editMode = getEditMode();

  // Create layers
  const layers = useMemo(() => {
    const renderLayers: any[] = [];

    // Base features
    mapFeatures.forEach((featureObj, layerIndex) => {
      if (!featureObj) return;

      const normalized: any = normalizeGeoJson(featureObj);
      if (!normalized) return;

      // Add indices for hover/click
      if (normalized.features) {
        normalized.features = normalized.features.map((f: any, i: number) => ({
          ...f,
          properties: getFeatureProperties(f, layerIndex, i)
        }));
      }

      const pointMarkers = getPointMarkers(normalized, layerIndex);

      const layer = new GeoJsonLayer({
        id: `geojson-layer-${layerIndex}`,
        data: normalized,
        pickable: true,
        stroked: true,
        filled: true,
        extruded: false,
        pointType: 'circle',
        lineWidthScale: 1,
        lineWidthMinPixels: 2,
        getFillColor: (d: any) => {
          const isHighlighted = hoverInfo?.props?._layerIndex === layerIndex && 
                               (hoverInfo.props._featureIndex === undefined || hoverInfo.props._featureIndex === d.properties._featureIndex);
          if (isHighlighted) return [234, 179, 8, 100]; // eab308 40%
          if (selectedLayerIndex === layerIndex) return [14, 165, 233, 90]; // sky
          
          if (interactionMode === "DELETE_GEOMETRY") return [239, 68, 68, 70]; // red
          if (interactionMode === "EDIT_GEOMETRY") return [245, 158, 11, 70]; // amber
          if (interactionMode === "SELECT_LAYER") return [34, 197, 94, 70]; // green
          
          return [59, 130, 246, 50]; // default blue
        },
        getLineColor: (d: any) => {
          const isHighlighted = hoverInfo?.props?._layerIndex === layerIndex && 
                               (hoverInfo.props._featureIndex === undefined || hoverInfo.props._featureIndex === d.properties._featureIndex);
          if (isHighlighted) return [234, 179, 8, 255]; // eab308
          if (selectedLayerIndex === layerIndex) return [14, 165, 233, 255]; // sky
          
          if (interactionMode === "DELETE_GEOMETRY") return [239, 68, 68, 255];
          if (interactionMode === "EDIT_GEOMETRY") return [245, 158, 11, 255];
          if (interactionMode === "SELECT_LAYER") return [34, 197, 94, 255];
          
          return [59, 130, 246, 255]; // default blue
        },
        getPointRadius: 6,
        getLineWidth: selectedLayerIndex === layerIndex ? 5 : 3,
        onHover: (info: any) => {
          if (info.object) {
            setHoverInfo({
              props: info.object.properties,
              x: info.x,
              y: info.y
            });
          } else {
            setHoverInfo(null);
          }
        },
        updateTriggers: {
          getFillColor: [hoverInfo?.props?._layerIndex, hoverInfo?.props?._featureIndex, interactionMode, selectedLayerIndex],
          getLineColor: [hoverInfo?.props?._layerIndex, hoverInfo?.props?._featureIndex, interactionMode, selectedLayerIndex],
          getLineWidth: [selectedLayerIndex],
        },
        onClick: (info: any) => {
          if (!info.object) return;
          
          if (interactionMode === "DELETE_GEOMETRY") {
            const lIdx = info.object.properties._layerIndex;
            const fIdx = info.object.properties._featureIndex;
            const updated = [...mapFeatures];
            const targetLayer = normalizeGeoJson(updated[lIdx]);
            if (targetLayer?.features && targetLayer.features.length > 1 && typeof fIdx === "number") {
              const nextFeatures = targetLayer.features.filter((_: any, index: number) => index !== fIdx);
              updated[lIdx] = { ...targetLayer, features: nextFeatures };
            } else {
              updated.splice(lIdx, 1);
            }
            setMapFeatures(updated);
            setSelectedLayerIndex(null);
            setHoverInfo(null);
          } else if (interactionMode === "SELECT_LAYER") {
            const lIdx = info.object.properties._layerIndex;
            const featureCollection = mapFeatures[lIdx];
            if (featureCollection) {
              setSelectedLayerIndex(lIdx);
              useChatStore.getState().addSelectedLayer(featureCollection);
            }
          }
        }
      });

      const markerLayer = pointMarkers.length > 0
        ? new IconLayer({
            id: `point-marker-layer-${layerIndex}`,
            data: pointMarkers,
            pickable: true,
            billboard: true,
            iconAtlas: MARKER_ICON_ATLAS,
            iconMapping: MARKER_ICON_MAPPING,
            getIcon: () => "marker",
            getPosition: (d: any) => d.position,
            getSize: () => selectedLayerIndex === layerIndex ? 46 : 38,
            sizeUnits: "pixels",
            sizeMinPixels: selectedLayerIndex === layerIndex ? 42 : 34,
            sizeMaxPixels: selectedLayerIndex === layerIndex ? 58 : 48,
            getPixelOffset: [0, -8],
            onHover: (info: any) => {
              if (info.object) {
                setHoverInfo({
                  props: info.object.properties,
                  x: info.x,
                  y: info.y
                });
              } else {
                setHoverInfo(null);
              }
            },
            onClick: (info: any) => {
              if (!info.object) return;

              if (interactionMode === "DELETE_GEOMETRY") {
                const lIdx = info.object.properties._layerIndex;
                const fIdx = info.object.properties._featureIndex;
                const updated = [...mapFeatures];
                const targetLayer = normalizeGeoJson(updated[lIdx]);
                if (targetLayer?.features && targetLayer.features.length > 1 && typeof fIdx === "number") {
                  const nextFeatures = targetLayer.features.filter((_: any, index: number) => index !== fIdx);
                  updated[lIdx] = { ...targetLayer, features: nextFeatures };
                } else {
                  updated.splice(lIdx, 1);
                }
                setMapFeatures(updated);
                setSelectedLayerIndex(null);
                setHoverInfo(null);
              } else if (interactionMode === "SELECT_LAYER") {
                const lIdx = info.object.properties._layerIndex;
                const featureCollection = mapFeatures[lIdx];
                if (featureCollection) {
                  setSelectedLayerIndex(lIdx);
                  useChatStore.getState().addSelectedLayer(featureCollection);
                }
              }
            },
            updateTriggers: {
              getSize: [selectedLayerIndex],
            },
          })
        : null;

      renderLayers.unshift(...(markerLayer ? [layer, markerLayer] : [layer]));
    });

    // Editable layer for drawing
    if (editMode) {
      const editableLayer = new EditableGeoJsonLayer({
        id: 'editable-layer',
        data: editableData,
        mode: editMode,
        selectedFeatureIndexes: interactionMode === "EDIT_GEOMETRY" ? editableData.features.map((_: any, i: number) => i) : [],
        onEdit: ({ updatedData, editType }: any) => {
          if (interactionMode === "EDIT_GEOMETRY") {
            if (editType === "addTentativePosition" || editType === "cancelFeature") return;

            const updatedByLayer = mapFeatures.map((featureObj) => {
              const normalized = normalizeGeoJson(featureObj);
              return normalized ? { ...normalized, features: [...normalized.features] } : featureObj;
            });

            updatedData.features.forEach((feature: any) => {
              const layerIndex = feature.properties?._layerIndex;
              const featureIndex = feature.properties?._featureIndex;
              if (typeof layerIndex !== "number" || typeof featureIndex !== "number") return;

              const nextFeature = {
                ...feature,
                properties: Object.fromEntries(
                  Object.entries(feature.properties || {}).filter(([key]) => key !== "_layerIndex" && key !== "_featureIndex"),
                ),
              };

              if (updatedByLayer[layerIndex]?.features?.[featureIndex]) {
                updatedByLayer[layerIndex].features[featureIndex] = nextFeature;
              }
            });

            setMapFeatures(updatedByLayer);
            return;
          }

          setDrawFeatures(updatedData);
          if (editType === "addFeature") {
            // Push to main features and clear draw layer
            const newFeature = updatedData.features[updatedData.features.length - 1];
            setMapFeatures([...mapFeatures, { type: "FeatureCollection", features: [newFeature] }]);
            setDrawFeatures({ type: "FeatureCollection", features: [] });
            // Keep mode active so user can draw more
          }
        },
        getFillColor: [245, 158, 11, 100],
        getLineColor: [245, 158, 11, 255],
        getLineWidth: 4,
        getRadius: 8
      });
      renderLayers.push(editableLayer);
    }

    return renderLayers;
  }, [mapFeatures, hoverInfo, interactionMode, selectedLayerIndex, editMode, editableData, setMapFeatures, setSelectedLayerIndex, setHoverInfo]);


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
  } else if (interactionMode === "SELECT_LAYER") {
    interactionOverlayClasses += "ring-4 ring-inset ring-green-500 shadow-[inset_0_0_60px_rgba(34,197,94,0.4)]";
    modeText = "Select Layer Mode Active (Press Enter to exit)";
  } else {
    interactionOverlayClasses += "opacity-0";
  }

  // Handle Maplibre view state change
  const onViewStateChange = (e: any) => setViewState(e.viewState);

  return (
    <div ref={containerRef} className="relative w-full h-full">
      <div className={interactionOverlayClasses} />
      {modeText && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 bg-background/90 backdrop-blur-md text-foreground px-4 py-2 rounded-full text-[13px] font-semibold shadow-lg border border-border/50 animate-in slide-in-from-top-4 pointer-events-none">
          {modeText}
        </div>
      )}

      <Map
        longitude={viewState.longitude}
        latitude={viewState.latitude}
        zoom={viewState.zoom}
        pitch={viewState.pitch}
        bearing={viewState.bearing}
        mapStyle={getBaseMapStyle(baseMap)}
        reuseMaps
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          zIndex: 0,
        }}
      />
      
      <DeckGL
        viewState={viewState}
        onViewStateChange={onViewStateChange}
        controller={true}
        layers={layers}
        style={{
          position: "absolute",
          inset: "0",
          zIndex: "1",
        }}
        getCursor={({ isDragging, isHovering }) => {
          if (interactionMode === "DELETE_GEOMETRY") return "crosshair";
          if (interactionMode === "EDIT_GEOMETRY") return "crosshair";
          if (interactionMode?.startsWith("DRAW_")) return "crosshair";
          if (isDragging) return "grabbing";
          if (isHovering) return "pointer";
          return "grab";
        }}
      />

      {/* Hover Tooltip */}
      {hoverInfo && hoverInfo.props && Object.keys(hoverInfo.props).length > 2 && (
        <div
          className="fixed z-50 pointer-events-none px-3 py-2 bg-background/95 backdrop-blur-sm border border-border rounded-md shadow-lg text-xs font-medium animate-in fade-in zoom-in-95 duration-100 min-w-[200px] max-w-[300px] max-h-[300px] overflow-y-auto flex flex-col gap-1 scrollbar-thin scrollbar-thumb-muted-foreground/20"
          style={{
            left: hoverInfo.x + 15,
            top: hoverInfo.y + 15,
          }}
        >
          {(() => {
            const p = hoverInfo.props || {};
            const title = p.name || p.instruction || p.title || p.Name || "Map Feature";
            const subtitle = p.full_address || p.place_formatted || p.Address || "";
            const category = p.poi_category
              ? (Array.isArray(p.poi_category) ? p.poi_category.join(", ") : p.poi_category)
              : p.feature_type;
            const distance = p.distance ? `${(p.distance / 1000).toFixed(2)} km` : null;

            const skipKeys = ['name', 'instruction', 'title', 'Name', 'full_address', 'place_formatted', 'Address', 'poi_category', 'feature_type', 'distance', 'geometry', 'id', 'mapbox_id', '_layerIndex', '_featureIndex'];
            const extraProps = Object.entries(p).filter(([k, v]) => !skipKeys.includes(k) && typeof v !== 'object' && v !== null && v !== '');

            return (
              <div className="flex flex-col gap-1.5">
                <div className="font-semibold text-[13px] leading-tight text-primary">{title}</div>
                {subtitle && <div className="text-muted-foreground text-[10px] leading-tight">{subtitle}</div>}

                {(category || distance) && (
                  <div className="flex items-center flex-wrap gap-1.5 mt-1 pt-1.5 border-t border-border/50">
                    {category && <span className="text-[9px] font-medium bg-primary/10 text-primary px-1.5 py-0.5 rounded capitalize">{category}</span>}
                    {distance && <span className="text-[9px] font-medium bg-secondary text-secondary-foreground px-1.5 py-0.5 rounded">Dist: {distance}</span>}
                  </div>
                )}

                {extraProps.length > 0 && (
                  <div className="mt-1 pt-1.5 border-t border-border/50 flex flex-col gap-1">
                    {extraProps.map(([k, v]) => (
                      <div key={k} className="flex justify-between gap-3 text-[10px]">
                        <span className="text-muted-foreground capitalize shrink-0">{k.replace(/_/g, ' ')}:</span>
                        <span className="text-foreground text-right truncate" title={String(v)}>{String(v)}</span>
                      </div>
                    ))}
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
