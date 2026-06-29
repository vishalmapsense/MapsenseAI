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
import { useMapStore } from "@/stores/useMapStore";

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

  const mapFeatures = useMapStore((state) => state.mapFeatures);
  const baseMap = useMapStore((state) => state.baseMap);

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

    // Hover logic
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
      
      // change cursor
      map.getTargetElement().style.cursor = hit ? "pointer" : "";
    });

    return () => {
      map.setTarget(undefined);
      mapInstanceRef.current = null;
    };
  }, []);

  // Watch for new features from LLM
  useEffect(() => {
    if (!mapInstanceRef.current) return;

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

    // Fit map to show all features
    if (source.getFeatures().length > 0) {
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

  return (
    <div className="relative w-full h-full">
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
