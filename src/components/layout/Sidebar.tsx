"use client";

import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { MessageSquarePlus, Settings, HelpCircle, PanelLeftClose, PanelLeft, MessageSquare, X, LogIn, LogOut, User, Trash2 } from "lucide-react";
import { useSidebarStore } from "@/stores/useSidebarStore";
import { useAuthStore } from "@/stores/useAuthStore";
import { SidebarItem } from "./SidebarItem";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { SettingsModal } from "@/components/settings/SettingsModal";
import { useChatStore } from "@/stores/useChatStore";
import { toast } from "sonner";
export const Sidebar = () => {
  const { isCollapsed, toggleCollapse, isMobileOpen, setMobileOpen } = useSidebarStore();
  const { setChatOpen, sessions, activeSessionId, setActiveSession, createNewSession, fetchSessions, loadSessionHistory, deleteSession, deleteAllSessions, renameSession } = useChatStore();
  const { user, signInWithGoogle, signOut, isLoading: authLoading } = useAuthStore();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [isDeleteAllModalOpen, setIsDeleteAllModalOpen] = useState(false);

  // Prevent hydration mismatch on initial render with persistent state
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
    fetchSessions();
  }, [fetchSessions]);

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
          onClick={() => {
            createNewSession();
            setMobileOpen(false);
          }}
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
                      {sessions.length === 0 && (
                        <div className="text-[10px] text-muted-foreground/70 px-2 italic">No chats yet</div>
                      )}
                      {sessions.map((item) => (
                        <div
                          key={item.id}
                          onClick={() => loadSessionHistory(item.id)}
                          className={cn(
                            "text-xs px-2 py-1 hover:bg-sidebar-accent/50 hover:text-foreground rounded-md cursor-pointer truncate transition-colors",
                            item.id === activeSessionId && "bg-sidebar-accent/50 text-foreground font-medium"
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

              <div className="flex flex-col gap-0.5 pb-4 w-full min-w-0">
                {sessions.length === 0 && (
                  <div className="text-xs text-muted-foreground/70 px-4 py-2 italic">No chats yet</div>
                )}
                {sessions.map((item) => (
                  <SidebarItem
                    key={item.id}
                    icon={MessageSquare}
                    label={item.title}
                    isActive={item.id === activeSessionId}
                    onDelete={() => deleteSession(item.id)}
                    onRename={(newTitle) => renameSession(item.id, newTitle)}
                    onShare={() => {
                      if (user) {
                        const userId = user.email || user.id;
                        const shareId = btoa(`${userId}|${item.id}`);
                        const shareUrl = `${window.location.origin}/?shareId=${shareId}`;
                        navigator.clipboard.writeText(shareUrl);
                        toast.success("Public share link copied to clipboard!");
                      } else {
                        useAuthStore.getState().setAuthModalOpen(true);
                      }
                    }}
                    onClick={() => {
                      loadSessionHistory(item.id);
                      setChatOpen(true);
                      setMobileOpen(false);
                    }}
                  />
                ))}
                
                {sessions.length > 0 && (
                  <div className="px-3 pt-4 pb-2 w-full">
                    <button 
                      onClick={() => {
                        if (!user) {
                          useAuthStore.getState().setAuthModalOpen(true);
                        } else {
                          setIsDeleteAllModalOpen(true);
                        }
                      }}
                      className="w-full text-xs flex items-center justify-center gap-2 py-1.5 text-destructive/80 hover:text-destructive hover:bg-destructive/10 rounded-md transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Clear All Chats
                    </button>
                  </div>
                )}
              </div>
            </ScrollArea>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="mt-auto border-t border-sidebar-border/50 p-3 flex flex-col gap-1">
        {authLoading ? (
          <div className="text-xs text-muted-foreground italic px-2">Loading auth...</div>
        ) : user ? (
          <>
            <div 
              onClick={() => setSettingsOpen(true)}
              className="px-2 py-2 flex items-center gap-2 overflow-hidden hover:bg-sidebar-accent/50 rounded-md cursor-pointer transition-colors"
            >
              <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center text-primary font-medium text-xs flex-shrink-0 overflow-hidden">
                {user.user_metadata?.avatar_url ? (
                  <img src={user.user_metadata.avatar_url} alt="Profile" className="w-full h-full object-cover" />
                ) : (
                  (user.user_metadata?.full_name || user.email || 'U').charAt(0).toUpperCase()
                )}
              </div>
              {!isCollapsed && (
                <div className="flex flex-col truncate flex-1">
                  <span className="text-sm font-medium text-sidebar-foreground truncate">
                    {user.user_metadata?.full_name || 'User'}
                  </span>
                </div>
              )}
            </div>
          </>
        ) : (
          <SidebarItem icon={LogIn} label="Sign In with Google" onClick={signInWithGoogle} />
        )}
      </div>
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

      {/* Delete All Chats Confirmation Modal */}
      {isDeleteAllModalOpen && typeof document !== "undefined" && createPortal(
        <div 
          className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/40 backdrop-blur-[2px] p-4 animate-in fade-in-50"
          onClick={() => setIsDeleteAllModalOpen(false)}
        >
          <div 
            className="bg-popover border border-border/80 rounded-xl shadow-2xl w-full max-w-sm p-5 flex flex-col gap-4 text-popover-foreground"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-border/50 pb-2">
              <h3 className="text-sm font-semibold text-destructive flex items-center gap-2">
                <Trash2 className="w-4 h-4" />
                Clear All Chats
              </h3>
              <button 
                onClick={() => setIsDeleteAllModalOpen(false)} 
                className="text-muted-foreground hover:text-foreground p-1 rounded hover:bg-accent"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            
            <p className="text-xs text-muted-foreground leading-relaxed">
              Are you sure you want to delete all chat conversations? This action cannot be undone and will permanently erase your chat history.
            </p>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => setIsDeleteAllModalOpen(false)}
                className="px-3.5 py-1.5 text-xs text-muted-foreground hover:bg-accent rounded-md transition-colors font-medium"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  setIsDeleteAllModalOpen(false);
                  deleteAllSessions();
                }}
                className="px-3.5 py-1.5 text-xs font-medium bg-destructive text-destructive-foreground hover:bg-destructive/90 rounded-md transition-colors shadow-sm"
              >
                Delete All
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
};
