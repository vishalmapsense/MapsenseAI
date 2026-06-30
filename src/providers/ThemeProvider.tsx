"use client";

import * as React from "react";
import { ThemeProvider as NextThemesProvider, useTheme } from "next-themes";
import { useMapStore } from "@/stores/useMapStore";

type ThemeProviderProps = React.ComponentProps<typeof NextThemesProvider>;

/**
 * Handles syncing the app theme with the map base.
 */
function MapThemeSync() {
  const { resolvedTheme, setTheme } = useTheme();
  const baseMap = useMapStore((state) => state.baseMap);
  const setBaseMap = useMapStore((state) => state.setBaseMap);
  
  const [mounted, setMounted] = React.useState(false);

  const lastTheme = React.useRef<string | undefined>(undefined);
  const lastBaseMap = React.useRef<string | undefined>(undefined);

  React.useEffect(() => {
    setMounted(true);
  }, []);

  React.useEffect(() => {
    if (!mounted || !resolvedTheme) return;

    // Handle initial sync on mount (Theme wins)
    if (lastTheme.current === undefined) {
      if (resolvedTheme === "dark" && baseMap !== "carto-dark") {
        setBaseMap("carto-dark");
        lastBaseMap.current = "carto-dark";
      } else if (resolvedTheme !== "dark" && baseMap === "carto-dark") {
        setBaseMap("osm");
        lastBaseMap.current = "osm";
      } else {
        lastBaseMap.current = baseMap;
      }
      lastTheme.current = resolvedTheme;
      return;
    }

    // Handle subsequent changes
    if (lastTheme.current !== resolvedTheme) {
      // Theme was changed
      if (resolvedTheme === "dark" && baseMap !== "carto-dark") {
        setBaseMap("carto-dark");
        lastBaseMap.current = "carto-dark";
      } else if (resolvedTheme !== "dark" && baseMap === "carto-dark") {
        setBaseMap("osm");
        lastBaseMap.current = "osm";
      }
      lastTheme.current = resolvedTheme;
    } else if (lastBaseMap.current !== baseMap) {
      // Base map was changed
      if (baseMap === "carto-dark" && resolvedTheme !== "dark") {
        setTheme("dark");
        lastTheme.current = "dark";
      } else if (baseMap !== "carto-dark" && resolvedTheme === "dark") {
        setTheme("light");
        lastTheme.current = "light";
      }
      lastBaseMap.current = baseMap;
    }
  }, [resolvedTheme, baseMap, mounted, setBaseMap, setTheme]);

  return null;
}

// Suppress React 19 script tag warning caused by next-themes
if (typeof window !== "undefined") {
  const originalError = console.error;
  console.error = (...args: any[]) => {
    if (typeof args[0] === "string" && args[0].includes("Encountered a script tag while rendering React component")) {
      return;
    }
    originalError(...args);
  };
}

export function ThemeProvider({ children, ...props }: ThemeProviderProps) {
  return (
    <NextThemesProvider {...props}>
      {children}
      <MapThemeSync />
    </NextThemesProvider>
  );
}
