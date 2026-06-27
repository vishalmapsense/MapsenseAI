"use client";

import React, { useEffect, useRef } from "react";
import "ol/ol.css";
import Map from "ol/Map";
import View from "ol/View";
import TileLayer from "ol/layer/Tile";
import OSM from "ol/source/OSM";

export const OpenLayersMap = () => {
  const mapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!mapRef.current) return;

    const map = new Map({
      target: mapRef.current,
      layers: [
        new TileLayer({
          source: new OSM(),
        }),
      ],
      view: new View({
        center: [0, 0], // Center at [0, 0] (EPSG:3857)
        zoom: 2,
      }),
      controls: [], // Hide default controls for a clean UI
    });

    return () => {
      map.setTarget(undefined);
    };
  }, []);

  return <div ref={mapRef} className="w-full h-full bg-[#f8f9fa] dark:bg-[#0a0a0a]" />;
};
