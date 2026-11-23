import { create } from "zustand";
import { User } from "@supabase/supabase-js";
import { createClient } from "@/utils/supabase/client";

interface AuthState {
  user: User | null;
  isLoading: boolean;
  isAuthModalOpen: boolean;
  setUser: (user: User | null) => void;
  setLoading: (loading: boolean) => void;
  setAuthModalOpen: (isOpen: boolean) => void;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  initAuth: () => () => void;
}

export const useAuthStore = create<AuthState>((set, get) => {
  const supabase = createClient();

  return {
    user: null,
    isLoading: true,
    isAuthModalOpen: false,
    setUser: (user) => set({ user }),
    setLoading: (isLoading) => set({ isLoading }),
    setAuthModalOpen: (isAuthModalOpen) => set({ isAuthModalOpen }),
    
    signInWithGoogle: async () => {
      const origin =
        typeof window !== "undefined" && window.location.origin
          ? window.location.origin
          : (process.env.NEXT_PUBLIC_SITE_URL || "https://main.d2df50755xi4a7.amplifyapp.com");

      await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${origin}/api/auth/callback`,
        },
      });
    },

    signOut: async () => {
      await supabase.auth.signOut();
      set({ user: null });
      window.location.reload();
    },

    initAuth: () => {
      // Get initial session
      supabase.auth.getSession().then(({ data: { session } }) => {
        set({ user: session?.user ?? null, isLoading: false });
      });

      // Listen for auth changes
      const { data: { subscription } } = supabase.auth.onAuthStateChange(
        (_event, session) => {
          set({ user: session?.user ?? null, isLoading: false });
        }
      );

      return () => {
        subscription.unsubscribe();
      };
    },
  };
});
