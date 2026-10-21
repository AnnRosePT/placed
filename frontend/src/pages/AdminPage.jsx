import { useCallback, useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import { adminService } from "../services/adminService.js";
import { predictionService } from "../services/predictionService.js";
import { apiBaseUrl } from "../services/api.js";
import { useAuth } from "../context/AuthContext.jsx";
import LazyPlot from "../components/charts/LazyPlot.jsx";
import { chartColors } from "../components/charts/PlotlyChart.jsx";
import { Badge, Button, Card, ConfirmDialog, DataTable, EmptyState, ErrorState, Icon, Input, Modal, PageHeader, Select, Skeleton } from "../components/ui/index.jsx";
import { FEATURE_LABELS, dateTime, initials, pct, relativeTime } from "../utils/format.js";
import { saveResponse } from "../utils/download.js";

const ROLES = [
  { value: "super_admin", label: "Super Admin" },
  { value: "placement_officer", label: "Placement Officer" },
  { value: "faculty_mentor", label: "Faculty Mentor" },
  { value: "auditor", label: "Auditor" },
];
const ROLE_LABEL = Object.fromEntries(ROLES.map((r) => [r.value, r.label]));
const SETTINGS = [
  { key: "at_risk_probability", label: "At-risk probability threshold", min: 0.05, max: 0.95, step: 0.05, format: (v) => pct(v, 0), help: "Predictions below this are labelled not placed / at risk." },
  { key: "placement_target_rate", label: "Institutional placement target", min: 0.5, max: 1, step: 0.01, format: (v) => pct(v, 0), help: "Used for dashboard progress and students-to-target." },
  { key: "tier1_min_cgpa", label: "Tier-1 minimum CGPA", min: 6, max: 10, step: 0.1, format: (v) => Number(v).toFixed(1), help: "Skill gap: Tier-1 eligibility needs this CGPA and no critical gaps." },
  { key: "skill_target", label: "Skill target (every axis)", min: 40, max: 100, step: 1, format: (v) => `${v}/100`, help: "Gap = target − score. Gap ≥ 20 is critical." },
  { key: "technical_threshold", label: "Technical floor", min: 30, max: 100, step: 1, format: (v) => `${v}/100`, help: "Flags technical scores below this in Students and Skill Gap." },
  { key: "aptitude_threshold", label: "Aptitude floor", min: 30, max: 100, step: 1, format: (v) => `${v}/100`, help: "Flags aptitude scores below this." },
  { key: "high_potential_lpa", label: "High-potential package cutoff", min: 1, max: 50, step: 0.5, format: (v) => `₹${v} LPA`, help: "Package tiers in Analytics." },
  { key: "dream_lpa", label: "Dream package cutoff", min: 1, max: 100, step: 0.5, format: (v) => `₹${v} LPA`, help: "Dream offers and dream-tier share." },
  { key: "super_dream_lpa", label: "Super-dream package cutoff", min: 1, max: 200, step: 1, format: (v) => `₹${v} LPA`, help: "Top package tier." },
];
const PAGE_SIZE_KEY = "placementai.default_page_size";

function readPageSize() { try { return window.localStorage.getItem(PAGE_SIZE_KEY) || "10"; } catch { return "10"; } }

function AddAdminModal({ open, onClose, onCreated }) {
  const [form, setForm] = useState({ email: "", full_name: "", role: "placement_officer", department: "" });
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => { if (open) { setForm({ email: "", full_name: "", role: "placement_officer", department: "" }); setCreated(null); setError(""); } }, [open]);
  const submit = async (event) => {
    event.preventDefault();
    setBusy(true); setError("");
    try { const data = await adminService.createUser({ ...form, department: form.department || null }); setCreated(data); onCreated(); }
    catch (cause) { setError(cause.apiError?.message || "Could not create administrator."); } finally { setBusy(false); }
  };
  return <Modal open={open} title={created ? "Administrator created" : "Add administrator"} onClose={onClose}>
    {created ? <div className="space-y-3"><p className="font-body-sm text-on-surface-variant">{created.full_name} ({created.email}) can now sign in as <strong>{ROLE_LABEL[created.role]}</strong>. Share this temporary password securely — it will not be shown again.</p><div className="flex items-center justify-between gap-2 rounded-lg bg-surface-container-low p-3"><code className="break-all font-label-md text-label-md text-primary">{created.temporary_password}</code><Button variant="secondary" onClick={() => { navigator.clipboard?.writeText(created.temporary_password); toast.success("Copied."); }}><Icon>content_copy</Icon>Copy</Button></div><div className="flex justify-end"><Button onClick={onClose}>Done</Button></div></div> :
    <form onSubmit={submit} className="space-y-3">
      <Input label="Full name" required value={form.full_name} onChange={(e) => setForm((f) => ({ ...f, full_name: e.target.value }))} />
      <Input label="Email" type="email" required value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
      <div className="grid grid-cols-2 gap-3"><Select label="Role" value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))} options={ROLES} /><Select label="Department" value={form.department} onChange={(e) => setForm((f) => ({ ...f, department: e.target.value }))} options={[{ value: "", label: "None" }, "CSE", "IT", "AIDS", "ECE"].map((o) => typeof o === "string" ? { value: o, label: o } : o)} /></div>
      {error && <p role="alert" className="rounded-lg bg-error-container p-3 font-body-sm text-on-error-container">{error}</p>}
      <div className="flex justify-end gap-2 border-t border-surface-container pt-4"><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" loading={busy}><Icon>person_add</Icon>Create account</Button></div>
    </form>}
  </Modal>;
}

