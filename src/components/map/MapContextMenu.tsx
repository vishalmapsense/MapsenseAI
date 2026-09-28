"use client";

import React, { useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Database, Copy, Ruler } from "lucide-react";
import { toast } from "sonner";

interface MapContextMenuProps {
  isOpen: boolean;
  x: number;
  y: number;
  lng: number;
  lat: number;
  onClose: () => void;
  onSqlQuery: () => void;
}

export const MapContextMenu = ({
  isOpen,
  x,
  y,
  lng,
  lat,
  onClose,
  onSqlQuery,
}: MapContextMenuProps) => {
  const menuRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    // Delay listener to avoid immediate close from the same right-click
    const timer = setTimeout(() => {
      document.addEventListener("mousedown", handleClick);
      document.addEventListener("keydown", handleEsc);
    }, 10);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleEsc);
    };
  }, [isOpen, onClose]);

  // Clamp position to viewport
  const clampedX = Math.min(x, (typeof window !== "undefined" ? window.innerWidth : 1024) - 200);
  const clampedY = Math.min(y, (typeof window !== "undefined" ? window.innerHeight : 768) - 180);

  const handleCopyCoords = () => {
    const coordStr = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
    navigator.clipboard.writeText(coordStr);
    toast.success(`Copied: ${coordStr}`);
    onClose();
  };

  const handleSqlQuery = () => {
    onSqlQuery();
    onClose();
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          ref={menuRef}
          initial={{ opacity: 0, scale: 0.88, y: -4 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.92, y: -2 }}
          transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
          className="fixed z-[200]"
          style={{ left: clampedX, top: clampedY }}
        >
          <div className="w-[200px] bg-background/95 backdrop-blur-xl border border-border/60 rounded-xl shadow-2xl shadow-black/20 overflow-hidden">
            {/* Accent line */}
            <div className="h-[2px] bg-gradient-to-r from-cyan-500 via-blue-500 to-violet-500" />

            {/* Coordinate header */}
            <div className="px-3 py-2 border-b border-border/40">
              <div className="text-[10px] text-muted-foreground font-mono tracking-tight">
                {lat.toFixed(5)}, {lng.toFixed(5)}
              </div>
            </div>

            {/* Menu items */}
            <div className="p-1 flex flex-col gap-0.5">
              <button
                onClick={handleSqlQuery}
                className="group flex items-center gap-2.5 w-full text-left px-3 py-2 text-[13px] font-medium rounded-lg hover:bg-primary/10 text-foreground transition-all duration-150"
              >
                <div className="flex items-center justify-center w-6 h-6 rounded-md bg-gradient-to-br from-cyan-500/20 to-blue-500/20 group-hover:from-cyan-500/30 group-hover:to-blue-500/30 transition-colors">
                  <Database className="w-3.5 h-3.5 text-cyan-500" />
                </div>
                SQL Query
              </button>

              <button
                onClick={handleCopyCoords}
                className="group flex items-center gap-2.5 w-full text-left px-3 py-2 text-[13px] font-medium rounded-lg hover:bg-muted/50 text-foreground transition-all duration-150"
              >
                <div className="flex items-center justify-center w-6 h-6 rounded-md bg-muted/50 group-hover:bg-muted transition-colors">
                  <Copy className="w-3.5 h-3.5 text-muted-foreground" />
                </div>
                Copy Coordinates
              </button>

              <button
                disabled
                className="group flex items-center gap-2.5 w-full text-left px-3 py-2 text-[13px] font-medium rounded-lg text-muted-foreground/50 cursor-not-allowed"
              >
                <div className="flex items-center justify-center w-6 h-6 rounded-md bg-muted/30">
                  <Ruler className="w-3.5 h-3.5" />
                </div>
                Measure
                <span className="ml-auto text-[9px] bg-muted/50 px-1.5 py-0.5 rounded-full font-normal">Soon</span>
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
