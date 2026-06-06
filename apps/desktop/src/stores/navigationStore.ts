import { create } from "zustand";

export type NavView = "studio" | "select" | "research" | "settings";

interface NavigationState {
  view: NavView;
  navigate: (v: NavView) => void;
}

export const useNavigationStore = create<NavigationState>((set) => ({
  view: "select",
  navigate: (view) => set({ view }),
}));