function AuditTrail() {
  const [filters, setFilters] = useState({ action: "", entity: "", from: "", to: "" });
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setError("");
    try { setData(await adminService.audit({ ...filters, page, per_page: 12 })); } catch (cause) { setError(cause.apiError?.message || "Could not load the audit trail."); }
  }, [filters, page]);
  useEffect(() => { load(); }, [load]);
  const set = (key) => (e) => { setPage(1); setFilters((f) => ({ ...f, [key]: e.target.value })); };
  return <Card className="p-space-lg">
    <div className="mb-space-md flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between"><div><h2 className="flex items-center gap-2 font-headline-md text-headline-md text-primary"><Icon className="text-secondary">policy</Icon>Security audit trail</h2><p className="font-body-sm text-on-surface-variant">Append-only log of every write, import, export, prediction and settings change.</p></div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5 sm:items-end"><Select label="Action" value={filters.action} onChange={set("action")} options={[{ value: "", label: "All actions" }, ...(data?.actions || []).map((a) => ({ value: a, label: a.replaceAll("_", " ") }))]} /><Select label="Entity" value={filters.entity} onChange={set("entity")} options={[{ value: "", label: "All entities" }, ...["students", "predictions", "skill_assessments", "app_settings", "admin_profiles", "ml_models", "report_exports"].map((v) => ({ value: v, label: v.replaceAll("_", " ") }))]} /><Input label="From" type="date" value={filters.from} onChange={set("from")} /><Input label="To" type="date" value={filters.to} onChange={set("to")} /><Button variant="secondary" onClick={() => saveResponse(adminService.auditExport(filters), "audit_trail.csv").catch((e) => toast.error(e.apiError?.message || "Export failed."))}><Icon>download</Icon>CSV</Button></div></div>
    {error ? <ErrorState message={error} onRetry={load} /> : !data ? <Skeleton className="h-48" /> : data.items.length === 0 ? <EmptyState icon="policy" title="No audit events match" /> : <>
      <DataTable rows={data.items} columns={[{ key: "created_at", label: "When", render: (v) => <span className="whitespace-nowrap font-label-sm text-label-sm" title={dateTime(v)}>{relativeTime(v)}</span> }, { key: "actor_name", label: "Actor", render: (v, r) => <span className="font-body-sm">{v}<span className="block font-label-sm text-label-sm text-outline">{r.actor_email}</span></span> }, { key: "action", label: "Action", render: (v) => <Badge tone={v === "delete" ? "danger" : v.startsWith("predict") ? "info" : "neutral"}>{v.replaceAll("_", " ")}</Badge> }, { key: "entity", label: "Entity", render: (v) => v.replaceAll("_", " ") }, { key: "meta", label: "Details", render: (m) => <code className="block max-w-[22rem] truncate font-label-sm text-label-sm text-on-surface-variant" title={JSON.stringify(m)}>{JSON.stringify(m)}</code> }]} />
      <div className="flex items-center justify-between pt-3 font-label-sm text-label-sm text-on-surface-variant"><span>{data.total} events</span><div className="flex gap-2"><Button variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button><Button variant="secondary" disabled={page >= Math.ceil(data.total / data.per_page)} onClick={() => setPage((p) => p + 1)}>Next</Button></div></div>
    </>}
  </Card>;
}

