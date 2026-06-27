"use client";

import React from "react";
import { Sidebar } from "./Sidebar";
import { MapWorkspace } from "@/components/map/MapWorkspace";

export const MainLayout = () => {
  return (
    <div className="flex h-screen w-full overflow-hidden bg-background">
      <Sidebar />
      <MapWorkspace />
    </div>
  );
};
