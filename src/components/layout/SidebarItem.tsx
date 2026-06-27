"use client";

import React from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { useSidebarStore } from "@/stores/useSidebarStore";
import { LucideIcon } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

interface SidebarItemProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  icon: LucideIcon;
  label: string;
  tooltipContent?: React.ReactNode;
  isActive?: boolean;
}

export const SidebarItem = React.forwardRef<HTMLButtonElement, SidebarItemProps>(
  ({ icon: Icon, label, tooltipContent, isActive, className, ...props }, ref) => {
    const isCollapsed = useSidebarStore((state) => state.isCollapsed);
    const [showTooltip, setShowTooltip] = React.useState(false);
    const [tooltipPos, setTooltipPos] = React.useState({ top: 0, left: 0 });
    const itemRef = React.useRef<HTMLDivElement>(null);

    const handleMouseEnter = () => {
      if (!isCollapsed) return;
      if (itemRef.current) {
        const rect = itemRef.current.getBoundingClientRect();
        setTooltipPos({
          top: rect.top + rect.height / 2,
          left: rect.right + 12,
        });
      }
      setShowTooltip(true);
    };

    const handleMouseLeave = () => {
      setShowTooltip(false);
    };

    return (
      <div
        ref={itemRef}
        className="relative"
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        <button
          ref={ref}
          className={cn(
            "flex items-center w-full rounded-lg py-2 text-xs",
            "transition-all duration-[250ms] ease-[cubic-bezier(0.25,0.1,0.25,1)]",
            "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground text-sidebar-foreground/70",
            isActive && "bg-sidebar-accent text-sidebar-accent-foreground font-medium",
            isCollapsed ? "justify-start px-3 gap-0" : "justify-start px-3 gap-2.5",
            className
          )}
          {...props}
        >
          <Icon
            className={cn(
              "shrink-0 transition-all duration-[250ms] ease-[cubic-bezier(0.25,0.1,0.25,1)]",
              isCollapsed ? "h-[18px] w-[18px]" : "h-4 w-4"
            )}
          />
          {/* Text disappears via CSS only — opacity + width transition synced with sidebar collapse */}
          <span
            className={cn(
              "whitespace-nowrap overflow-hidden transition-all duration-[250ms] ease-[cubic-bezier(0.25,0.1,0.25,1)]",
              isCollapsed
                ? "w-0 opacity-0"
                : "w-auto opacity-100"
            )}
          >
            {label}
          </span>
        </button>

        {/* Tooltip via Portal */}
        {typeof document !== "undefined" &&
          createPortal(
            <AnimatePresence>
              {isCollapsed && showTooltip && (
                <motion.div
                  initial={{ opacity: 0, x: -4, scale: 0.95 }}
                  animate={{ opacity: 1, x: 0, scale: 1 }}
                  exit={{ opacity: 0, x: -4, scale: 0.95 }}
                  transition={{ duration: 0.12, ease: "easeOut" }}
                  style={{
                    position: "fixed",
                    top: tooltipPos.top,
                    left: tooltipPos.left,
                    transform: "translateY(-50%)",
                  }}
                  className="z-[9999] pointer-events-none"
                >
                  {/* Arrow */}
                  <div className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-[5px] w-2.5 h-2.5 rotate-45 bg-white dark:bg-zinc-800 border-l border-b border-border/50 rounded-[2px]" />
                  {/* Bubble */}
                  <div className={cn(
                    "relative bg-white dark:bg-zinc-800 text-foreground text-[13px] font-medium px-3 py-1.5 rounded-lg shadow-lg border border-border/50",
                    !tooltipContent && "whitespace-nowrap"
                  )}>
                    {tooltipContent || label}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>,
            document.body
          )}
      </div>
    );
  }
);

SidebarItem.displayName = "SidebarItem";
