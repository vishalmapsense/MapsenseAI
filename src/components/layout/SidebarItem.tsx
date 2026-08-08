"use client";

import React from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { useSidebarStore } from "@/stores/useSidebarStore";
import { LucideIcon, Trash2, MoreHorizontal, Share2, Pencil, Check, X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";

interface SidebarItemProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  icon: LucideIcon;
  label: string | React.ReactNode;
  rawTitle?: string;
  tooltipContent?: React.ReactNode;
  isActive?: boolean;
  onDelete?: (e: React.MouseEvent) => void;
  onRename?: (newTitle: string) => void;
  onShare?: () => void;
}

export const SidebarItem = React.forwardRef<HTMLButtonElement, SidebarItemProps>(
  ({ icon: Icon, label, rawTitle, tooltipContent, isActive, onDelete, onRename, onShare, className, ...props }, ref) => {
    const isCollapsed = useSidebarStore((state) => state.isCollapsed);
    const [showTooltip, setShowTooltip] = React.useState(false);
    const [tooltipPos, setTooltipPos] = React.useState({ top: 0, left: 0 });
    const [isMenuOpen, setIsMenuOpen] = React.useState(false);
    const [isModalOpen, setIsModalOpen] = React.useState(false);
    const [editTitle, setEditTitle] = React.useState(rawTitle || (typeof label === "string" ? label : ""));
    const itemRef = React.useRef<HTMLDivElement>(null);
    const menuRef = React.useRef<HTMLDivElement>(null);

    React.useEffect(() => {
      setEditTitle(rawTitle || (typeof label === "string" ? label : ""));
    }, [label, rawTitle]);

    React.useEffect(() => {
      const handleClickOutside = (e: MouseEvent) => {
        if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
          setIsMenuOpen(false);
        }
      };
      if (isMenuOpen) {
        document.addEventListener("mousedown", handleClickOutside);
      }
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }, [isMenuOpen]);

    const handleSaveRename = () => {
      if (editTitle.trim() && onRename) {
        onRename(editTitle.trim());
      }
      setIsModalOpen(false);
    };

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
        className="relative group w-full min-w-0"
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        <button
          ref={ref}
          className={cn(
            "flex items-center w-full rounded-lg py-2 text-xs overflow-hidden",
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
          {label === "Generating title..." && !isCollapsed ? (
            <span className="flex items-center gap-1 py-1 px-1 flex-1">
              <span className="w-1.5 h-1.5 bg-primary/70 rounded-full animate-bounce [animation-delay:-0.3s]"></span>
              <span className="w-1.5 h-1.5 bg-primary/70 rounded-full animate-bounce [animation-delay:-0.15s]"></span>
              <span className="w-1.5 h-1.5 bg-primary/70 rounded-full animate-bounce"></span>
            </span>
          ) : (
            <span
              className={cn(
                "truncate transition-all duration-[250ms] ease-[cubic-bezier(0.25,0.1,0.25,1)] flex-1 text-left text-[11px] min-w-0",
                isCollapsed
                  ? "w-0 opacity-0"
                  : "opacity-100"
              )}
            >
              {label}
            </span>
          )}

          {/* Action Menu (Three dots) */}
          {(onDelete || onRename) && !isCollapsed && (
            <div
              onClick={(e) => {
                e.stopPropagation();
                setIsMenuOpen(!isMenuOpen);
              }}
              className={cn(
                "p-1 hover:bg-sidebar-accent hover:text-foreground rounded transition-all shrink-0",
                isMenuOpen ? "opacity-100 bg-sidebar-accent text-foreground" : "opacity-0 group-hover:opacity-100 text-sidebar-foreground/70"
              )}
              title="Options"
            >
              <MoreHorizontal className="w-3.5 h-3.5" />
            </div>
          )}
        </button>

        {/* Dropdown Menu Popup */}
        {isMenuOpen && !isCollapsed && (
          <div
            ref={menuRef}
            className="absolute right-2 top-9 z-50 min-w-[130px] bg-popover/95 backdrop-blur-md border border-border/60 rounded-lg shadow-xl py-1 text-[11px] text-popover-foreground animate-in fade-in-50 zoom-in-95"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => {
                setIsMenuOpen(false);
                if (onShare) {
                  onShare();
                } else if (typeof window !== "undefined") {
                  navigator.clipboard.writeText(window.location.href);
                  toast.success("Link copied to clipboard!");
                }
              }}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 hover:bg-accent hover:text-accent-foreground text-left transition-colors"
            >
              <Share2 className="w-3.5 h-3.5 text-muted-foreground" />
              <span>Share</span>
            </button>

            {onRename && (
              <button
                onClick={() => {
                  setIsMenuOpen(false);
                  setIsModalOpen(true);
                }}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 hover:bg-accent hover:text-accent-foreground text-left transition-colors"
              >
                <Pencil className="w-3.5 h-3.5 text-muted-foreground" />
                <span>Rename</span>
              </button>
            )}

            {onDelete && (
              <button
                onClick={(e) => {
                  setIsMenuOpen(false);
                  onDelete(e);
                }}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 hover:bg-destructive/10 text-destructive text-left transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Delete</span>
              </button>
            )}
          </div>
        )}

        {/* Rename Modal Popup */}
        {isModalOpen && typeof document !== "undefined" && createPortal(
          <div 
            className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/40 backdrop-blur-[2px] p-4 animate-in fade-in-50"
            onClick={() => setIsModalOpen(false)}
          >
            <div 
              className="bg-popover border border-border/80 rounded-xl shadow-2xl w-full max-w-sm p-5 flex flex-col gap-4 text-popover-foreground"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b border-border/50 pb-2">
                <h3 className="text-sm font-semibold">Rename Chat</h3>
                <button 
                  onClick={() => setIsModalOpen(false)} 
                  className="text-muted-foreground hover:text-foreground p-1 rounded hover:bg-accent"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              
              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] text-muted-foreground font-medium">New Title</label>
                <input
                  type="text"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleSaveRename();
                    if (e.key === "Escape") setIsModalOpen(false);
                  }}
                  autoFocus
                  className="w-full bg-background border border-border text-foreground px-3 py-2 rounded-lg text-xs outline-none focus:ring-2 focus:ring-primary/50 transition-all"
                  placeholder="Enter chat title..."
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  onClick={() => setIsModalOpen(false)}
                  className="px-3.5 py-1.5 text-xs text-muted-foreground hover:bg-accent rounded-md transition-colors font-medium"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveRename}
                  className="px-3.5 py-1.5 text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 rounded-md transition-colors shadow-sm"
                >
                  Save
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}

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
