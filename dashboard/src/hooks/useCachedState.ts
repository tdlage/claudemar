import { useState, useEffect, useRef, useCallback } from "react";
import { getCached, setCached } from "../lib/stateCache.js";

export function useCachedState<T>(
  key: string,
  defaultValue: T,
): [T, React.Dispatch<React.SetStateAction<T>>] {
  const [value, rawSetValue] = useState<T>(() => {
    const cached = getCached<T>(key);
    return cached !== undefined ? cached : defaultValue;
  });

  const valueRef = useRef(value);
  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  const setValue: React.Dispatch<React.SetStateAction<T>> = useCallback(
    (action) => {
      const cached = getCached<T>(key);
      const prev = cached !== undefined ? cached : valueRef.current;
      const next =
        typeof action === "function"
          ? (action as (prev: T) => T)(prev)
          : action;
      setCached(key, next);
      rawSetValue(next);
    },
    [key],
  );

  useEffect(() => {
    return () => {
      if (getCached<T>(key) === undefined) setCached(key, valueRef.current);
    };
  }, [key]);

  return [value, setValue];
}