export default function AdminPage() {
  const { profile, authMode, lastSignInAt } = useAuth();
  const isSuper = profile?.role === "super_admin";
  const [modelInfo, setModelInfo] = useState(null);
  const [modelError, setModelError] = useState("");
  const [system, setSystem] = useState(null);
  const [diagnostic, setDiagnostic] = useState(null);
  const [diagBusy, setDiagBusy] = useState(false);
  const [users, setUsers] = useState(null);
  const [userSearch, setUserSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const [settings, setSettings] = useState(null);
  const [draft, setDraft] = useState({});
  const [saveOpen, setSaveOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [job, setJob] = useState(null);
  const [pageSize, setPageSize] = useState(readPageSize);
  const pollRef = useRef(null);

  const loadModel = useCallback(() => adminService.model().then((d) => { setModelInfo(d); if (d.running_job) setJob(d.running_job); }).catch((e) => setModelError(e.apiError?.message || "Could not load model governance.")), []);
  const loadUsers = useCallback(() => isSuper && adminService.users({ search: userSearch, role: roleFilter }).then((d) => setUsers(d.items)).catch(() => setUsers([])), [isSuper, userSearch, roleFilter]);
  const loadSettings = useCallback(() => adminService.settings().then((s) => { setSettings(s); setDraft(Object.fromEntries(SETTINGS.map(({ key }) => [key, s[key]]))); }).catch(() => {}), []);
  useEffect(() => { loadModel(); adminService.system().then(setSystem).catch(() => {}); loadSettings(); }, [loadModel, loadSettings]);
  useEffect(() => { const t = window.setTimeout(loadUsers, 250); return () => window.clearTimeout(t); }, [loadUsers]);

  useEffect(() => {
    if (!job || !["queued", "running"].includes(job.status)) return undefined;
    pollRef.current = window.setInterval(async () => {
      try {
        const next = await adminService.job(job.id);
        setJob(next);
        if (next.status === "succeeded") { toast.success(`Retraining finished: ${next.version}`); loadModel(); }
        if (next.status === "failed") toast.error(`Retraining failed: ${next.error}`);
      } catch { /* keep polling */ }
    }, 2000);
    return () => window.clearInterval(pollRef.current);
  }, [job, loadModel]);

  const runDiagnostic = async () => {
    setDiagBusy(true);
    try {
      const t0 = performance.now(); const health = await adminService.health(); const healthMs = performance.now() - t0;
      const t1 = performance.now(); await predictionService.predict({ features: { cgpa: 8, aptitude_score: 75, tenth_pct: 80, twelfth_pct: 80 } }); const predictMs = performance.now() - t1;
      setDiagnostic({ health, healthMs, predictMs, at: new Date().toISOString() });
    } catch (error) { toast.error(error.apiError?.message || "Diagnostic failed."); } finally { setDiagBusy(false); }
  };
  const retrain = async () => { try { setJob(await adminService.retrain()); toast.success("Retraining started in the background."); } catch (error) { toast.error(error.apiError?.message || "Could not start retraining."); } };
  const activate = async (version) => { try { await adminService.activate(version); toast.success(`Activated ${version}.`); loadModel(); } catch (error) { toast.error(error.apiError?.message || "Activation failed."); } };
  const changeUser = async (user, changes) => {
    try { await adminService.updateUser(user.user_id, changes); toast.success("Administrator updated."); loadUsers(); }
    catch (error) { toast.error(error.apiError?.message || "Update failed."); }
  };
  const saveSettings = async () => {
    setSaving(true);
    const changes = Object.fromEntries(Object.entries(draft).filter(([k, v]) => Number(v) !== Number(settings[k])).map(([k, v]) => [k, Number(v)]));
    try { if (Object.keys(changes).length) { await adminService.updateSettings(changes); toast.success("Thresholds saved. Prediction and Skill Gap use them immediately."); } setSaveOpen(false); loadSettings(); }
    catch (error) { toast.error(error.apiError?.message || "Could not save settings."); } finally { setSaving(false); }
  };
  const changePageSize = (value) => { setPageSize(value); try { window.localStorage.setItem(PAGE_SIZE_KEY, value); } catch { /* ignore */ } toast.success("Default page size saved for this browser."); };

  const active = modelInfo?.active;
  const m = active?.metrics || {};
  const dirty = settings && SETTINGS.some(({ key }) => Number(draft[key]) !== Number(settings[key]));
  const lastSaved = settings?._meta && Object.values(settings._meta).filter((x) => x.updated_at).sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1))[0];

  return <div className="flex flex-col gap-space-md">
    <PageHeader eyebrow="Governance · Access Control · Model Operations" title="Admin & Settings" subtitle={isSuper ? "Manage administrator access, model versions, thresholds and the audit trail." : "Read-only view: auditors can review model telemetry and the security audit trail."} />

    <section className="grid grid-cols-1 gap-space-md xl:grid-cols-2">
      <Card className="p-space-lg">
        <h2 className="font-label-sm text-label-sm uppercase tracking-wider text-outline">Current session identity</h2>
        <div className="mt-3 flex items-center gap-4"><span className="flex h-14 w-14 items-center justify-center rounded-xl bg-primary-container font-headline-md text-on-primary">{initials(profile?.full_name)}</span><div className="min-w-0"><p className="truncate font-headline-md text-headline-md text-primary">{profile?.full_name}</p><p className="truncate font-body-sm text-on-surface-variant">{profile?.email}</p><div className="mt-1 flex flex-wrap gap-2"><Badge tone="dark">{ROLE_LABEL[profile?.role] || profile?.role}</Badge>{profile?.department && <Badge>{profile.department}</Badge>}<Badge tone="info">{authMode === "local" ? "Local demo auth" : "Supabase Auth"}</Badge></div></div></div>
        <dl className="mt-4 grid grid-cols-2 gap-3 font-body-sm"><div className="rounded-lg bg-surface-container-low p-3"><dt className="font-label-sm text-label-sm text-outline">Last sign-in</dt><dd className="text-on-surface">{dateTime(lastSignInAt)}</dd></div><div className="rounded-lg bg-surface-container-low p-3"><dt className="font-label-sm text-label-sm text-outline">Data backend</dt><dd className="text-on-surface">{system?.data_backend === "local" ? "Local JSON store (demo)" : system ? "Supabase Postgres + RLS" : "—"}</dd></div></dl>
      </Card>
      <Card className="p-space-lg">
        <div className="flex items-start justify-between gap-2"><h2 className="font-label-sm text-label-sm uppercase tracking-wider text-outline">Production ML telemetry</h2><Button variant="secondary" onClick={runDiagnostic} loading={diagBusy}><Icon>monitor_heart</Icon>Run diagnostic</Button></div>
        {modelError ? <p className="mt-3 font-body-sm text-error">{modelError}</p> : !modelInfo ? <Skeleton className="mt-3 h-28" /> : !active ? <p className="mt-3 font-body-sm text-error">No model is loaded.</p> : <>
          <p className="mt-2 font-headline-sm text-headline-sm text-primary">{active.algorithm} · <span className="font-label-md text-label-md">{active.version}</span></p>
          <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-6">{[["Accuracy", pct(m.accuracy)], ["Precision", pct(m.precision)], ["Recall", pct(m.recall)], ["F1", m.f1?.toFixed(3)], ["ROC-AUC", m.roc_auc?.toFixed(3)], ["CV AUC", `${m.cv_mean?.toFixed(3)}`]].map(([l, v]) => <div key={l} className="rounded-lg bg-surface-container-low p-2 text-center"><p className="font-label-sm text-[10px] uppercase text-outline">{l}</p><p className="font-label-md text-label-md tabular-nums text-primary">{v}</p></div>)}</div>
          <p className="mt-2 font-label-sm text-label-sm text-outline">Trained {dateTime(active.trained_at)} on {active.training_rows?.toLocaleString("en-IN")} rows ({active.dataset_source}).</p>
        </>}
        {diagnostic && <div className="mt-3 grid grid-cols-3 gap-2 rounded-lg bg-secondary-fixed/40 p-3 font-label-sm text-label-sm" aria-live="polite"><span>API: <strong>{diagnostic.health.status}</strong> · DB {diagnostic.health.db}</span><span>Health {diagnostic.healthMs.toFixed(0)} ms</span><span>Sample predict {diagnostic.predictMs.toFixed(0)} ms</span></div>}
      </Card>
    </section>

    {isSuper && <Card className="p-space-lg">
      <div className="mb-space-md flex flex-col gap-3 md:flex-row md:items-end md:justify-between"><div><h2 className="flex items-center gap-2 font-headline-md text-headline-md text-primary"><Icon className="text-secondary">admin_panel_settings</Icon>Role-based access control</h2><p className="font-body-sm text-on-surface-variant">Administrators are created here, never self-registered. The last active super admin cannot be removed.</p></div><div className="flex flex-wrap gap-2"><label className="relative"><Icon className="absolute left-2 top-2.5 text-[18px] text-outline">search</Icon><input value={userSearch} onChange={(e) => setUserSearch(e.target.value)} placeholder="Search name or email…" aria-label="Search administrators" className="h-10 w-52 rounded-lg bg-surface-container-low pl-8 pr-3 font-body-sm outline-none focus:ring-2 focus:ring-secondary/30" /></label><Select aria-label="Role filter" value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)} options={[{ value: "", label: "All roles" }, ...ROLES]} /><Button onClick={() => setAddOpen(true)}><Icon>person_add</Icon>Add admin</Button></div></div>
      {users == null ? <Skeleton className="h-40" /> : users.length === 0 ? <EmptyState icon="group" title="No administrators match" /> : <DataTable getRowKey={(u) => u.user_id} rows={users} columns={[
        { key: "full_name", label: "Administrator", render: (v, u) => <div className="flex items-center gap-2.5"><span className="flex h-8 w-8 items-center justify-center rounded-full bg-surface-container font-label-sm text-label-sm text-primary">{initials(v)}</span><div><p className="font-body-sm font-semibold">{v}{u.user_id === profile?.user_id && <span className="ml-1 font-label-sm text-label-sm text-secondary">(you)</span>}</p><p className="font-label-sm text-label-sm text-outline">{u.email}</p></div></div> },
        { key: "role", label: "Role", render: (v, u) => <select aria-label={`Role for ${u.full_name}`} value={v} onChange={(e) => changeUser(u, { role: e.target.value })} className="h-9 rounded bg-surface-container-low px-2 font-label-sm text-label-sm">{ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}</select> },
        { key: "department", label: "Dept", render: (v) => v || "—" },
        { key: "last_sign_in_at", label: "Last sign-in", render: (v) => <span className="font-label-sm text-label-sm">{v ? relativeTime(v) : "Never"}</span> },
        { key: "is_active", label: "Status", render: (v) => <Badge tone={v ? "success" : "neutral"}>{v ? "Active" : "Deactivated"}</Badge> },
        { key: "actions", label: "", align: "right", render: (_, u) => u.user_id === profile?.user_id ? null : <Button variant={u.is_active ? "secondary" : "accent"} onClick={() => setConfirm(u)}>{u.is_active ? "Deactivate" : "Activate"}</Button> },
      ]} />}
    </Card>}

    {modelInfo && <Card className="p-space-lg">
      <div className="mb-space-md flex flex-col gap-3 md:flex-row md:items-start md:justify-between"><div><h2 className="flex items-center gap-2 font-headline-md text-headline-md text-primary"><Icon className="text-secondary">model_training</Icon>Model governance</h2><p className="font-body-sm text-on-surface-variant">Versions are stored on disk under ml/artifacts/versions. Retraining runs in the background and hot-reloads the API.</p></div>{isSuper && <Button onClick={retrain} loading={job && ["queued", "running"].includes(job.status)}><Icon>restart_alt</Icon>Retrain model</Button>}</div>
      {job && <div className={`mb-4 rounded-lg p-3 font-body-sm ${job.status === "failed" ? "bg-error-container text-on-error-container" : "bg-secondary-fixed/50 text-on-surface"}`} aria-live="polite"><strong>Retrain job {job.id}:</strong> {job.status}{job.version ? ` → ${job.version}` : ""}{job.error ? ` — ${job.error}` : ""}{job.note ? ` (${job.note})` : ""}{["queued", "running"].includes(job.status) && <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-container"><div className="h-full w-1/3 animate-pulse rounded-full bg-gradient-to-r from-[#4338CA] to-[#38BDF8]" /></div>}</div>}
      {active && <div className="grid grid-cols-1 gap-space-md xl:grid-cols-3">
        <div><h3 className="mb-2 font-headline-sm text-headline-sm text-primary">Feature vector</h3><ul className="space-y-1">{active.features.map((f) => <li key={f} className="flex items-center justify-between rounded bg-surface-container-low px-3 py-1.5 font-body-sm"><span>{FEATURE_LABELS[f] || f}</span><Badge tone="success">used</Badge></li>)}{active.unused_by_model.map((f) => <li key={f} className="flex items-center justify-between rounded bg-surface-container-low px-3 py-1.5 font-body-sm text-outline"><span>{FEATURE_LABELS[f] || f}</span><Badge>not in training data</Badge></li>)}</ul><p className="mt-2 font-label-sm text-label-sm text-outline">Leakage guard: placement_status, company and package_lpa are never features.</p></div>
        <div><h3 className="mb-2 font-headline-sm text-headline-sm text-primary">Calibration curve</h3><LazyPlot height={260} data={[{ type: "scatter", mode: "lines", name: "Perfect", x: [0, 1], y: [0, 1], line: { dash: "dash", color: chartColors.slate } }, { type: "scatter", mode: "lines+markers", name: "Model", x: active.calibration_curve?.mean_predicted_probability || [], y: active.calibration_curve?.fraction_positive || [], line: { color: chartColors.indigo }, hovertemplate: "predicted %{x:.2f} → observed %{y:.2f}<extra></extra>" }]} layout={{ xaxis: { title: { text: "Mean predicted" }, range: [0, 1] }, yaxis: { title: { text: "Observed placed" }, range: [0, 1] }, margin: { t: 8, l: 50, r: 8, b: 70 } }} /></div>
        <div><h3 className="mb-2 font-headline-sm text-headline-sm text-primary">Feature importance</h3><LazyPlot height={260} data={[{ type: "bar", orientation: "h", y: [...(active.feature_importances || [])].reverse().map((f) => FEATURE_LABELS[f.feature] || f.feature), x: [...(active.feature_importances || [])].reverse().map((f) => f.importance), marker: { color: chartColors.navy }, hovertemplate: "%{y}: %{x:.4f}<extra></extra>" }]} layout={{ margin: { t: 8, l: 150, r: 8, b: 40 } }} /></div>
      </div>}
      <h3 className="mb-2 mt-space-md font-headline-sm text-headline-sm text-primary">Versions</h3>
      {modelInfo.versions.length === 0 ? <p className="font-body-sm text-on-surface-variant">No versioned artifacts yet.</p> : <DataTable getRowKey={(v) => v.version} rows={modelInfo.versions} columns={[{ key: "version", label: "Version", render: (v, r) => <span className="font-label-md text-label-md">{v} {r.is_active && <Badge tone="success">active</Badge>}</span> }, { key: "algorithm", label: "Algorithm" }, { key: "metrics", label: "ROC-AUC / Acc.", render: (mm) => <span className="font-label-sm text-label-sm tabular-nums">{mm?.roc_auc?.toFixed(3)} / {pct(mm?.accuracy)}</span> }, { key: "dataset_source", label: "Data" }, { key: "trained_at", label: "Trained", render: dateTime }, { key: "actions", label: "", align: "right", render: (_, r) => isSuper && !r.is_active ? <Button variant="secondary" onClick={() => activate(r.version)}>Activate</Button> : null }]} />}
    </Card>}

    {isSuper && settings && <Card className="p-space-lg">
      <div className="mb-space-md flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between"><div><h2 className="flex items-center gap-2 font-headline-md text-headline-md text-primary"><Icon className="text-secondary">tune</Icon>Thresholds & cutoffs</h2><p className="font-body-sm text-on-surface-variant">{lastSaved ? `Last saved ${relativeTime(lastSaved.updated_at)}${lastSaved.updated_by ? ` by ${users?.find((u) => u.user_id === lastSaved.updated_by)?.full_name || "an administrator"}` : ""}.` : "Defaults in use."}</p></div><div className="flex gap-2"><Button variant="secondary" disabled={!dirty} onClick={() => setDraft(Object.fromEntries(SETTINGS.map(({ key }) => [key, settings[key]])))}>Discard</Button><Button disabled={!dirty} onClick={() => setSaveOpen(true)}><Icon>save</Icon>Save changes</Button></div></div>
      <div className="grid grid-cols-1 gap-x-8 gap-y-5 md:grid-cols-2 xl:grid-cols-3">{SETTINGS.map((s) => <label key={s.key} className="flex flex-col gap-1.5"><span className="flex items-center justify-between font-body-sm font-semibold text-on-surface">{s.label}<span className="font-label-md text-label-md text-secondary">{s.format(draft[s.key])}</span></span><input type="range" min={s.min} max={s.max} step={s.step} value={draft[s.key] ?? s.min} onChange={(e) => setDraft((d) => ({ ...d, [s.key]: e.target.value }))} className="h-10 w-full accent-[#4e45d5]" aria-label={s.label} /><span className="font-label-sm text-label-sm text-outline">{s.help}</span></label>)}</div>
    </Card>}

    <Card className="p-space-lg">
      <h2 className="flex items-center gap-2 font-headline-md text-headline-md text-primary"><Icon className="text-secondary">settings</Icon>System preferences</h2>
      <dl className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4 font-body-sm">
        <div className="rounded-lg bg-surface-container-low p-3"><dt className="font-label-sm text-label-sm text-outline">API base URL (read-only)</dt><dd className="break-all font-label-md text-label-md">{apiBaseUrl}</dd></div>
        <div className="rounded-lg bg-surface-container-low p-3"><dt className="font-label-sm text-label-sm text-outline">Allowed CORS origins (read-only)</dt><dd className="break-all font-label-sm text-label-sm">{system?.cors_origins?.join(", ") || "—"}</dd></div>
        <div className="rounded-lg bg-surface-container-low p-3"><dt className="font-label-sm text-label-sm text-outline">Rate limits</dt><dd className="font-label-sm text-label-sm">{system ? `${system.rate_limits.predict_per_min}/min predict · ${system.rate_limits.import_per_min}/min import` : "—"}</dd></div>
        <div className="rounded-lg bg-surface-container-low p-3"><dt className="font-label-sm text-label-sm text-outline">Default table page size (this browser)</dt><dd><select aria-label="Default page size" value={pageSize} onChange={(e) => changePageSize(e.target.value)} className="mt-1 h-9 rounded bg-surface-container-lowest px-2 font-label-md">{["10", "25", "50"].map((v) => <option key={v} value={v}>{v} rows</option>)}</select></dd></div>
      </dl>
    </Card>

    <AuditTrail />

    <AddAdminModal open={addOpen} onClose={() => setAddOpen(false)} onCreated={loadUsers} />
    <ConfirmDialog open={Boolean(confirm)} title={confirm?.is_active ? "Deactivate administrator" : "Activate administrator"} message={confirm ? `${confirm.is_active ? "Deactivate" : "Re-activate"} ${confirm.full_name} (${confirm.email})? ${confirm.is_active ? "They will lose access immediately." : "They will be able to sign in again."}` : ""} confirmText={confirm?.is_active ? "Deactivate" : "Activate"} destructive={confirm?.is_active} onCancel={() => setConfirm(null)} onConfirm={() => { changeUser(confirm, { is_active: !confirm.is_active }); setConfirm(null); }} />
    <ConfirmDialog open={saveOpen} title="Save thresholds" message={`Save ${SETTINGS.filter(({ key }) => settings && Number(draft[key]) !== Number(settings[key])).map((s) => `${s.label} → ${s.format(draft[s.key])}`).join("; ")}? Predictions, dashboard targets and skill-gap analysis will use the new values immediately.`} confirmText={saving ? "Saving…" : "Save"} onCancel={() => setSaveOpen(false)} onConfirm={saveSettings} />
  </div>;
}
