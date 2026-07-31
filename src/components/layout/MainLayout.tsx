"use client";

import React, { useEffect } from "react";
import { Sidebar } from "./Sidebar";
import { MapWorkspace } from "@/components/map/MapWorkspace";
import { useAuthStore } from "@/stores/useAuthStore";
import { useChatStore } from "@/stores/useChatStore";
import { LoginPromptModal } from "@/components/auth/LoginPromptModal";

export const MainLayout = () => {
  const initAuth = useAuthStore((state) => state.initAuth);
  const loadSharedSession = useChatStore((state) => state.loadSharedSession);

  useEffect(() => {
    const unsubscribe = initAuth();
    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, [initAuth]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const urlParams = new URLSearchParams(window.location.search);
      const shareId = urlParams.get("shareId");
      if (shareId) {
        loadSharedSession(shareId);
      }
    }
  }, [loadSharedSession]);

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background">
      <Sidebar />
      <MapWorkspace />
      <LoginPromptModal />
    </div>
  );
};
