"use client";

import React, { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { MessageSquarePlus, Settings, HelpCircle, PanelLeftClose, PanelLeft, MessageSquare, X } from "lucide-react";
import { useSidebarStore } from "@/stores/useSidebarStore";
import { SidebarItem } from "./SidebarItem";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { SettingsModal } from "@/components/settings/SettingsModal";

const MOCK_HISTORY = [
  { id: "1", title: "Site Suitability Analysis", date: "Today" },
  { id: "2", title: "New York Zoning Buffers", date: "Yesterday" },
  { id: "3", title: "Population Density 2024", date: "Previous 7 Days" },
];

export const Sidebar = () => {
  const { isCollapsed, toggleCollapse, isMobileOpen, setMobileOpen } = useSidebarStore();
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Prevent hydration mismatch on initial render with persistent state
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;

  // Sidebar content (shared between desktop and mobile)
  const sidebarContent = (
    <>
      {/* Upper Fixed Section */}
      <div className="flex items-start flex-col gap-1 p-3 pb-4">
        {/* Mobile Header with Close Button */}
        <div className="flex items-center justify-between md:hidden mb-4 px-2">
          <span className="font-semibold">Menu</span>
          <button onClick={() => setMobileOpen(false)} className="p-1 rounded-md hover:bg-sidebar-accent">
            <X className="w-5 h-5" />
          </button>
        </div>

        <SidebarItem
          icon={PanelLeft}
          label={isCollapsed ? "Expand" : "Collapse"}
          onClick={toggleCollapse}
          className="hidden md:flex text-muted-foreground hover:text-foreground"
        />

        <SidebarItem
          icon={MessageSquarePlus}
          label="New Chat"
          className="mt-3"
        />
        <SidebarItem icon={Settings} label="Settings" onClick={() => setSettingsOpen(true)} />
        <SidebarItem icon={HelpCircle} label="Help & Feedback" />

        <AnimatePresence initial={false}>
          {isCollapsed && (
            <motion.div
              key="recent-icon"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.25, ease: [0.25, 0.1, 0.25, 1] }}
              className="w-full overflow-hidden"
            >
              <div className="pt-1 mt-1 border-t border-sidebar-border/50">
                <SidebarItem
                  icon={MessageSquare}
                  label="Recent Chats"
                  tooltipContent={
                    <div className="flex flex-col gap-1 min-w-[180px] py-1 pointer-events-auto">
                      <div className="text-[9px] text-muted-foreground uppercase tracking-wider mb-1 font-semibold px-2">
                        Recent Conversations
                      </div>
                      {MOCK_HISTORY.map((item) => (
                        <div
                          key={item.id}
                          className={cn(
                            "text-xs px-2 py-1 hover:bg-sidebar-accent/50 hover:text-foreground rounded-md cursor-default truncate transition-colors",
                            item.id === "1" && "bg-sidebar-accent/50 text-foreground font-medium"
                          )}
                        >
                          {item.title}
                        </div>
                      ))}
                    </div>
                  }
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Scrollable History Section */}
      <AnimatePresence initial={false}>
        {!isCollapsed && (
          <motion.div
            key="history-area"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.1, ease: [0.25, 0.1, 0.25, 1] }}
            className="flex-1 overflow-hidden flex flex-col min-h-0 w-full"
          >
            <ScrollArea className="flex-1 px-3">
              <div className="px-2 mb-2 mt-2 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                Recent Conversations
              </div>

              <div className="flex items-start flex-col gap-0.5 pb-4 w-full">
                {MOCK_HISTORY.map((item) => (
                  <SidebarItem
                    key={item.id}
                    icon={MessageSquare}
                    label={item.title}
                    isActive={item.id === "1"}
                  />
                ))}
              </div>
            </ScrollArea>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );

  return (
    <>
      {/* Mobile Backdrop */}
      <AnimatePresence>
        {isMobileOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={() => setMobileOpen(false)}
            className="fixed inset-0 z-40 bg-black/40 md:hidden backdrop-blur-sm"
          />
        )}
      </AnimatePresence>

      {/* Desktop & Mobile Sidebar Container */}
      <motion.aside
        initial={false}
        animate={{
          width: isMobileOpen ? 260 : (isCollapsed ? 64 : 260),
          x: isMobileOpen ? 0 : (typeof window !== 'undefined' && window.innerWidth < 768 ? -260 : 0),
        }}
        transition={{ duration: 0.25, ease: [0.25, 0.1, 0.25, 1] }}
        className={`fixed md:relative z-50 flex flex-col h-full bg-sidebar border-r border-sidebar-border overflow-hidden
          ${!isMobileOpen && 'max-md:hidden'} md:flex`}
      >
        {sidebarContent}
      </motion.aside>

      {/* Settings Modal */}
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </>
  );
};

