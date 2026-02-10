import { useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { disconnectSocket } from "../lib/socket";

export function useAuth() {
  const [token, setTokenState] = useState(() =>
    localStorage.getItem("dashboard_token") || "",
  );
  const navigate = useNavigate();

  const login = useCallback((newToken: string) => {
    localStorage.setItem("dashboard_token", newToken);
    setTokenState(newToken);
    navigate("/");
  }, [navigate]);

  const logout = useCallback(() => {
    localStorage.removeItem("dashboard_token");
    disconnectSocket();
    setTokenState("");
    navigate("/login");
  }, [navigate]);

  return { token, isAuthenticated: !!token, login, logout };
}
