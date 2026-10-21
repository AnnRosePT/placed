/**
 * Session helpers shared by AuthContext and the axios client.
 * - Supabase mode (VITE_SUPABASE_URL set): tokens come from supabase-js.
 * - Local demo mode (no Supabase configured): Flask issues a short-lived token from
 *   POST /api/auth/login, kept in localStorage (wrapped in try/catch) with an in-memory fallback.
 */
import { supabase } from "./supabase.js";

export const authMode = supabase ? "supabase" : "local";
const KEY = "placementai.local_session";
let memorySession = null;

function valid(session) {
  return session && session.access_token && (!session.expires_at || session.expires_at * 1000 > Date.now());
}

export function readLocalSession() {
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (valid(parsed)) return parsed;
  } catch { /* storage unavailable */ }
  return valid(memorySession) ? memorySession : null;
}

export function writeLocalSession(session) {
  memorySession = session;
  try {
    if (session) window.localStorage.setItem(KEY, JSON.stringify(session));
    else window.localStorage.removeItem(KEY);
  } catch { /* storage unavailable: memory only */ }
}

export async function getAccessToken() {
  if (supabase) {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token || null;
  }
  return readLocalSession()?.access_token || null;
}
