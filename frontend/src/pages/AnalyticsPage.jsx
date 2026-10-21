import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";
import { analyticsService } from "../services/analyticsService.js";
import LazyPlot from "../components/charts/LazyPlot.jsx";
import { chartColors, statusColors } from "../components/charts/PlotlyChart.jsx";
import { Badge, Button, Card, DataTable, EmptyState, ErrorState, FilterChip, Icon, PageHeader, Segmented, Select, Skeleton } from "../components/ui/index.jsx";
import { AXIS_LABELS, DEPARTMENT_OPTIONS, dateTime, lpa, num, pct } from "../utils/format.js";
import { saveResponse } from "../utils/download.js";

const EMPTY = { department: "", batch_year: "", status: "" };
const STATUS_OPTIONS = [{ value: "", label: "All outcomes" }, { value: "placed", label: "Placed" }, { value: "in_process", label: "In process" }, { value: "not_placed", label: "Not placed" }, { value: "opted_out", label: "Opted out" }];
const TIER_META = {
  super_dream: { label: "Super Dream", color: chartColors.navy },
  dream: { label: "Dream", color: chartColors.indigo },
  high_potential: { label: "High Potential", color: chartColors.violet },
  core_it: { label: "Core & IT Services", color: chartColors.lavender },
};
const PRESETS = [
  { key: "department-ledger.csv", title: "Department Placement Ledger", format: "CSV", icon: "table_view", description: "Enrolled, eligible, placed, rate, average/top package and dream offers per department." },
  { key: "company-audit.xlsx", title: "Company-wise Hiring Audit", format: "XLSX", icon: "apartment", description: "Summary sheet plus one sheet per recruiter listing each placed student, CGPA and package." },
  { key: "students.csv", title: "Student Outcome Register", format: "CSV", icon: "badge", description: "Row-level register of every student in the filtered cohort with scores and outcome." },
];

function KpiCard({ label, value, badge, children }) {
  return <Card className="flex flex-col gap-2 p-space-lg"><div className="flex items-start justify-between gap-2"><p className="font-label-sm text-label-sm uppercase tracking-wider text-outline">{label}</p>{badge}</div><p className="font-headline-xl text-headline-xl tabular-nums text-primary">{value}</p><div className="font-body-sm text-on-surface-variant">{children}</div></Card>;
}

