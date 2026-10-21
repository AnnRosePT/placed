import { useEffect, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import api from "../services/api.js";
import { useAuth } from "../context/AuthContext.jsx";
import { Button, Icon, Input, Skeleton } from "../components/ui/index.jsx";

export default function LoginPage() {
  const { session, profile, loading: authLoading, signIn, resetPassword, authError, authMode } = useAuth();
  const [health, setHealth] = useState(null);
  const [healthError, setHealthError] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    let active = true;
    api.get("/health").then(({ data }) => { if (active) setHealth(data); })
      .catch(() => { if (active) setHealthError(true); });
    return () => { active = false; };
  }, []);

  if (authLoading) return <div className="grid min-h-screen place-items-center bg-background p-5"><Skeleton className="h-96 w-full max-w-xl" /></div>;
  if (authMode === "bypass" && profile) return <Navigate to="/" replace />;
  if (session && profile) return <Navigate to={location.state?.from?.pathname || "/"} replace />;

  const handleSubmit = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    setNotice("");
    try {
      await signIn(email.trim(), password);
      navigate(location.state?.from?.pathname || "/", { replace: true });
    } catch (cause) {
      setError(cause.message || "Unable to sign in. Check your email and password.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleReset = async () => {
    if (!email.trim()) {
      setError("Enter your email address first, then request a password reset.");
      return;
    }
    setResetting(true);
    setError("");
    setNotice("");
    try {
      await resetPassword(email.trim());
      setNotice("If an account exists for this email, a password reset link has been sent.");
    } catch (cause) {
      setError(cause.message || "Could not send the password reset email.");
    } finally {
      setResetting(false);
    }
  };

  return <main className="min-h-screen w-full bg-background p-3 font-body-md text-on-surface antialiased sm:p-gutter-mobile lg:p-gutter">
    <div className="mx-auto grid min-h-[calc(100vh-1.5rem)] w-full max-w-7xl grid-cols-1 overflow-hidden rounded-xl bg-surface-container-lowest shadow-2xl lg:min-h-[calc(100vh-3rem)] lg:grid-cols-2">
      <section className="relative flex flex-col justify-between overflow-hidden bg-primary-container p-6 text-on-primary sm:p-8 lg:p-12">
        <div className="pointer-events-none absolute -right-24 -top-24 h-96 w-96 rounded-full bg-secondary/15 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-16 -left-20 h-80 w-80 rounded-full bg-on-tertiary-container/10 blur-2xl" />
        <div className="relative z-10">
          <div className="flex items-center gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-lg bg-secondary-container text-on-secondary shadow-md"><Icon>model_training</Icon></div><div><span className="block font-headline-md text-headline-md font-bold tracking-tight text-white">PlacementAI</span><span className="font-label-sm text-label-sm uppercase tracking-wider text-on-primary-container">BTech CSE Academic Portal</span></div></div>
          <div className="mt-10 space-y-3"><span className="flex items-center gap-2 font-label-sm text-label-sm font-semibold uppercase tracking-widest text-tertiary-fixed-dim"><span className="h-2 w-2 animate-pulse rounded-full bg-tertiary-fixed-dim" />Institutional Predictive Engine</span><h1 className="font-headline-xl text-headline-xl-mobile text-white sm:text-headline-xl">Predictive Analytics & Placement Intelligence</h1><p className="max-w-lg font-body-md leading-relaxed text-on-primary-container">A placement operations portal for student records, model-assisted insights, and skill development tracking.</p></div>
          <div className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="rounded-lg bg-surface/5 p-4 backdrop-blur-md"><div className="mb-3 flex items-center justify-between text-secondary-fixed-dim"><Icon>monitor_heart</Icon><span className="font-label-sm">API STATUS</span></div>{health ? <><p className="font-headline-md text-headline-md font-bold text-white">Connected</p><p className="mt-1 font-body-sm text-surface-container-highest">Flask API v{health.version}</p></> : healthError ? <><p className="font-headline-md text-headline-md font-bold text-white">Offline</p><p className="mt-1 font-body-sm text-surface-container-highest">Backend health endpoint is unavailable.</p></> : <Skeleton className="h-12 bg-white/10" />}</div>
            <div className="rounded-lg bg-surface/5 p-4 backdrop-blur-md"><div className="mb-3 flex items-center justify-between text-secondary-fixed-dim"><Icon>model_training</Icon><span className="font-label-sm">MODEL STATUS</span></div>{health ? <><p className="truncate font-headline-md text-headline-md font-bold text-white">{health.model_loaded ? "Ready" : "Not loaded"}</p><p className="mt-1 truncate font-body-sm text-surface-container-highest">{health.model_version || "No active model version reported"}</p></> : <Skeleton className="h-12 bg-white/10" />}</div>
          </div>
        </div>
        <div className="relative z-10 mt-8 flex flex-wrap items-center justify-between gap-2 border-t border-white/10 pt-5 font-label-sm text-label-sm text-on-primary-container"><span className="flex items-center gap-2"><span className={`h-2 w-2 rounded-full ${health ? "bg-secondary-fixed" : healthError ? "bg-error" : "bg-secondary-fixed animate-pulse"}`} />Flask REST API <strong className="text-white">{health ? "Connected" : healthError ? "Offline" : "Checking…"}</strong></span><span>Placement Operations</span></div>
      </section>

      <section className="flex flex-col justify-between p-6 sm:p-8 lg:p-12">
        <div className="flex items-center justify-between gap-3 font-label-sm text-label-sm text-on-surface-variant"><span className="flex items-center gap-1.5"><Icon className="text-[16px]">admin_panel_settings</Icon>Authorized administrator access</span><span className="rounded bg-surface-container px-2.5 py-1 text-on-surface">{authMode === "local" ? "Local demo auth" : "Supabase Auth"}</span></div>
        <div className="mx-auto my-auto w-full max-w-md py-8">
          <div><p className="mb-2 font-label-sm text-label-sm uppercase tracking-widest text-secondary">Secure sign in</p><h2 className="font-headline-lg text-headline-lg font-bold tracking-tight text-on-surface">Administrative Console</h2><p className="mt-1.5 font-body-md text-on-surface-variant">Sign in with the email and password assigned to your administrator account.</p></div>
          <form className="mt-8 space-y-5" onSubmit={handleSubmit}>
            <div><div className="mb-1.5 flex items-center justify-between"><label className="font-label-sm text-label-sm font-semibold uppercase tracking-wider" htmlFor="email">Email address</label><Icon className="text-[16px] text-secondary">mail</Icon></div><input id="email" name="email" type="email" autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@institution.edu" className="h-11 w-full rounded-lg border border-outline-variant/60 bg-surface-container-lowest px-3 font-body-md text-on-surface outline-none transition focus:ring-2 focus:ring-secondary/30" /></div>
            <div><div className="mb-1.5 flex items-center justify-between"><label className="font-label-sm text-label-sm font-semibold uppercase tracking-wider" htmlFor="password">Password</label>{authMode !== "local" && <button type="button" disabled={resetting} onClick={handleReset} className="font-label-sm text-label-sm font-medium text-secondary hover:underline disabled:opacity-60">{resetting ? "Sending…" : "Forgot password?"}</button>}</div><div className="relative"><input id="password" name="password" type={showPassword ? "text" : "password"} autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} className="h-11 w-full rounded-lg border border-outline-variant/60 bg-surface-container-lowest px-3 pr-12 font-body-md text-on-surface outline-none transition focus:ring-2 focus:ring-secondary/30" /><button type="button" aria-label={showPassword ? "Hide password" : "Show password"} onClick={() => setShowPassword((visible) => !visible)} className="absolute inset-y-0 right-0 flex items-center px-3 text-on-surface-variant hover:text-on-surface"><Icon className="text-[18px]">{showPassword ? "visibility_off" : "visibility"}</Icon></button></div></div>
            {(error || authError) && <div role="alert" className="rounded-lg bg-error-container px-3 py-2.5 font-body-sm text-on-error-container">{error || authError}</div>}
            {notice && <div role="status" className="rounded-lg bg-secondary-fixed px-3 py-2.5 font-body-sm text-on-secondary-fixed">{notice}</div>}
            <Button type="submit" loading={submitting} className="h-12 w-full shadow-md"><span>{submitting ? "Signing in…" : "Sign In to Dashboard"}</span>{!submitting && <Icon className="text-[18px]">arrow_forward</Icon>}</Button>
          </form>
          <div className="mt-6 flex items-start gap-2.5 rounded-lg bg-surface-container-low p-3 text-on-surface-variant"><Icon className="mt-0.5 text-[17px] text-secondary">info</Icon><p className="font-body-sm leading-relaxed">{authMode === "local" ? "Local demo mode: Supabase is not configured, so Flask signs you in against its local store. The first super admin is defined by LOCAL_ADMIN_EMAIL / LOCAL_ADMIN_PASSWORD in backend/.env (see README)." : "Access is limited to active administrators provisioned by your institution. User roles are managed by the placement system."}</p></div>
        </div>
        <div className="flex items-center justify-between gap-3 border-t border-surface-container pt-4 font-label-sm text-label-sm text-on-surface-variant"><span className="font-mono">API: {import.meta.env.VITE_API_BASE_URL || "/api"}</span><span className="flex items-center gap-1.5 text-secondary"><Icon className="text-[15px]">lock</Icon>Account access</span></div>
      </section>
    </div>
  </main>;
}
