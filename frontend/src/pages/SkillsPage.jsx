import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import toast from "react-hot-toast";
import { skillsService } from "../services/skillsService.js";
import { studentsService } from "../services/studentsService.js";
import { useAuth } from "../context/AuthContext.jsx";
import StudentPicker from "../components/StudentPicker.jsx";
import LazyPlot from "../components/charts/LazyPlot.jsx";
import { chartColors } from "../components/charts/PlotlyChart.jsx";
import { Badge, Button, Card, DataTable, EmptyState, ErrorState, Icon, PageHeader, Select, Skeleton } from "../components/ui/index.jsx";
import { AXIS_LABELS, DEPARTMENT_OPTIONS, initials } from "../utils/format.js";
import { saveResponse } from "../utils/download.js";

const SEVERITY = {
  critical: { label: "Critical gap", tone: "danger", bar: "bg-error" },
  needs_refinement: { label: "Needs refinement", tone: "info", bar: "bg-secondary" },
  meets: { label: "Meets target", tone: "success", bar: "bg-emerald-500" },
  surplus: { label: "Surplus", tone: "success", bar: "bg-emerald-600" },
  unassessed: { label: "Not assessed", tone: "neutral", bar: "bg-outline" },
};
const REMEDIATION = [
  { value: "", label: "No status" },
  { value: "action_required", label: "Action required" },
  { value: "enrolled", label: "Enrolled in programme" },
  { value: "awaiting_retest", label: "Awaiting retest" },
  { value: "benchmark_met", label: "Benchmark met" },
];
const REM_LABEL = Object.fromEntries(REMEDIATION.map((r) => [r.value, r.label]));
const PRIORITY_STYLE = { 1: "border-error", 2: "border-secondary", 3: "border-emerald-500" };
const TIER_TONE = { tier1: "success", tier2: "info", foundation: "warning" };

function AssessmentForm({ student, onSaved }) {
  const [values, setValues] = useState({ dsa: "", system_design: "", core_cs: "", aptitude: "", communication: "" });
  const [busy, setBusy] = useState(false);
  const save = async (event) => {
    event.preventDefault();
    const payload = Object.fromEntries(Object.entries(values).map(([k, v]) => [k, Number(v)]));
    if (Object.values(payload).some((v) => !Number.isInteger(v) || v < 0 || v > 100)) return toast.error("Enter whole-number scores from 0 to 100.");
    setBusy(true);
    try { await skillsService.assess(student.id, { ...payload, source: "manual" }); toast.success("Assessment recorded."); onSaved(); }
    catch (error) { toast.error(error.apiError?.message || "Could not save assessment."); } finally { setBusy(false); }
  };
  return <form onSubmit={save} className="mt-4 rounded-xl bg-surface-container-low p-4 text-left"><p className="mb-3 font-headline-sm text-headline-sm text-primary">Record a skill assessment</p><div className="grid grid-cols-2 gap-3 sm:grid-cols-5">{Object.keys(values).map((k) => <label key={k} className="flex flex-col gap-1"><span className="font-label-sm text-label-sm text-outline">{AXIS_LABELS[k]}</span><input type="number" min="0" max="100" step="1" required value={values[k]} onChange={(e) => setValues((v) => ({ ...v, [k]: e.target.value }))} className="h-10 rounded-lg bg-surface-container-lowest px-3 font-label-md tabular-nums outline-none focus:ring-2 focus:ring-secondary/30" /></label>)}</div><Button type="submit" className="mt-3" loading={busy}><Icon>save</Icon>Save assessment</Button></form>;
}

