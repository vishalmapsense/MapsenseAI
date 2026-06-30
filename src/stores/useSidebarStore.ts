import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type AppLayout = "floating" | "split";

interface SidebarState {
  isCollapsed: boolean;
  isMobileOpen: boolean; // For mobile responsive drawer
  layout: AppLayout;
  toggleCollapse: () => void;
  setCollapsed: (collapsed: boolean) => void;
  toggleMobileOpen: () => void;
  setMobileOpen: (open: boolean) => void;
  setLayout: (layout: AppLayout) => void;
}

export const useSidebarStore = create<SidebarState>()(
  persist(
    (set) => ({
      isCollapsed: false,
      isMobileOpen: false,
      layout: "floating",
      toggleCollapse: () => set((state) => ({ isCollapsed: !state.isCollapsed })),
      setCollapsed: (collapsed) => set({ isCollapsed: collapsed }),
      toggleMobileOpen: () => set((state) => ({ isMobileOpen: !state.isMobileOpen })),
      setMobileOpen: (open) => set({ isMobileOpen: open }),
      setLayout: (layout) => set({ layout }),
    }),
    {
      name: 'sidebar-storage',
      // Persist isCollapsed and layout
      partialize: (state) => ({ isCollapsed: state.isCollapsed, layout: state.layout }),
    }
  )
);
