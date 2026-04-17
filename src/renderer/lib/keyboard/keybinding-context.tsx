import { ipc } from "@/renderer/lib/app/ipc";
import {
  type KeybindingOverrides,
  type Modifier,
  resolveBinding,
} from "@/renderer/lib/keyboard/keybinding-registry";
import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";

const STORAGE_KEY = "dispatch-keybindings";
const PREF_KEY = "keybindings";

function loadFromStorage(): KeybindingOverrides {
  try {
    if (typeof localStorage === "undefined") {
      return {};
    }
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as KeybindingOverrides) : {};
  } catch {
    return {};
  }
}

function persist(overrides: KeybindingOverrides) {
  if (typeof localStorage === "undefined") {
    return;
  }
  const json = JSON.stringify(overrides);
  localStorage.setItem(STORAGE_KEY, json);
  ipc("preferences.set", { key: PREF_KEY, value: json });
}

interface KeybindingState {
  overrides: KeybindingOverrides;
  getBinding: (id: string) => { key: string; modifiers?: Modifier[] };
  setBinding: (id: string, key: string, modifiers?: Modifier[]) => void;
  resetBinding: (id: string) => void;
  resetAll: () => void;
}

export const useKeybindingStore = create<KeybindingState>()((set, get) => ({
  overrides: loadFromStorage(),

  getBinding: (id) => resolveBinding(id, get().overrides),

  setBinding: (id, key, modifiers) => {
    const next = { ...get().overrides, [id]: { key, modifiers } };
    set({ overrides: next });
    persist(next);
  },

  resetBinding: (id) => {
    const next = { ...get().overrides };
    delete next[id];
    set({ overrides: next });
    persist(next);
  },

  resetAll: () => {
    const empty: KeybindingOverrides = {};
    set({ overrides: empty });
    persist(empty);
  },
}));

// Load authoritative value from SQLite on app start
if ((globalThis as Record<string, unknown>).api !== undefined) {
  const initResult = ipc("preferences.get", { key: PREF_KEY });
  if (initResult && typeof initResult.then === "function") {
    initResult
      .then((value) => {
        if (!value) {
          return;
        }
        try {
          const parsed = JSON.parse(value) as KeybindingOverrides;
          useKeybindingStore.setState({ overrides: parsed });
          if (typeof localStorage !== "undefined") {
            localStorage.setItem(STORAGE_KEY, value);
          }
        } catch {
          // Invalid JSON in DB — ignore
        }
      })
      .catch(() => {});
  }
}

export function useKeybindings() {
  return useKeybindingStore(useShallow((s) => s));
}