export default function SkillsPage() {
  const { profile } = useAuth();
  const canWrite = ["super_admin", "placement_officer", "faculty_mentor"].includes(profile?.role);
  const [params, setParams] = useSearchParams();
  const studentParam = params.get("student") || params.get("student_id");
  const [student, setStudent] = useState(null);
  const [gap, setGap] = useState(null);
  const [gapError, setGapError] = useState(null);
  const [gapLoading, setGapLoading] = useState(false);
  const [cohort, setCohort] = useState(null);
  const [cohortError, setCohortError] = useState("");
  const [filters, setFilters] = useState({ department: "", severity: params.get("severity") || "", search: "", remediation_status: "" });
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [syncing, setSyncing] = useState(false);

  const loadGap = useCallback(async (id) => {
    if (!id) { setGap(null); return; }
    setGapLoading(true); setGapError(null);
    try { setGap(await skillsService.gap(id)); }
    catch (error) { setGap(null); setGapError({ code: error.apiError?.code, message: error.apiError?.message || "Could not load the skill analysis." }); }
    finally { setGapLoading(false); }
  }, []);

  useEffect(() => {
    if (studentParam) {
      if (student?.id !== studentParam) studentsService.get(studentParam).then(setStudent).catch(() => setStudent(null));
      loadGap(studentParam);
    }
  }, [studentParam, loadGap]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadCohort = useCallback(async () => {
    setCohortError("");
    try { setCohort(await skillsService.cohort({ ...filters, page, per_page: 8 })); }
    catch (error) { setCohortError(error.apiError?.message || "Could not load cohort deficits."); }
  }, [filters, page]);
  useEffect(() => { loadCohort(); }, [loadCohort]);
  useEffect(() => { const t = window.setTimeout(() => { setPage(1); setFilters((f) => ({ ...f, search: search.trim() })); }, 300); return () => window.clearTimeout(t); }, [search]);

  const pick = (s) => { setStudent(s); setParams((p) => { const n = new URLSearchParams(p); n.delete("student_id"); n.set("student", s.id); return n; }, { replace: true }); };
  const setRemediation = async (studentId, status) => {
    try { await skillsService.setRemediation(studentId, status || null); toast.success("Remediation status updated."); loadCohort(); if (gap?.student?.id === studentId) setGap((g) => ({ ...g, student: { ...g.student, remediation_status: status || null } })); }
    catch (error) { toast.error(error.apiError?.message || "Update failed."); }
  };
  const sync = async () => {
    setSyncing(true);
    try { const r = await skillsService.sync({ department: filters.department }); toast.success(`Evaluated ${r.evaluated}: ${r.action_required} action required, ${r.benchmark_met} benchmark met, ${r.kept} kept, ${r.unassessed} unassessed.`); loadCohort(); }
    catch (error) { toast.error(error.apiError?.message || "Sync failed."); } finally { setSyncing(false); }
  };
  const exportReport = async () => {
    if (!gap) return toast.error("Select an assessed student first.");
    try { await saveResponse(skillsService.gapExport(gap.student.id), `skill_gap_${gap.student.usn}.csv`); } catch (error) { toast.error(error.apiError?.message || "Export failed."); }
  };
  const exportCohort = async () => { try { await saveResponse(skillsService.cohortExport(filters), "skill_cohort.csv"); } catch (error) { toast.error(error.apiError?.message || "Export failed."); } };

  const axes = gap?.axes || [];
  const radarLabels = [...axes.map((a) => AXIS_LABELS[a.axis]), AXIS_LABELS[axes[0]?.axis]];
  const cohortColumns = [
    { key: "full_name", label: "Candidate", render: (_, r) => <Link to={`/skill-gap?student=${r.id}`} className="flex items-center gap-2.5 hover:underline"><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary-container font-label-sm text-label-sm text-on-primary">{initials(r.full_name)}</span><span className="min-w-0"><span className="block truncate font-body-sm font-semibold text-on-surface">{r.full_name}</span><span className="font-label-sm text-label-sm text-outline">{r.usn}</span></span></Link> },
    { key: "department", label: "Dept" },
    { key: "cgpa", label: "CGPA", align: "right", render: (v) => <span className={`font-label-md tabular-nums ${v != null && v < 7 ? "text-error" : ""}`}>{v ?? "—"}</span> },
    ...["dsa", "system_design", "core_cs", "aptitude", "communication"].map((a) => ({ key: a, label: AXIS_LABELS[a].split(" ")[0], align: "right", render: (v) => <span className={`font-label-md tabular-nums ${v != null && v < 60 ? "text-error" : "text-on-surface"}`}>{v ?? "—"}</span> })),
    { key: "primary_deficit_label", label: "Primary deficit", render: (v, r) => <Badge tone={SEVERITY[r.severity].tone}>{v || SEVERITY[r.severity].label}{r.primary_deficit_gap ? ` (−${r.primary_deficit_gap})` : ""}</Badge> },
    { key: "remediation_status", label: "Remediation", render: (v, r) => canWrite ? <select aria-label={`Remediation status for ${r.full_name}`} value={v || ""} onChange={(e) => setRemediation(r.id, e.target.value)} className="h-9 rounded bg-surface-container-low px-2 font-label-sm text-label-sm">{REMEDIATION.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select> : <span className="font-label-sm text-label-sm">{REM_LABEL[v || ""]}</span> },
  ];

  return <div className="flex flex-col gap-space-md">
    <PageHeader eyebrow="Diagnostic Intelligence & Remediation Planning" title="Student Skill Gap Analysis & Preparation Roadmaps" subtitle="Compare each student's latest assessment across DSA, system design, core CS, aptitude and communication against the targets configured in Admin, and generate a transparent, rule-based remediation plan."
      actions={<><Button variant="secondary" onClick={exportReport} disabled={!gap}><Icon>download</Icon>Export diagnostic report</Button>{canWrite && <Button onClick={sync} loading={syncing}><Icon>sync</Icon>Trigger batch assessment sync</Button>}</>} />

    <Card className="p-space-lg">
      <div className="grid grid-cols-1 items-center gap-3 lg:grid-cols-[auto_minmax(0,1fr)_auto]"><span className="font-label-sm text-label-sm uppercase tracking-wider text-outline">Target student</span><StudentPicker value={student} onChange={pick} />{gap && <div className="flex flex-wrap gap-2"><Badge tone={gap.critical_count ? "danger" : "success"}>{gap.critical_count} critical gap{gap.critical_count === 1 ? "" : "s"}</Badge><Badge tone={TIER_TONE[gap.eligible_tier.key]}>{gap.eligible_tier.label}</Badge></div>}</div>
      {!studentParam && <p className="mt-4 font-body-sm text-on-surface-variant">Pick a student to see their radar, gaps and roadmap — or click a name in the cohort table below.</p>}
      {gapLoading && <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-4">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-28" />)}</div>}
      {gapError && <div className="mt-4">{gapError.code === "no_assessment" ? <EmptyState icon="assignment" title="No skill assessment on record" description={gapError.message} action={canWrite && student ? <AssessmentForm student={student} onSaved={() => { loadGap(student.id); loadCohort(); }} /> : null} /> : <ErrorState message={gapError.message} onRetry={() => loadGap(studentParam)} />}</div>}
      {gap && !gapLoading && <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-xl bg-surface-container-low p-4"><p className="font-label-sm text-label-sm uppercase text-outline">Overall competency</p><p className="mt-2 font-headline-lg text-headline-lg tabular-nums text-primary">{gap.overall_competency} <span className="font-label-md text-label-md text-outline">/ 100</span></p><p className={`font-label-sm text-label-sm ${gap.overall_competency < gap.overall_target ? "text-error" : "text-emerald-700"}`}>{gap.overall_competency < gap.overall_target ? `${(gap.overall_target - gap.overall_competency).toFixed(1)} pts below target ${gap.overall_target}` : `At or above target ${gap.overall_target}`}</p></div>
        <div className="rounded-xl bg-surface-container-low p-4"><p className="font-label-sm text-label-sm uppercase text-error">Critical deficit domain</p>{gap.critical_domain ? <><p className="mt-2 font-headline-sm text-headline-sm text-on-surface">{gap.critical_domain.label}</p><p className="font-headline-md tabular-nums text-error">{gap.critical_domain.score} <span className="font-label-sm text-label-sm text-outline">/ {gap.critical_domain.target} target</span></p></> : <p className="mt-2 font-body-sm text-on-surface-variant">No deficits — every axis meets its target.</p>}</div>
        <div className="rounded-xl bg-surface-container-low p-4"><p className="font-label-sm text-label-sm uppercase text-outline">Strongest domain</p><p className="mt-2 font-headline-sm text-headline-sm text-on-surface">{gap.strongest_domain.label}</p><p className="font-headline-md tabular-nums text-secondary">{gap.strongest_domain.score} <span className="font-label-sm text-label-sm text-outline">{gap.strongest_domain.gap < 0 ? `+${-gap.strongest_domain.gap} over target` : ""}</span></p></div>
        <div className="rounded-xl bg-surface-container-low p-4"><p className="font-label-sm text-label-sm uppercase text-outline">Assessment status</p><p className="mt-2 font-headline-sm text-headline-sm text-on-surface">{gap.history.length} assessment{gap.history.length === 1 ? "" : "s"} on record</p><p className="font-body-sm text-on-surface-variant">Latest: {new Date(gap.assessment.assessed_at).toLocaleDateString("en-IN")} · source {gap.assessment.source || "—"}</p><p className="mt-1 font-label-sm text-label-sm text-secondary">Remediation: {REM_LABEL[gap.student.remediation_status || ""]}</p></div>
      </div>}
    </Card>

    {gap && !gapLoading && <div className="grid grid-cols-1 gap-space-md xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
      <div className="flex flex-col gap-space-md">
        <Card className="p-space-lg">
          <h2 className="font-headline-md text-headline-md text-primary">5-Axis Placement Benchmark Radar</h2><p className="font-body-sm text-on-surface-variant">{gap.student.full_name} (filled) against the target threshold (dashed).</p>
          <LazyPlot height={360} data={[{ type: "scatterpolar", r: [...axes.map((a) => a.target), axes[0].target], theta: radarLabels, name: "Target", mode: "lines", line: { dash: "dash", color: chartColors.indigo, width: 2 }, hovertemplate: "%{theta}: target %{r}<extra></extra>" }, { type: "scatterpolar", r: [...axes.map((a) => a.score), axes[0].score], theta: radarLabels, name: gap.student.full_name, fill: "toself", fillcolor: "rgba(78,69,213,0.25)", line: { color: chartColors.navy, width: 2 }, marker: { size: 7, color: [...axes.map((a) => (a.severity === "critical" ? chartColors.rose : chartColors.navy)), chartColors.navy] }, hovertemplate: "%{theta}: %{r}<extra></extra>" }]} layout={{ polar: { radialaxis: { range: [0, 100], tickfont: { size: 10 }, gridcolor: "#dce9ff" }, angularaxis: { tickfont: { size: 11 }, gridcolor: "#dce9ff" }, bgcolor: "rgba(0,0,0,0)" }, margin: { t: 30, b: 30, l: 60, r: 60 }, legend: { orientation: "h", y: -0.08 } }} />
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-5">{axes.map((a) => <div key={a.axis} className="rounded-lg bg-surface-container-low p-3 text-center"><p className="font-label-sm text-label-sm text-outline">{AXIS_LABELS[a.axis]}</p><p className="font-headline-sm tabular-nums text-primary">{a.score} / 100</p><p className={`font-label-sm text-label-sm ${a.gap > 0 ? "text-error" : "text-emerald-700"}`}>{a.gap > 0 ? `−${a.gap} deficit` : a.gap < 0 ? `+${-a.gap} surplus` : "on target"}</p></div>)}</div>
        </Card>
        <Card className="p-space-lg">
          <div className="flex items-start justify-between gap-2"><div><h2 className="font-headline-md text-headline-md text-primary">Axis Performance Audit</h2><p className="font-body-sm text-on-surface-variant">Each axis with the exact rule that classified it.</p></div><Badge tone="info">Target {gap.rules.skill_target}</Badge></div>
          <ul className="mt-4 space-y-4">{axes.map((a) => <li key={a.axis}><div className="flex flex-wrap items-center justify-between gap-2"><span className="flex items-center gap-2 font-headline-sm text-headline-sm text-on-surface">{a.label}<Badge tone={SEVERITY[a.severity].tone}>{SEVERITY[a.severity].label}</Badge></span><span className="font-label-md text-label-md tabular-nums">{a.score}%</span></div><div className="relative mt-1.5 h-2 rounded-full bg-surface-container"><div className={`h-full rounded-full ${SEVERITY[a.severity].bar}`} style={{ width: `${a.score}%` }} /><div className="absolute -top-1 h-4 w-0.5 bg-primary" style={{ left: `${a.target}%` }} title={`Target ${a.target}`} /></div><p className="mt-1 font-label-sm text-label-sm text-on-surface-variant">{a.trigger}</p></li>)}</ul>
        </Card>
      </div>
      <div className="flex flex-col gap-space-md">
        <Card className="bg-primary-container p-space-lg text-on-primary"><h2 className="flex items-center gap-2 font-headline-md text-headline-md text-white"><Icon className="text-tertiary-fixed-dim">rule</Icon>Rule engine: deterministic thresholds</h2><p className="mt-2 font-body-sm text-primary-fixed-dim">Recommendations come from fixed rules, not from the ML model. Thresholds are configured in Admin & Settings:</p><ul className="mt-2 space-y-1 font-label-sm text-label-sm text-primary-fixed"><li>• Gap = target ({gap.rules.skill_target}) − score; gap ≥ {gap.rules.critical_gap} → critical, &gt; 0 → needs refinement</li><li>• Score ≥ target + {gap.rules.surplus_margin} → surplus</li><li>• Technical floor {gap.rules.technical_threshold} · aptitude floor {gap.rules.aptitude_threshold}</li><li>• Tier-1 requires CGPA ≥ {gap.rules.tier1_min_cgpa} and no critical gaps</li></ul><p className="mt-3 font-body-sm text-primary-fixed-dim">{gap.eligible_tier.reason}</p></Card>
        <div className="flex items-center justify-between"><h2 className="font-label-sm text-label-sm uppercase tracking-wider text-outline">Prioritised remediation roadmap</h2><span className="font-label-sm text-label-sm text-outline">{gap.roadmap.length} item{gap.roadmap.length === 1 ? "" : "s"}</span></div>
        {gap.roadmap.length === 0 ? <Card className="p-space-lg"><p className="font-body-sm text-on-surface-variant">All axes meet their targets; no remediation needed.</p></Card> : gap.roadmap.map((item) => <Card key={item.code} className={`border-l-4 p-space-lg ${PRIORITY_STYLE[item.priority]}`}>
          <div className="flex flex-wrap items-center justify-between gap-2"><Badge tone={item.priority === 1 ? "danger" : item.priority === 2 ? "info" : "success"}>{item.type === "reinforcement" ? "Strength reinforcement" : `Priority ${item.priority} · ${item.priority === 1 ? "High urgency" : "Medium urgency"}`}</Badge><span className="font-label-sm text-label-sm text-outline">Code: {item.code}</span></div>
          <h3 className="mt-2 font-headline-sm text-headline-sm text-primary">{item.title}</h3>
          <p className="mt-2 rounded-lg bg-surface-container-low p-3 font-body-sm text-on-surface"><span className="font-semibold text-secondary">Diagnostic trigger: </span>{item.diagnostic_trigger}</p>
          <p className="mt-3 font-label-sm text-label-sm uppercase text-outline">Focus modules</p><ul className="list-disc pl-5 font-body-sm text-on-surface-variant">{item.focus_modules.map((m) => <li key={m}>{m}</li>)}</ul>
          <p className="mt-2 font-label-sm text-label-sm uppercase text-outline">Required deliverables</p><ul className="list-disc pl-5 font-body-sm text-on-surface-variant">{item.deliverables.map((m) => <li key={m}>{m}</li>)}</ul>
          {canWrite && item.type !== "reinforcement" && <div className="mt-3 flex flex-wrap gap-2"><Button variant={gap.student.remediation_status === "enrolled" ? "secondary" : "primary"} onClick={() => setRemediation(gap.student.id, "enrolled")}><Icon>how_to_reg</Icon>{gap.student.remediation_status === "enrolled" ? "Enrolled" : "Mark enrolled"}</Button><Button variant="secondary" onClick={() => setRemediation(gap.student.id, "awaiting_retest")}>Awaiting retest</Button></div>}
        </Card>)}
        {canWrite && <AssessmentForm student={gap.student} onSaved={() => { loadGap(gap.student.id); loadCohort(); }} />}
      </div>
    </div>}

    <Card className="p-space-lg">
      <div className="mb-space-md flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between"><div><h2 className="font-headline-md text-headline-md text-primary">Cohort Skill Deficit Overview</h2><p className="font-body-sm text-on-surface-variant">Primary deficit per student from their latest assessment, with remediation tracking.</p>{cohort?.summary && <div className="mt-2 flex flex-wrap gap-2"><Badge tone="danger">{cohort.summary.critical} critical</Badge><Badge tone="info">{cohort.summary.needs_refinement} needs refinement</Badge><Badge tone="success">{cohort.summary.meets} meeting targets</Badge><Badge>{cohort.summary.unassessed} unassessed</Badge></div>}</div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:flex lg:flex-wrap"><label className="relative"><Icon className="absolute left-2 top-2.5 text-[18px] text-outline">search</Icon><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Filter by USN or name…" aria-label="Filter cohort" className="h-10 w-full rounded-lg bg-surface-container-low pl-8 pr-3 font-body-sm outline-none focus:ring-2 focus:ring-secondary/30 lg:w-52" /></label><Select aria-label="Department" value={filters.department} onChange={(e) => { setPage(1); setFilters((f) => ({ ...f, department: e.target.value })); }} options={DEPARTMENT_OPTIONS} /><Select aria-label="Severity" value={filters.severity} onChange={(e) => { setPage(1); setFilters((f) => ({ ...f, severity: e.target.value })); }} options={[{ value: "", label: "All severities" }, { value: "critical", label: "Critical" }, { value: "needs_refinement", label: "Needs refinement" }, { value: "meets", label: "Meets target" }, { value: "unassessed", label: "Not assessed" }]} /><Button variant="secondary" onClick={exportCohort}><Icon>download</Icon>Cohort CSV</Button></div></div>
      {cohortError ? <ErrorState message={cohortError} onRetry={loadCohort} /> : !cohort ? <Skeleton className="h-56" /> : cohort.items.length === 0 ? <EmptyState icon="groups" title="No students match these filters" /> : <>
        <DataTable columns={cohortColumns} rows={cohort.items} />
        <div className="flex items-center justify-between pt-3 font-label-sm text-label-sm text-on-surface-variant"><span>Showing {(cohort.page - 1) * cohort.per_page + 1}–{Math.min(cohort.page * cohort.per_page, cohort.total)} of {cohort.total}</span><div className="flex gap-2"><Button variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button><Button variant="secondary" disabled={page >= Math.ceil(cohort.total / cohort.per_page)} onClick={() => setPage((p) => p + 1)}>Next</Button></div></div>
      </>}
    </Card>
  </div>;
}
