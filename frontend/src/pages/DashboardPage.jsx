import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import { analyticsService } from "../services/analyticsService.js";
import { useAuth } from "../context/AuthContext.jsx";
import LazyPlot from "../components/charts/LazyPlot.jsx";
import { chartColors, statusColors } from "../components/charts/PlotlyChart.jsx";
import BatchInferenceModal from "../components/BatchInferenceModal.jsx";
import { ImportModal, StudentFormModal } from "./StudentModals.jsx";
import { Badge, Button, Card, EmptyState, ErrorState, Icon, PageHeader, ProgressBar, Segmented, Select, Skeleton } from "../components/ui/index.jsx";
import { DEPARTMENT_OPTIONS, lpa, num, pct, relativeTime } from "../utils/format.js";
import { saveResponse } from "../utils/download.js";

const STATUS_PILLS = [{ value: "", label: "All" }, { value: "placed", label: "Placed" }, { value: "in_process", label: "In Process" }, { value: "not_placed", label: "Not Placed" }];
const STATUS_TEXT = { placed: "Placed with verified offer", in_process: "In process / final rounds", not_placed: "Not placed", opted_out: "Opted out (higher studies)" };
const ACTION_ICONS = { create: "person_add", update: "edit", delete: "delete", predict: "online_prediction", predict_batch: "dynamic_feed", import: "upload_file", export: "download", sync: "sync", retrain: "model_training", activate: "published_with_changes" };

function Delta({ value, suffix = "", percent = false }) {
  if (value == null) return null;
  const up = value >= 0;
  const text = percent ? `${up ? "+" : ""}${(value * 100).toFixed(1)} pts` : `${up ? "+" : ""}${value}${suffix}`;
  return <span className={`inline-flex items-center gap-1 rounded px-2 py-0.5 font-label-sm text-label-sm ${up ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-800"}`}><Icon className="text-[14px]">{up ? "trending_up" : "trending_down"}</Icon>{text} YoY</span>;
}

function Kpi({ label, icon, children, footer }) {
  return <Card className="flex flex-col justify-between gap-4 p-space-lg"><div className="flex items-start justify-between gap-3"><p className="font-label-sm text-label-sm uppercase tracking-wider text-outline">{label}</p><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-container text-secondary"><Icon className="text-[20px]">{icon}</Icon></span></div><div className="space-y-3">{children}</div>{footer && <div className="flex flex-wrap items-center gap-2 border-t border-surface-container pt-3">{footer}</div>}</Card>;
}

function auditText(row) {
  const m = row.meta || {};
  const who = row.actor_name || "System";
  switch (row.action) {
    case "predict": return `${who} saved a prediction: ${m.label === "placed" ? "likely placed" : "at risk"} (${pct(m.probability)}) with ${m.model_version}.`;
    case "predict_batch": return `${who} ran batch inference on ${m.count} students — ${m.placed_pred} predicted placed, ${m.at_risk} at risk.`;
    case "import": return `${who} imported students: ${m.inserted} added, ${m.updated} updated, ${m.failed} failed.`;
    case "export": return `${who} exported ${row.entity.replaceAll("_", " ")}${m.row_count != null ? ` (${m.row_count} rows)` : ""}.`;
    case "sync": return `${who} recomputed skill flags for ${m.evaluated} students.`;
    case "update": return `${who} updated ${row.entity.replaceAll("_", " ")}${m.fields ? `: ${m.fields.join(", ")}` : m.keys ? `: ${m.keys.join(", ")}` : m.remediation_status !== undefined ? ` → remediation ${m.remediation_status || "cleared"}` : ""}.`;
    case "create": return `${who} created a ${row.entity.replaceAll("_", " ")} record${m.usn ? ` (${m.usn})` : m.email ? ` (${m.email})` : ""}.`;
    case "delete": return `${who} deleted a ${row.entity.replaceAll("_", " ")} record.`;
    default: return `${who}: ${row.action} on ${row.entity.replaceAll("_", " ")}.`;
  }
}

