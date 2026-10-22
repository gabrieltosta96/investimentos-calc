import { useEffect, useState } from "react";

// useState backed by localStorage. Saved objects are merged over `initial`, so new fields get defaults.
export const usePersistedState = <T,>(key: string, initial: T) => {
  const [value, setValue] = useState<T>(() => {
    try {
      const saved = localStorage.getItem(key);
      if (saved == null) return initial;
      const parsed = JSON.parse(saved);
      return Array.isArray(initial) ? (Array.isArray(parsed) ? parsed : initial) : { ...initial, ...parsed };
    } catch {
      return initial; // corrupted JSON or storage blocked
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // private mode / quota: keep working without saving
    }
  }, [key, value]);

  return [value, setValue] as const;
};
