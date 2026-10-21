import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import api from "../services/api.js";
import { supabase } from "../lib/supabase.js";
import { authMode, readLocalSession, writeLocalSession } from "../lib/session.js";

const AuthContext = createContext(null);
// DEV ONLY: with VITE_DEV_BYPASS_AUTH=true the Flask backend (DEV_BYPASS_AUTH=true) treats every
// request as a local super admin, so the UI loads that profile instead of requiring sign-in.
export const DEV_BYPASS = import.meta.env.VITE_DEV_BYPASS_AUTH === "true";
export const ADMIN_ACCESS_ERROR = "This account is not an authorized administrator.";

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState("");

  const loadProfile = useCallback(async () => {
    try {
      const response = await api.get("/auth/me");
      setProfile(response.data);
      setAuthError("");
      return response.data;
    } catch (error) {
      if (error.response?.status === 403) {
        setAuthError(ADMIN_ACCESS_ERROR);
        setProfile(null);
        if (supabase) await supabase.auth.signOut();
        else writeLocalSession(null);
      } else {
        setProfile(null);
        setAuthError(error.apiError?.message || "Unable to load your administrator profile.");
      }
      return null;
    }
  }, []);

  useEffect(() => {
    let active = true;
    if (DEV_BYPASS) {
      setSession({ access_token: null, user: { email: "dev@local" }, bypass: true });
      loadProfile().finally(() => active && setLoading(false));
      return () => { active = false; };
    }
    if (!supabase) {
      // Local demo mode: restore a still-valid Flask-issued session.
      const stored = readLocalSession();
      setSession(stored);
      if (stored) loadProfile().finally(() => active && setLoading(false));
      else setLoading(false);
      return () => { active = false; };
    }
    const hydrate = async (nextSession) => {
      if (!active) return;
      setSession(nextSession);
      if (nextSession) await loadProfile();
      else setProfile(null);
      if (active) setLoading(false);
    };
    supabase.auth.getSession().then(({ data }) => hydrate(data.session));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      if (!nextSession) {
        setProfile(null);
        setLoading(false);
      } else {
        // Defer API work until after the Supabase auth callback completes.
        window.setTimeout(() => { if (active) loadProfile().finally(() => setLoading(false)); }, 0);
      }
    });
    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, [loadProfile]);

  const signIn = useCallback(async (email, password) => {
    setAuthError("");
    if (!supabase) {
      try {
        const { data } = await api.post("/auth/login", { email, password });
        const next = { access_token: data.access_token, expires_at: data.expires_at, user: data.user };
        writeLocalSession(next);
        setSession(next);
      } catch (error) {
        throw new Error(error.apiError?.message || "Unable to sign in.");
      }
    } else {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      setSession(data.session);
    }
    const nextProfile = await loadProfile();
    if (!nextProfile) {
      if (supabase) await supabase.auth.signOut();
      else writeLocalSession(null);
      setSession(null);
      throw new Error(ADMIN_ACCESS_ERROR);
    }
    return nextProfile;
  }, [loadProfile]);

  const signOut = useCallback(async () => {
    if (DEV_BYPASS) {
      setAuthError("Dev auth bypass is ON, so there is no real session to end. Set DEV_BYPASS_AUTH=false (backend) and VITE_DEV_BYPASS_AUTH=false (frontend) to use real sign-in.");
    } else if (supabase) {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
    } else {
      writeLocalSession(null);
    }
    if (DEV_BYPASS) return;
    setSession(null);
    setProfile(null);
  }, []);

  const resetPassword = useCallback(async (email) => {
    if (!supabase) throw new Error("Password reset needs Supabase Auth. In local demo mode, ask a super admin to create a new account.");
    const redirectTo = `${window.location.origin}/login`;
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
    if (error) throw error;
  }, []);

  const lastSignInAt = session?.user?.last_sign_in_at || profile?.last_sign_in_at || null;
  const value = useMemo(() => ({ session, profile, loading, authError, authMode: DEV_BYPASS ? "bypass" : authMode, lastSignInAt, signIn, signOut, resetPassword, refreshProfile: loadProfile }),
    [session, profile, loading, authError, lastSignInAt, signIn, signOut, resetPassword, loadProfile]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
}