export default function DashboardPage() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [filters, setFilters] = useState({ department: "", batch_year: "", status: "" });
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [deptMode, setDeptMode] = useState("pct");
  const [importOpen, setImportOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [batchOpen, setBatchOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const canBatch = ["super_admin", "placement_officer"].includes(profile?.role);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try { setData(await analyticsService.dashboard(filters)); }
    catch (cause) { setError(cause.apiError?.message || "Could not load the dashboard."); }
    finally { setLoading(false); }
  }, [filters]);
  useEffect(() => { load(); }, [load]);

  const refreshActivity = async () => {
    setRefreshing(true);
    try { const a = await analyticsService.activity(); setData((d) => ({ ...d, recent_activity: a.items })); } catch { toast.error("Could not refresh the feed."); } finally { setRefreshing(false); }
  };
  const exportSummary = async () => { try { await saveResponse(analyticsService.dashboardSummary(filters), "placement_summary.csv"); toast.success("Summary exported."); } catch (e) { toast.error(e.apiError?.message || "Export failed."); } };

  const k = data?.kpis;
  const outcome = data?.outcome_distribution || {};
  const total = Object.values(outcome).reduce((a, b) => a + b, 0);
  const depts = data?.department_performance || [];
  const lowestTier = data?.cgpa_tiers?.find((t) => t.tier === "tier4");

  return <div className="flex flex-col gap-space-md">
    <PageHeader eyebrow="Operational Intelligence / Cohort Analytics" title="Placement Overview & Executive Dashboard" subtitle={`Live placement figures${filters.batch_year ? ` for batch ${filters.batch_year}` : " across all batches"}${filters.department ? ` · ${filters.department}` : ""}, with model-based risk estimates.`}
      actions={<><Button variant="secondary" onClick={() => setImportOpen(true)}><Icon>upload_file</Icon>Import CSV</Button><Button variant="secondary" onClick={exportSummary}><Icon>download</Icon>Export Summary</Button>{canBatch && <Button variant="accent" onClick={() => setBatchOpen(true)}><Icon>bolt</Icon>Run ML Prediction</Button>}<Button onClick={() => setFormOpen(true)}><Icon>person_add</Icon>Add Student</Button></>} />

    <Card className="flex flex-col gap-3 p-space-md lg:flex-row lg:items-center lg:justify-between">
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center"><span className="flex items-center gap-1.5 font-label-sm text-label-sm uppercase tracking-wider text-outline"><Icon className="text-[18px]">filter_list</Icon>Filter view</span>
        <Select aria-label="Department" value={filters.department} onChange={(e) => setFilters((f) => ({ ...f, department: e.target.value }))} options={DEPARTMENT_OPTIONS} />
        <Select aria-label="Batch" value={filters.batch_year} onChange={(e) => setFilters((f) => ({ ...f, batch_year: e.target.value }))} options={[{ value: "", label: "All batches" }, ...(data?.batches || []).map((b) => ({ value: String(b), label: `${b} passing out` }))]} />
        <Segmented label="Status" value={filters.status} onChange={(status) => setFilters((f) => ({ ...f, status }))} options={STATUS_PILLS} />
      </div>
      {data?.model ? <div className="flex items-center gap-2 font-label-sm text-label-sm text-on-surface-variant"><span className="h-2 w-2 rounded-full bg-secondary" />Model: {data.model.algorithm} · accuracy {pct(data.model.accuracy)} · trained {relativeTime(data.model.trained_at)}</div> : <span className="font-label-sm text-label-sm text-error">No model loaded</span>}
    </Card>

    {error ? <ErrorState title="Dashboard unavailable" message={error} onRetry={load} /> : loading && !data ? <div className="grid grid-cols-1 gap-space-md sm:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-48 rounded-xl" />)}</div> : data && <>
      <section className="grid grid-cols-1 gap-space-md sm:grid-cols-2 xl:grid-cols-4" aria-label="Key metrics">
        <Kpi label="Total eligible students" icon="groups" footer={<><Delta value={k.yoy.previous ? k.total_eligible - k.yoy.previous.total_eligible : null} />{k.yoy.previous_batch && <span className="font-label-sm text-label-sm text-outline">vs {k.yoy.previous.total_eligible} in {k.yoy.previous_batch}</span>}</>}>
          <p className="font-headline-xl text-headline-xl tabular-nums text-primary">{k.total_eligible}</p>
          <div className="flex justify-between font-body-sm text-on-surface-variant"><span>Registered</span><span className="tabular-nums">{k.total_students}</span></div>
          <div className="flex justify-between font-body-sm text-on-surface-variant"><span>Opted out (higher studies)</span><span className="tabular-nums">{k.opted_out}</span></div>
        </Kpi>
        <Kpi label="Students placed" icon="verified" footer={<Badge tone="info"><Icon className="text-[14px]">apartment</Icon>{k.recruiting_companies} recruiting companies</Badge>}>
          <p className="font-headline-xl text-headline-xl tabular-nums text-primary">{k.placed}</p>
          <div><div className="mb-1 flex justify-between font-body-sm text-on-surface-variant"><span>Placed / eligible</span><span className="tabular-nums">{k.placed} / {k.total_eligible}</span></div><ProgressBar value={k.total_eligible ? (k.placed / k.total_eligible) * 100 : 0} /></div>
          <div className="flex justify-between font-body-sm text-on-surface-variant"><span>In process</span><span className="tabular-nums">{k.in_process}</span></div>
        </Kpi>
        <Kpi label="Overall placement rate" icon="trending_up" footer={<><Delta value={k.yoy.placement_rate} percent />{k.yoy.previous && <span className="font-label-sm text-label-sm text-outline">{pct(k.yoy.previous.placement_rate)} in {k.yoy.previous_batch}</span>}</>}>
          <p className="font-headline-xl text-headline-xl tabular-nums text-primary">{pct(k.placement_rate)} <span className="font-label-md text-label-md text-outline">/ target {pct(k.target_rate, 0)}</span></p>
          <div><div className="mb-1 flex justify-between font-body-sm text-on-surface-variant"><span>Progress to target</span><span className="tabular-nums">{k.placement_rate != null && k.target_rate ? pct(Math.min(1, k.placement_rate / k.target_rate)) : "—"}</span></div><ProgressBar value={k.placement_rate != null ? Math.min(100, (k.placement_rate / k.target_rate) * 100) : 0} /></div>
          <div className="flex justify-between font-body-sm"><span className="text-on-surface-variant">Delta to target</span><span className={k.students_to_target ? "font-semibold text-error" : "font-semibold text-emerald-700"}>{k.students_to_target ? `${k.students_to_target} students needed` : "Target reached"}</span></div>
        </Kpi>
        <Kpi label="Average placed CGPA" icon="grade" footer={<><Delta value={k.yoy.avg_placed_cgpa} /><span className="font-label-sm text-label-sm text-outline">{data.predicted_students} students with saved predictions</span></>}>
          <p className="font-headline-xl text-headline-xl tabular-nums text-primary">{num(k.avg_placed_cgpa)} <span className="font-label-md text-label-md text-outline">/ 10.0</span></p>
          <div className="flex justify-between font-body-sm text-on-surface-variant"><span>Observed band</span><span className="tabular-nums">{k.min_placed_cgpa != null ? `${num(k.min_placed_cgpa)} – ${num(k.max_placed_cgpa)}` : "—"}</span></div>
          <div className="flex justify-between font-body-sm text-on-surface-variant"><span>Median package</span><span className="tabular-nums">{lpa(data.median_package_lpa)}</span></div>
        </Kpi>
      </section>

      <section className="grid grid-cols-1 gap-space-md xl:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <Card className="p-space-lg">
          <h2 className="font-headline-md text-headline-md text-primary">Cohort Outcome Distribution</h2><p className="font-body-sm text-on-surface-variant">Status split across all {total} students in view</p>
          {total === 0 ? <EmptyState icon="donut_large" title="No students in view" /> : <>
            <LazyPlot height={260} data={[{ type: "pie", hole: 0.7, sort: false, labels: Object.keys(outcome).map((s) => STATUS_TEXT[s]), values: Object.values(outcome), marker: { colors: Object.keys(outcome).map((s) => statusColors[s]) }, textinfo: "none", hovertemplate: "%{label}: %{value} (%{percent})<extra></extra>" }]} layout={{ showlegend: false, margin: { t: 8, b: 8, l: 8, r: 8 }, annotations: [{ text: `<b>${total}</b><br><span style="font-size:11px">TOTAL COHORT</span>`, showarrow: false, font: { size: 26, color: "#070235" } }] }} />
            <ul className="mt-2 space-y-2">{Object.entries(outcome).map(([s, v]) => <li key={s} className="flex items-center justify-between gap-2 font-body-sm"><span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full" style={{ background: statusColors[s] }} />{STATUS_TEXT[s]}</span><span className="font-label-md text-label-md tabular-nums">{v} ({total ? ((v / total) * 100).toFixed(1) : 0}%)</span></li>)}</ul>
          </>}
        </Card>
        <Card className="p-space-lg">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between"><div><h2 className="font-headline-md text-headline-md text-primary">Department-wise Placement Performance</h2><p className="font-body-sm text-on-surface-variant">Placed vs. eligible (opted-out excluded). Click a bar to open that department's students.</p></div><Segmented label="Department chart mode" value={deptMode} onChange={setDeptMode} options={[{ value: "pct", label: "Percentage" }, { value: "count", label: "Counts" }]} /></div>
          {depts.length === 0 ? <EmptyState icon="bar_chart" title="No departments in view" /> : <>
            <LazyPlot height={260} onClick={(e) => { const d = e.points?.[0]?.y; if (d) navigate(`/students?department=${d}`); }} data={deptMode === "pct" ? [{ type: "bar", orientation: "h", y: depts.map((d) => d.department), x: depts.map((d) => (d.rate || 0) * 100), marker: { color: depts.map((d, i) => [chartColors.navy, chartColors.indigo, chartColors.violet, chartColors.sky][i % 4]) }, text: depts.map((d) => `${((d.rate || 0) * 100).toFixed(1)}%`), textposition: "auto", hovertemplate: "%{y}: %{x:.1f}% placed<extra></extra>" }] : [{ type: "bar", orientation: "h", name: "Eligible", y: depts.map((d) => d.department), x: depts.map((d) => d.eligible), marker: { color: chartColors.lavender } }, { type: "bar", orientation: "h", name: "Placed", y: depts.map((d) => d.department), x: depts.map((d) => d.placed), marker: { color: chartColors.navy } }]} layout={{ barmode: "group", margin: { l: 56, r: 16, t: 8, b: 36 }, xaxis: { range: deptMode === "pct" ? [0, 100] : undefined, ticksuffix: deptMode === "pct" ? "%" : "" }, yaxis: { autorange: "reversed" }, showlegend: deptMode === "count" }} />
            <ul className="mt-2 grid grid-cols-1 gap-1 sm:grid-cols-2">{depts.map((d) => <li key={d.department} className="flex justify-between rounded bg-surface-container-low px-3 py-2 font-label-sm text-label-sm"><Link className="text-primary hover:underline" to={`/students?department=${d.department}`}>{d.department}</Link><span className="tabular-nums text-on-surface-variant">{d.placed} / {d.eligible} placed · {pct(d.rate)}</span></li>)}</ul>
          </>}
        </Card>
      </section>

      <section className="grid grid-cols-1 gap-space-md xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <Card className="p-space-lg">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between"><div><h2 className="font-headline-md text-headline-md text-primary">CGPA vs Placement Probability Matrix</h2><p className="font-body-sm text-on-surface-variant">Actual placement rate per CGPA tier, with the model's mean predicted probability where predictions exist.</p></div><Badge tone="info">Threshold {pct(data.threshold, 0)}</Badge></div>
          <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">{data.cgpa_tiers.map((t, i) => <div key={t.tier} className={`rounded-xl p-4 ${t.tier === "tier4" ? "bg-error-container/40" : "bg-surface-container-low"}`}><p className={`font-label-sm text-label-sm uppercase ${t.tier === "tier4" ? "text-error" : "text-outline"}`}>Tier {i + 1} ({t.label})</p><p className={`mt-2 font-headline-lg text-headline-lg tabular-nums ${t.tier === "tier4" ? "text-error" : "text-primary"}`}>{pct(t.rate, 0)}</p><p className="font-body-sm text-on-surface-variant">Actual placement rate</p><div className="mt-2 h-1.5 rounded-full bg-surface-container-high"><div className={`h-full rounded-full ${t.tier === "tier4" ? "bg-error" : "bg-primary-container"}`} style={{ width: `${(t.rate || 0) * 100}%` }} /></div><p className="mt-2 font-label-sm text-label-sm text-outline">{t.candidates} candidates · model {t.avg_predicted_probability == null ? "n/a" : pct(t.avg_predicted_probability, 0)}</p></div>)}</div>
          <div className="mt-4 flex flex-col gap-3 rounded-xl bg-primary-container p-4 text-on-primary sm:flex-row sm:items-center sm:justify-between"><p className="flex items-start gap-2 font-body-sm"><Icon className="text-tertiary-fixed-dim">auto_awesome</Icon><span>{data.at_risk_count > 0 ? `${data.at_risk_count} active student${data.at_risk_count === 1 ? "" : "s"} have a latest predicted probability below ${pct(data.threshold, 0)}.` : data.predicted_students ? "No active students are below the risk threshold." : "No saved predictions yet — run batch inference to identify at-risk students."}{lowestTier?.candidates ? ` ${lowestTier.candidates} students sit in the < 7.0 CGPA tier.` : ""}</span></p><Link to="/skill-gap?severity=critical" className="shrink-0 rounded-lg bg-surface-container-lowest px-4 py-2 text-center font-label-sm text-label-sm font-semibold text-primary hover:bg-secondary-fixed">Review skill gaps</Link></div>
        </Card>
        <Card className="p-space-lg">
          <div className="flex items-start justify-between gap-2"><div><h2 className="font-headline-md text-headline-md text-primary">Top Recruiting Partners</h2><p className="font-body-sm text-on-surface-variant">Hires and compensation by company</p></div><div className="text-right"><p className="font-label-md text-label-md text-primary">{lpa(data.median_package_lpa)}</p><p className="font-label-sm text-label-sm text-outline">median package</p></div></div>
          {data.top_recruiters.length === 0 ? <EmptyState icon="apartment" title="No placements recorded yet" /> : <ul className="mt-3 divide-y divide-surface-container">{data.top_recruiters.map((r) => <li key={r.company} className="flex items-center justify-between gap-3 py-3"><div className="flex min-w-0 items-center gap-3"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-container font-headline-sm text-primary">{r.company[0]}</span><div className="min-w-0"><p className="truncate font-body-md font-semibold text-on-surface">{r.company}</p><p className="font-label-sm text-label-sm text-outline">{r.hires} hire{r.hires === 1 ? "" : "s"}</p></div></div><div className="shrink-0 text-right font-label-sm text-label-sm"><p className="text-primary">{lpa(r.max_package_lpa)} max</p><p className="text-outline">{lpa(r.avg_package_lpa)} avg</p></div></li>)}</ul>}
        </Card>
      </section>

      <Card className="p-space-lg">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between"><div><h2 className="flex items-center gap-2 font-headline-md text-headline-md text-primary">Real-Time Operational Audit Feed <span className="h-2 w-2 rounded-full bg-secondary" /></h2><p className="font-body-sm text-on-surface-variant">Latest writes, imports, predictions and exports.</p></div><Button variant="secondary" onClick={refreshActivity} loading={refreshing}><Icon>refresh</Icon>Refresh feed</Button></div>
        {!data.activity_visible ? <p className="mt-4 rounded-lg bg-surface-container-low p-4 font-body-sm text-on-surface-variant">The audit feed is visible to super admins and auditors.</p> : data.recent_activity.length === 0 ? <EmptyState icon="history" title="No activity yet" /> : <ul className="mt-4 space-y-3">{data.recent_activity.map((row) => <li key={row.id} className="flex gap-3"><span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${row.action === "delete" ? "bg-error-container text-error" : "bg-secondary-fixed text-secondary"}`}><Icon className="text-[18px]">{ACTION_ICONS[row.action] || "history"}</Icon></span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span className="font-body-sm font-semibold text-on-surface">{row.student?.full_name || row.actor_name || "System"}</span>{row.student && <span className="font-label-sm text-label-sm text-outline">{row.student.usn}</span>}<Badge tone={row.action === "delete" ? "danger" : row.action.startsWith("predict") ? "info" : "neutral"}>{row.action.replaceAll("_", " ")}</Badge></div><p className="font-body-sm text-on-surface-variant">{auditText(row)}</p></div><span className="shrink-0 font-label-sm text-label-sm text-outline">{relativeTime(row.created_at)}</span></li>)}</ul>}
      </Card>
    </>}

    <ImportModal open={importOpen} onClose={() => setImportOpen(false)} onImported={load} />
    <StudentFormModal open={formOpen} student={null} onClose={() => setFormOpen(false)} onSaved={load} />
    <BatchInferenceModal open={batchOpen} onClose={() => setBatchOpen(false)} onDone={load} batches={data?.batches || []} />
  </div>;
}
