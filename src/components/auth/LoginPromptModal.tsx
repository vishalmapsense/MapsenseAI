"use client";

import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, LogIn, Map } from "lucide-react";
import { useAuthStore } from "@/stores/useAuthStore";

export function LoginPromptModal() {
  const { isAuthModalOpen, setAuthModalOpen, signInWithGoogle } = useAuthStore();

  return (
    <AnimatePresence>
      {isAuthModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setAuthModalOpen(false)}
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            className="relative w-full max-w-sm bg-background border border-border/50 rounded-2xl shadow-xl overflow-hidden"
          >
            <div className="flex flex-col items-center justify-center p-6 text-center">
              <div className="w-12 h-12 bg-blue-100 dark:bg-blue-900/30 rounded-xl flex items-center justify-center mb-4 text-blue-600 dark:text-blue-400">
                <Map className="w-6 h-6" />
              </div>
              <h2 className="text-xl font-semibold mb-2 text-foreground">
                Login Required
              </h2>
              <p className="text-sm text-muted-foreground mb-6">
                You need to log in to create chats, send messages, and manage your history.
              </p>
              
              <button
                onClick={() => {
                  signInWithGoogle();
                }}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors shadow-sm"
              >
                <LogIn className="w-4 h-4" />
                Sign In with Google
              </button>
              
              <button
                onClick={() => setAuthModalOpen(false)}
                className="mt-3 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                Cancel
              </button>
            </div>
            
            <button
              onClick={() => setAuthModalOpen(false)}
              className="absolute top-4 right-4 p-1 rounded-full text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
