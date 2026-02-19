import { useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { disconnectSocket, reconnectSocket } from "../lib/socket";
import type { MeResponse } from "../lib/types";

export function getMe(): MeResponse | null {
  try {
    const raw = localStorage.getItem("dashboard_me");
    if (!raw) return null;
    return JSON.parse(raw) as MeResponse;
  } catch {
    return null;
  }
}

export function isAdmin(): boolean {
  const me = getMe();
  return !me || me.role === "admin";
}

export function useAuth() {
  const [token, setTokenState] = useState(() =>
    localStorage.getItem("dashboard_token") || "",
  );
  const navigate = useNavigate();

  const login = useCallback(async (newToken: string) => {
    localStorage.setItem("dashboard_token", newToken);
    setTokenState(newToken);
    reconnectSocket();

    try {
      const res = await fetch("/api/auth/me", {
        headers: { Authorization: `Bearer ${newToken}` },
      });
      if (res.ok) {
        const me: MeResponse = await res.json();
        localStorage.setItem("dashboard_me", JSON.stringify(me));
        if (me.role === "user") {
          const first = me.projects[0] || me.agents[0];
          if (first) {
            const prefix = me.projects[0] ? "projects" : "agents";
            navigate(`/${prefix}/${first}`);
          } else {
            navigate("/");
          }
          return;
        }
      }
    } catch {
      // fallback to admin behavior
    }

    navigate("/");
  }, [navigate]);

  const logout = useCallback(() => {
    localStorage.removeItem("dashboard_token");
    localStorage.removeItem("dashboard_me");
    disconnectSocket();
    setTokenState("");
    navigate("/login");
  }, [navigate]);

  return { token, isAuthenticated: !!token, login, logout };
}
