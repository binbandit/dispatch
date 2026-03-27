import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

import { ipc } from "./ipc";
import { type KeybindingOverrides, type Modifier, resolveBinding } from "./keybinding-registry";

const STORAGE_KEY = "dispatch-keybindings";
const PREF_KEY = "keybindings";

interface KeybindingContextValue {
  /** Get resolved key + modifiers for a shortcut ID. */
  getBinding: (id: string) => { key: string; modifiers?: Modifier[] };
  /** Set a custom binding for a shortcut ID. */
  setBinding: (id: string, key: string, modifiers?: Modifier[]) => void;
  /** Reset a single shortcut to its default. */
  resetBinding: (id: string) => void;
  /** Reset all shortcuts to defaults. */
  resetAll: () => void;
  /** Raw overrides — for checking what's been customized. */
  overrides: KeybindingOverrides;
}

const KeybindingContext = createContext<KeybindingContextValue>({
  getBinding: (id) => resolveBinding(id, {}),
  setBinding: () => {},
  resetBinding: () => {},
  resetAll: () => {},
  overrides: {},
});

function loadFromStorage(): KeybindingOverrides {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as KeybindingOverrides) : {};
  } catch {
    return {};
  }
}

function persist(overrides: KeybindingOverrides) {
  const json = JSON.stringify(overrides);
  localStorage.setItem(STORAGE_KEY, json);
  ipc("preferences.set", { key: PREF_KEY, value: json });
}

export function KeybindingProvider({ children }: { children: ReactNode }) {
  const [overrides, setOverrides] = useState<KeybindingOverrides>(loadFromStorage);

  // Load authoritative value from SQLite on mount
  useEffect(() => {
    ipc("preferences.get", { key: PREF_KEY }).then((value) => {
      if (!value) {
        return;
      }
      try {
        const parsed = JSON.parse(value) as KeybindingOverrides;
        setOverrides(parsed);
        localStorage.setItem(STORAGE_KEY, value);
      } catch {
        // Invalid JSON in DB — ignore
      }
    });
  }, []);

  const getBinding = useCallback((id: string) => resolveBinding(id, overrides), [overrides]);

  const setBinding = useCallback((id: string, key: string, modifiers?: Modifier[]) => {
    setOverrides((prev) => {
      const next = { ...prev, [id]: { key, modifiers } };
      persist(next);
      return next;
    });
  }, []);

  const resetBinding = useCallback((id: string) => {
    setOverrides((prev) => {
      const next = { ...prev };
      delete next[id];
      persist(next);
      return next;
    });
  }, []);

  const resetAll = useCallback(() => {
    const empty: KeybindingOverrides = {};
    setOverrides(empty);
    persist(empty);
  }, []);

  return (
    <KeybindingContext.Provider
      value={{ getBinding, setBinding, resetBinding, resetAll, overrides }}
    >
      {children}
    </KeybindingContext.Provider>
  );
}

export function useKeybindings() {
  return useContext(KeybindingContext);
}
