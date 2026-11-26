import { useEffect, useState } from "react";
import { api } from "../../lib/api";

export function useOverview<T>(path: string, timeZone: string): { data: T | null; error: string | null } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    api.get<T>(`${path}?timeZone=${encodeURIComponent(timeZone)}`)
      .then((value) => { if (alive) setData(value); })
      .catch((err) => { if (alive) setError(err instanceof Error ? err.message : "Não foi possível carregar."); });
    return () => { alive = false; };
  }, [path, timeZone]);
  return { data, error };
}
