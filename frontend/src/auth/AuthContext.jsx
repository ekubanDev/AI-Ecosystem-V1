import { useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { auth as authApi } from "../api/endpoints.js";
import { refreshSession, setAccessToken, setAuthLostHandler } from "../api/client.js";
import { can } from "./permissions.js";

const Ctx = createContext(null);

// Non-sensitive hint that this browser has (had) a session. The refresh token itself is an HttpOnly cookie the page can't see,
// so without this every first-time visitor would fire a refresh request that is guaranteed to 401.
const HINT = "abf_session";
const hint = {
  has: () => { try { return localStorage.getItem(HINT) === "1"; } catch { return true; } },
  set: () => { try { localStorage.setItem(HINT, "1"); } catch { /* storage unavailable: the hint is only an optimisation */ } },
  clear: () => { try { localStorage.removeItem(HINT); } catch { /* ignore */ } },
};
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }) {
  const qc = useQueryClient();
  const [state, setState] = useState({ status: "loading", user: null });

  const clear = useCallback(() => {
    setAccessToken(null);
    hint.clear();
    qc.clear();
    setState({ status: "anon", user: null });
  }, [qc]);

  useEffect(() => {
    setAuthLostHandler(clear);
    // Restore the session from the refresh cookie on page load.
    if (!hint.has()) {
      setState({ status: "anon", user: null });
      return;
    }
    refreshSession()
      .then((s) => setState({ status: "authed", user: s.user }))
      .catch(() => {
        hint.clear();
        setState({ status: "anon", user: null });
      });
  }, [clear]);

  const value = useMemo(
    () => ({
      ...state,
      can: (capability) => can(state.user?.role, capability),
      async login(credentials) {
        const s = await authApi.login(credentials);
        setAccessToken(s.accessToken);
        hint.set();
        setState({ status: "authed", user: s.user });
      },
      async logout() {
        try {
          await authApi.logout();
        } finally {
          clear();
        }
      },
    }),
    [state, clear]
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
