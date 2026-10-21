import { useEffect, useMemo, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { DEV_BYPASS, useAuth } from "../context/AuthContext.jsx";
import api from "../services/api.js";
import { Icon } from "../components/ui/index.jsx";

const navigation = [
  { label: "Dashboard", path: "/", icon: "space_dashboard" },
  { label: "Student Management", path: "/students", icon: "school" },
  { label: "Placement Prediction", path: "/prediction", icon: "online_prediction" },
  { label: "Analytics & Reports", path: "/analytics", icon: "monitoring" },
  { label: "Skill Gap Analysis", path: "/skill-gap", icon: "radar" },
  { label: "Admin & Settings", path: "/admin", icon: "settings", roles: ["super_admin", "auditor"] },
];
const roleLabels = { super_admin: "Super Administrator", placement_officer: "Placement Officer", faculty_mentor: "Faculty Mentor", auditor: "Auditor" };
const pageNames = { "/": "Placement Operations", "/students": "Student Management", "/prediction": "Placement Prediction", "/analytics": "Analytics & Reports", "/skill-gap": "Skill Gap Analysis", "/admin": "Admin & Settings" };

function initials(name = "") {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "AD";
}

export default function AppLayout() {
  const { profile, signOut } = useAuth();
  const [health, setHealth] = useState(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [search, setSearch] = useState("");
  const location = useLocation();
  const navigate = useNavigate();
  const title = pageNames[location.pathname] || "Placement Operations";
  const navItems = useMemo(() => navigation.filter((item) => !item.roles || item.roles.includes(profile?.role)), [profile?.role]);

  useEffect(() => {
    let active = true;
    const poll = async () => {
      try {
        const { data } = await api.get("/health");
        if (active) setHealth(data);
      } catch {
        if (active) setHealth(null);
      }
    };
    poll();
    const timer = window.setInterval(poll, 60_000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  useEffect(() => { setDrawerOpen(false); setMenuOpen(false); }, [location.pathname]);

  const submitSearch = (event) => {
    event.preventDefault();
    const query = search.trim();
    navigate(query ? `/students?search=${encodeURIComponent(query)}` : "/students");
  };
  const doSignOut = async () => {
    try { await signOut(); } finally { navigate("/login", { replace: true }); }
  };

  const sidebar = <aside className="fixed inset-y-0 left-0 z-50 flex w-72 flex-col justify-between bg-surface-container-low shadow-[0_1px_8px_rgba(0,0,0,0.04)]">
    <div className="flex flex-col">
      <div className="flex items-center gap-space-sm px-space-md py-space-lg"><div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-container text-on-primary"><Icon>model_training</Icon></div><div className="flex min-w-0 flex-col"><span className="truncate font-headline-sm text-headline-sm tracking-tight text-primary">PlacementAI</span><span className="truncate font-label-sm text-label-sm text-on-surface-variant">BTech CSE Academic Portal</span></div></div>
      <div className="px-space-md pt-space-xs"><span className="px-space-xs font-label-sm text-label-sm uppercase tracking-wider text-outline">Platform Navigation</span></div>
      <nav className="flex flex-col gap-space-xs px-space-md pt-space-sm" aria-label="Main navigation">
        {navItems.map((item) => <NavLink key={item.path} to={item.path} end={item.path === "/"} className={({ isActive }) => `flex items-center gap-space-sm rounded-lg px-space-md py-space-sm transition-colors ${isActive ? "bg-primary-container font-headline-sm text-on-primary" : "text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface"}`}><Icon className="text-[20px]">{item.icon}</Icon><span className="font-body-md text-body-md">{item.label}</span></NavLink>)}
      </nav>
    </div>
    <div className="flex flex-col gap-space-sm bg-surface-container/50 p-space-md">
      <div className="flex items-center justify-between gap-2 rounded-lg bg-surface-container-lowest p-space-sm shadow-[0_1px_3px_rgba(15,23,42,0.04)]"><div className="flex min-w-0 items-center gap-space-xs"><span className={`h-2 w-2 shrink-0 rounded-full ${health ? "bg-emerald-500" : "bg-error"}`} /><span className="truncate font-label-sm text-label-sm text-on-surface-variant">Flask REST API: <span className={health ? "font-medium text-secondary" : "font-medium text-error"}>{health ? "Connected" : "Offline"}{health?.model_version ? ` · ${health.model_version}` : ""}</span></span></div><Icon className="text-[16px] text-outline">{health ? "verified" : "error"}</Icon></div>
      <button type="button" onClick={doSignOut} className="flex items-center justify-between rounded-lg bg-surface-container-lowest px-space-md py-space-sm text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface"><span className="flex items-center gap-space-xs font-body-sm text-body-sm"><Icon className="text-[18px]">logout</Icon>Sign Out</span><span className="font-label-sm text-label-sm text-outline">End Session</span></button>
    </div>
  </aside>;

  return <div className="min-h-screen bg-surface font-body-md text-on-surface antialiased">
    {drawerOpen && <button type="button" aria-label="Close navigation" className="fixed inset-0 z-40 bg-primary/40 lg:hidden" onClick={() => setDrawerOpen(false)} />}
    <div className={`fixed inset-y-0 left-0 z-50 transition-transform duration-200 lg:translate-x-0 ${drawerOpen ? "translate-x-0" : "-translate-x-full"} lg:pointer-events-auto`}>{sidebar}</div>
    <div className="min-h-screen lg:pl-72">
      <header className="fixed left-0 right-0 top-0 z-30 flex h-16 items-center justify-between gap-3 bg-surface/90 px-4 shadow-[0_1px_8px_rgba(0,0,0,0.04)] backdrop-blur-xl lg:left-72 lg:px-space-lg">
        <div className="flex min-w-0 items-center gap-space-md">
          <button type="button" aria-label="Open navigation" className="min-h-[40px] min-w-[40px] rounded-lg p-2 text-on-surface-variant hover:bg-surface-container lg:hidden" onClick={() => setDrawerOpen(true)}><Icon>menu</Icon></button>
          <div className="hidden min-w-0 items-center gap-space-xs font-body-sm text-body-sm text-on-surface-variant md:flex"><span>Academic</span><Icon className="text-[14px] text-outline">chevron_right</Icon><span className="truncate font-headline-sm text-headline-sm text-primary">{title}</span></div>
          <form onSubmit={submitSearch} className="relative flex min-w-0 items-center"><Icon className="pointer-events-none absolute left-2 text-[18px] text-outline">search</Icon><input aria-label="Search students" value={search} onChange={(event) => setSearch(event.target.value)} className="h-9 w-[min(42vw,18rem)] rounded-lg bg-surface-container-lowest pl-8 pr-3 font-body-sm outline-none transition focus:ring-2 focus:ring-secondary/20" placeholder="Search Student ID, USN, or Name..." /></form>
        </div>
        <div className="flex shrink-0 items-center gap-2 sm:gap-space-md">
          <div className="hidden items-center gap-space-xs rounded-full bg-surface-container px-space-sm py-1 font-label-md text-label-md text-on-surface md:flex"><Icon className="text-[14px] text-secondary">calendar_today</Icon><span>{health?.auth_mode === "local" ? "Local demo mode" : "Placement Portal"}</span></div>
          <div className="relative">
            <button type="button" aria-expanded={menuOpen} onClick={() => setMenuOpen((open) => !open)} className="flex items-center gap-2 rounded-lg p-1.5 hover:bg-surface-container-high"><span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary-container font-label-sm text-label-sm font-bold text-on-primary">{initials(profile?.full_name)}</span><span className="hidden min-w-0 flex-col text-left xl:flex"><span className="max-w-40 truncate font-headline-sm text-headline-sm leading-tight text-on-surface">{profile?.full_name || "Administrator"}</span><span className="font-label-sm text-label-sm leading-tight text-on-surface-variant">{roleLabels[profile?.role] || profile?.role}</span></span><Icon className="text-[18px] text-outline">arrow_drop_down</Icon></button>
            {menuOpen && <div className="absolute right-0 top-full z-50 mt-2 w-52 rounded-xl border border-surface-container bg-surface-container-lowest p-2 shadow-xl"><div className="border-b border-surface-container px-3 py-2 xl:hidden"><p className="font-headline-sm text-primary">{profile?.full_name}</p><p className="font-label-sm text-outline">{roleLabels[profile?.role] || profile?.role}</p></div><button type="button" onClick={doSignOut} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left font-body-sm hover:bg-surface-container-low"><Icon>logout</Icon>Sign out</button></div>}
          </div>
        </div>
      </header>
      <main className="min-h-screen w-full bg-surface px-4 pb-8 pt-20 sm:px-space-lg">{DEV_BYPASS && <div role="status" className="mb-4 flex items-start gap-2 rounded-lg bg-amber-50 px-4 py-2.5 font-body-sm text-amber-900"><Icon className="text-[18px]">warning</Icon><span><strong>Dev auth bypass is ON.</strong> Everyone is treated as a super admin and Supabase RLS is bypassed with the service-role key. Use only on your own machine; set both DEV_BYPASS flags to false before a demo or deployment.</span></div>}<Outlet /></main>
    </div>
  </div>;
}