export default function AnalyticsPage() {
  const [draft, setDraft] = useState(EMPTY);
  const [filters, setFilters] = useState(EMPTY);
  const [state, setState] = useState({ loading: true, error: "", overview: null, departments: null, correlation: null, packages: null, skills: null });
  const [history, setHistory] = useState(null);
  const [deptView, setDeptView] = useState("chart");
  const [downloading, setDownloading] = useState("");

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: "" }));
    try {
      const [overview, departments, correlation, packages, skills] = await Promise.all([
        analyticsService.overview(filters), analyticsService.departments(filters), analyticsService.correlation(filters),
        analyticsService.packages(filters), analyticsService.skills(filters),
      ]);
      setState({ loading: false, error: "", overview, departments, correlation, packages, skills });
    } catch (error) {
      setState((s) => ({ ...s, loading: false, error: error.apiError?.message || "Could not load analytics." }));
    }
  }, [filters]);
  const loadHistory = useCallback(() => analyticsService.reportHistory().then((d) => setHistory(d.items)).catch(() => setHistory([])), []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadHistory(); }, [loadHistory]);

  const download = async (key) => {
    setDownloading(key);
    try { await saveResponse(analyticsService.report(key, filters), key); toast.success("Report downloaded."); loadHistory(); }
    catch (error) { toast.error(error.apiError?.message || "Report export failed."); }
    finally { setDownloading(""); }
  };

  const { overview: o, departments, correlation, packages, skills } = state;
  const chips = Object.entries(filters).filter(([, v]) => v);
  const deptItems = departments?.items || [];

  return <div className="flex flex-col gap-space-md">
    <PageHeader eyebrow="Cohort Analytics & Institutional Reporting" title="Placement Analytics, Department Benchmarks & Reports" subtitle="Conversion, department benchmarks, CGPA correlation, compensation tiers and skill profiles — computed live from student records, with exportable reports." />

    <Card className="p-space-md">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h2 className="flex items-center gap-2 font-headline-sm text-headline-sm text-primary"><Icon className="text-secondary">tune</Icon>Cohort slicing & analytics filters</h2>{o && <Badge tone="info">Scope: {o.students} students ({o.eligible} opted in)</Badge>}</div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Select label="Department" value={draft.department} onChange={(e) => setDraft((d) => ({ ...d, department: e.target.value }))} options={DEPARTMENT_OPTIONS} />
        <Select label="Graduating batch" value={draft.batch_year} onChange={(e) => setDraft((d) => ({ ...d, batch_year: e.target.value }))} options={[{ value: "", label: "All batches" }, ...(o?.batches || []).map((b) => ({ value: String(b), label: String(b) }))]} />
        <Select label="Outcome status" value={draft.status} onChange={(e) => setDraft((d) => ({ ...d, status: e.target.value }))} options={STATUS_OPTIONS} />
      </div>
      <div className="mt-3 flex flex-col gap-2 border-t border-surface-container pt-3 sm:flex-row sm:items-center sm:justify-between"><div className="flex flex-wrap items-center gap-2"><span className="font-label-sm text-label-sm text-outline">Active constraints:</span>{chips.length ? chips.map(([k, v]) => <FilterChip key={k} onRemove={() => { const next = { ...filters, [k]: "" }; setFilters(next); setDraft(next); }}>{k.replace("_", " ")}: {v}</FilterChip>) : <span className="font-label-sm text-label-sm text-on-surface-variant">None</span>}</div><div className="flex gap-2"><Button variant="secondary" onClick={() => { setDraft(EMPTY); setFilters(EMPTY); }}>Reset</Button><Button onClick={() => setFilters(draft)}><Icon>filter_alt</Icon>Apply filter set</Button></div></div>
    </Card>

    {state.error ? <ErrorState title="Analytics unavailable" message={state.error} onRetry={load} /> : !o ? <div className="grid grid-cols-1 gap-space-md sm:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-40 rounded-xl" />)}</div> : <div className={`flex flex-col gap-space-md transition-opacity ${state.loading ? "opacity-60" : ""}`}>
      <section className="grid grid-cols-1 gap-space-md sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Cohort conversion rate" value={pct(o.conversion_rate)} badge={<Badge tone={o.conversion_rate >= o.target_rate ? "success" : "warning"}>Target {pct(o.target_rate, 0)}</Badge>}>{o.placed} placed out of {o.eligible} opted-in candidates.</KpiCard>
        <KpiCard label="Compensation (median)" value={lpa(o.median_package_lpa)} badge={<Badge>Mean {lpa(o.mean_package_lpa)}</Badge>}>Highest: {lpa(o.max_package_lpa)}{o.max_package_company ? ` (${o.max_package_company})` : ""}</KpiCard>
        <KpiCard label="Inter-branch parity" value={o.inter_branch_parity == null ? "—" : num(o.inter_branch_parity)} badge={<Badge>min ÷ max rate</Badge>}>{o.parity_low ? `Lowest: ${o.parity_low} · Highest: ${o.parity_high}. 1.00 means equal conversion across departments.` : "Needs at least one department with eligible students."}</KpiCard>
        <KpiCard label="Dream-tier share" value={pct(o.tier1_share)} badge={<Badge tone="info">≥ {lpa(o.dream_lpa)}</Badge>}>Share of placed students with a package at or above the dream cutoff (set in Admin).</KpiCard>
      </section>

      <Card className="p-space-lg">
        <div className="mb-space-md flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between"><div><h2 className="font-headline-md text-headline-md text-primary">Department-wise Placement Benchmarking</h2><p className="font-body-sm text-on-surface-variant">Rate = placed ÷ eligible (opted-out students excluded).</p></div><Segmented label="Department view" value={deptView} onChange={setDeptView} options={[{ value: "chart", label: "Graphical" }, { value: "table", label: "Tabular" }]} /></div>
        {deptItems.length === 0 ? <EmptyState icon="domain" title="No departments match these filters" /> : <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">{deptItems.map((d) => <div key={d.department} className="rounded-xl bg-surface-container-low p-4"><div className="flex items-center justify-between"><span className="font-label-sm text-label-sm uppercase tracking-wider text-secondary">Dept. of {d.department}</span><Badge tone="dark">{pct(d.rate)}</Badge></div><p className="mt-3 font-body-sm text-on-surface-variant">Placed candidates <span className="float-right font-label-md text-label-md tabular-nums text-on-surface">{d.placed} / {d.eligible}</span></p><div className="mt-2 h-1.5 rounded-full bg-surface-container-high"><div className="h-full rounded-full bg-primary-container" style={{ width: `${(d.rate || 0) * 100}%` }} /></div><p className="mt-2 font-label-sm text-label-sm text-outline">Avg {lpa(d.avg_package_lpa)} · Top {lpa(d.top_package_lpa)}</p><p className="font-label-sm text-label-sm text-secondary">{d.dream_offers} dream offer{d.dream_offers === 1 ? "" : "s"} (≥ {lpa(departments.dream_lpa)})</p></div>)}</div>
          <div className="mt-space-md">{deptView === "chart" ? <LazyPlot height={320} data={[["Enrolled", "enrolled", chartColors.lavender], ["Eligible (opted in)", "eligible", chartColors.indigo], ["Placed", "placed", chartColors.navy]].map(([name, key, color]) => ({ type: "bar", name, x: deptItems.map((d) => d.department), y: deptItems.map((d) => d[key]), marker: { color }, hovertemplate: `${name}: %{y}<extra>%{x}</extra>` }))} layout={{ barmode: "group", margin: { t: 8, l: 44, r: 8, b: 60 }, xaxis: { type: "category" } }} /> : <DataTable getRowKey={(r) => r.department} rows={deptItems} columns={[{ key: "department", label: "Department" }, { key: "enrolled", label: "Enrolled", align: "right" }, { key: "eligible", label: "Eligible", align: "right" }, { key: "placed", label: "Placed", align: "right" }, { key: "rate", label: "Rate", align: "right", render: (v) => pct(v) }, { key: "avg_package_lpa", label: "Avg package", align: "right", render: lpa }, { key: "top_package_lpa", label: "Top package", align: "right", render: lpa }, { key: "dream_offers", label: "Dream offers", align: "right" }]} />}</div>
        </>}
      </Card>

      <section className="grid grid-cols-1 gap-space-md xl:grid-cols-2">
        <Card className="p-space-lg">
          <div className="flex items-start justify-between gap-2"><div><h2 className="font-headline-md text-headline-md text-primary">CGPA vs. Placement Conversion</h2><p className="font-body-sm text-on-surface-variant">Placement rate per CGPA band, and model probability against CGPA.</p></div><Badge tone="info">r = {correlation.pearson_r == null ? "n/a" : correlation.pearson_r.toFixed(3)}</Badge></div>
          <p className="mt-1 font-label-sm text-label-sm text-outline">Point-biserial correlation between CGPA and placed (1) / not placed (0), n = {correlation.n} students with a final outcome.</p>
          <ul className="mt-4 space-y-3">{correlation.tiers.map((t, i) => <li key={t.label}><div className="flex flex-wrap items-center justify-between gap-2 font-body-sm"><span className={`rounded px-2 py-0.5 font-label-sm text-label-sm ${i === 3 ? "bg-error-container text-error" : i === 0 ? "bg-primary-container text-on-primary" : "bg-secondary-fixed text-on-secondary-fixed-variant"}`}>Tier {i + 1} ({t.label})</span><span className="text-on-surface-variant">{t.students} students · {t.placed} placed ({pct(t.rate)}) · avg {lpa(t.avg_package_lpa)}</span></div><div className="mt-1.5 h-1.5 rounded-full bg-surface-container"><div className={`h-full rounded-full ${i === 3 ? "bg-error" : "bg-secondary"}`} style={{ width: `${(t.rate || 0) * 100}%` }} /></div></li>)}</ul>
          <div className="mt-4">{correlation.points.length === 0 ? <p className="rounded-lg bg-surface-container-low p-3 font-body-sm text-on-surface-variant">The scatter appears once students have saved predictions (run batch inference on the Prediction page).</p> : <LazyPlot height={280} data={Object.keys(statusColors).map((status) => { const pts = correlation.points.filter((p) => p.status === status); return { type: "scatter", mode: "markers", name: status.replace("_", " "), x: pts.map((p) => p.cgpa), y: pts.map((p) => p.probability * 100), text: pts.map((p) => `${p.full_name} (${p.usn})`), marker: { color: statusColors[status], size: 9, opacity: 0.85 }, hovertemplate: "%{text}<br>CGPA %{x} · %{y:.1f}%<extra></extra>" }; }).filter((t) => t.x.length)} layout={{ xaxis: { type: "linear", title: { text: "CGPA" } }, yaxis: { type: "linear", title: { text: "Predicted probability (%)" }, range: [0, 100] }, margin: { t: 8, l: 56, r: 8, b: 70 } }} />}</div>
        </Card>
        <Card className="p-space-lg">
          <div className="flex items-start justify-between gap-2"><div><h2 className="font-headline-md text-headline-md text-primary">Compensation Package Spread</h2><p className="font-body-sm text-on-surface-variant">Offers grouped by the package cutoffs configured in Admin.</p></div><Badge>{packages.values.length} offers</Badge></div>
          {packages.values.length === 0 ? <EmptyState icon="payments" title="No packages recorded" /> : <>
            <div className="mt-4 flex h-3 overflow-hidden rounded-full">{packages.tiers.filter((t) => t.count).map((t) => <div key={t.key} title={`${TIER_META[t.key].label}: ${t.count}`} style={{ width: `${t.share * 100}%`, background: TIER_META[t.key].color }} />)}</div>
            <div className="mt-4 grid grid-cols-2 gap-3">{packages.tiers.map((t) => { const c = packages.cutoffs; const range = { super_dream: `≥ ₹${c.super_dream_lpa} LPA`, dream: `₹${c.dream_lpa} – ${c.super_dream_lpa} LPA`, high_potential: `₹${c.high_potential_lpa} – ${c.dream_lpa} LPA`, core_it: `< ₹${c.high_potential_lpa} LPA` }[t.key]; return <div key={t.key} className="rounded-xl border-l-4 bg-surface-container-low p-3" style={{ borderColor: TIER_META[t.key].color }}><div className="flex justify-between font-label-sm text-label-sm"><span className="text-on-surface">{TIER_META[t.key].label}</span><span className="text-secondary">{pct(t.share)}</span></div><p className="mt-1 font-label-md text-label-md text-primary">{range}</p><p className="font-body-sm text-on-surface-variant">{t.count} offer{t.count === 1 ? "" : "s"}</p></div>; })}</div>
            <div className="mt-4"><LazyPlot height={240} data={[{ type: "bar", x: packages.bins.map((b) => `${b.from}–${b.to}`), y: packages.bins.map((b) => b.count), marker: { color: chartColors.indigo }, hovertemplate: "₹%{x} LPA: %{y} offers<extra></extra>" }]} layout={{ xaxis: { type: "category", title: { text: "Package (₹ LPA)" } }, yaxis: { title: { text: "Offers" } }, margin: { t: 8, l: 48, r: 8, b: 56 } }} /></div>
          </>}
        </Card>
      </section>

      <Card className="p-space-lg">
        <h2 className="font-headline-md text-headline-md text-primary">Skill Profile by Department</h2><p className="font-body-sm text-on-surface-variant">Average of each student's latest skill assessment (0–100).</p>
        {skills.items.length === 0 ? <EmptyState icon="radar" title="No skill assessments in this cohort" /> : <LazyPlot height={300} data={[{ type: "heatmap", x: skills.axes.map((a) => AXIS_LABELS[a]), y: skills.items.map((d) => `${d.department} (${d.assessed})`), z: skills.items.map((d) => skills.axes.map((a) => d[a])), zmin: 40, zmax: 100, colorscale: [[0, "#ffdad6"], [0.45, "#e3dfff"], [1, "#1e1b4b"]], text: skills.items.map((d) => skills.axes.map((a) => d[a]?.toFixed(1))), texttemplate: "%{text}", hovertemplate: "%{y} · %{x}: %{z:.1f}<extra></extra>" }]} layout={{ margin: { t: 8, l: 90, r: 8, b: 70 }, xaxis: { type: "category" }, yaxis: { type: "category", autorange: "reversed" } }} />}
      </Card>
    </div>}

    <Card className="p-space-lg">
      <h2 className="flex items-center gap-2 font-headline-md text-headline-md text-primary"><Icon className="text-secondary">inventory_2</Icon>Export Center & Report Log</h2><p className="font-body-sm text-on-surface-variant">Reports use the filters applied above. Every export is recorded below and in the audit log.</p>
      <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">{PRESETS.map((p, i) => <div key={p.key} className="flex flex-col justify-between gap-3 rounded-xl border border-surface-container bg-surface-container-low p-4"><div><div className="flex items-center justify-between"><Badge tone="dark">Preset {i + 1}</Badge><span className="font-label-sm text-label-sm text-outline">Format: {p.format}</span></div><h3 className="mt-2 flex items-center gap-1.5 font-headline-sm text-headline-sm text-primary"><Icon className="text-[18px] text-secondary">{p.icon}</Icon>{p.title}</h3><p className="mt-1 font-body-sm text-on-surface-variant">{p.description}</p></div><Button variant="secondary" loading={downloading === p.key} onClick={() => download(p.key)}><Icon>download</Icon>Export {p.format}</Button></div>)}</div>
      <h3 className="mb-2 mt-6 font-headline-sm text-headline-sm text-primary">Recent generated reports</h3>
      {history == null ? <Skeleton className="h-24" /> : history.length === 0 ? <p className="font-body-sm text-on-surface-variant">No reports exported yet.</p> : <DataTable rows={history} columns={[{ key: "title", label: "Report" }, { key: "type", label: "Type", render: (v) => <Badge tone={v === "xlsx" ? "success" : "info"}>{v.toUpperCase()}</Badge> }, { key: "scope", label: "Scope", render: (s) => <span className="font-label-sm text-label-sm text-on-surface-variant">{Object.entries(s || {}).map(([k, v]) => `${k}: ${v}`).join(", ") || "All students"}</span> }, { key: "row_count", label: "Rows", align: "right" }, { key: "created_at", label: "Generated", render: dateTime }]} />}
    </Card>
  </div>;
}
