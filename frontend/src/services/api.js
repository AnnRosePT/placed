/**
 * api.js — Axios client for the PlacementAI Flask backend.
 *
 * All components MUST use this module for data fetching.
 * supabase-js is used ONLY for auth (sign-in / sign-out / session).
 * The access token is attached here automatically.
 */
import axios from "axios";
import { supabase } from "../lib/supabase.js";
import { getAccessToken, writeLocalSession } from "../lib/session.js";

const configuredApiBase = import.meta.env.VITE_API_BASE_URL || "/api";
const localDevHost = ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);
export const apiBaseUrl = import.meta.env.DEV && localDevHost ? "/api" : configuredApiBase;

const api = axios.create({
  baseURL: apiBaseUrl,
  headers: { "Content-Type": "application/json" },
  withCredentials: false,
  timeout: 120000,
});

// Attach the latest access token to every Flask request.
api.interceptors.request.use(async (config) => {
  if (import.meta.env.VITE_DEV_BYPASS_AUTH !== "true") {
    const token = await getAccessToken();
    if (token) config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

async function blobErrorPayload(error) {
  const data = error.response?.data;
  if (data instanceof Blob && data.type?.includes("json")) {
    try { return JSON.parse(await data.text())?.error; } catch { return null; }
  }
  return data?.error;
}

async function normalizeError(error) {
  const payload = await blobErrorPayload(error);
  error.apiError = {
    code: payload?.code || (error.response ? `http_${error.response.status}` : "network_error"),
    message: payload?.message || (error.response ? error.message : "Cannot reach the API. Is the Flask server running?"),
    details: payload?.details ?? null,
  };
  return error;
}

function goToLogin() {
  if (window.location.pathname !== "/login") window.location.assign("/login");
}

// Retry a single expired access token after refreshing the persisted session.
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const original = error.config;
    const isLogin = original?.url?.includes("/auth/login");
    if (error.response?.status === 401 && original && !original._sessionRetry && !isLogin) {
      original._sessionRetry = true;
      if (supabase) {
        const { data, error: refreshError } = await supabase.auth.refreshSession();
        if (!refreshError && data.session?.access_token) {
          original.headers = original.headers || {};
          original.headers.Authorization = `Bearer ${data.session.access_token}`;
          return api(original);
        }
        await supabase.auth.signOut();
      } else {
        writeLocalSession(null);
      }
      goToLogin();
    }
    return Promise.reject(await normalizeError(error));
  }
);

export default api;
export { normalizeError };
