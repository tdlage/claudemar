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
  valueRef.current = value;

  const setValue: React.Dispatch<React.SetStateAction<T>> = useCallback(
    (action) => {
      rawSetValue((prev) => {
        const next =
          typeof action === "function"
            ? (action as (prev: T) => T)(prev)
            : action;
        setCached(key, next);
        return next;
      });
    },
    [key],
  );

  useEffect(() => {
    return () => {
      setCached(key, valueRef.current);
    };
  }, [key]);

  return [value, setValue];
}
