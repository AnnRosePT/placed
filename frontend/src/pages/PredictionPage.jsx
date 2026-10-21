import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import toast from "react-hot-toast";
import { predictionService } from "../services/predictionService.js";
import { studentsService } from "../services/studentsService.js";
import { useAuth } from "../context/AuthContext.jsx";
import StudentPicker from "../components/StudentPicker.jsx";
import BatchInferenceModal from "../components/BatchInferenceModal.jsx";
import LazyPlot from "../components/charts/LazyPlot.jsx";
import { chartColors } from "../components/charts/PlotlyChart.jsx";
import { Badge, Button, Card, DataTable, Drawer, EmptyState, ErrorState, Icon, PageHeader, Segmented, Skeleton } from "../components/ui/index.jsx";
import { FEATURE_LABELS, dateTime, initials, pct } from "../utils/format.js";
import { saveResponse } from "../utils/download.js";

const DEFAULTS = { tenth_pct: "75", twelfth_pct: "75", cgpa: "7.5", aptitude_score: "70", technical_score: "65", communication_score: "70", internships: "1", projects: "2", certifications: "1", backlogs: "0", extracurricular: false, placement_training: true };
const RANGES = { tenth_pct: [0, 100, 0.1], twelfth_pct: [0, 100, 0.1], cgpa: [0, 10, 0.01], aptitude_score: [0, 100, 1], technical_score: [0, 100, 1], communication_score: [0, 100, 1], internships: [0, 20, 1], projects: [0, 100, 1], certifications: [0, 100, 1], backlogs: [0, 20, 1] };
const STAGE1 = ["tenth_pct", "twelfth_pct", "cgpa"];
const STAGE2 = ["aptitude_score", "technical_score", "communication_score", "internships", "projects", "certifications", "backlogs"];
const confidenceTone = { high: "success", medium: "warning", low: "neutral" };

function fromStudent(student) {
  const values = { ...DEFAULTS };
  Object.keys(DEFAULTS).forEach((key) => {
    if (student?.[key] !== null && student?.[key] !== undefined) values[key] = typeof DEFAULTS[key] === "boolean" ? Boolean(student[key]) : String(student[key]);
  });
  return values;
}

function validate(values) {
  const errors = {};
  Object.entries(RANGES).forEach(([key, [min, max]]) => {
    if (values[key] === "") return;
    const n = Number(values[key]);
    if (!Number.isFinite(n) || n < min || n > max) errors[key] = `${min}–${max}`;
  });
  return errors;
}

function toPayload(values) {
  const features = {};
  Object.entries(values).forEach(([key, value]) => {
    if (typeof value === "boolean") features[key] = value;
    else if (value !== "") features[key] = Number(value);
  });
  return features;
}

function ModelBanner({ model, loading }) {
  if (loading) return <Skeleton className="h-28 w-full rounded-xl" />;
  if (!model?.loaded) return <ErrorState title="No trained model loaded" message="Run `python -m ml.train` inside backend/ and restart Flask (or retrain from Admin & Settings)." />;
  const m = model.metrics || {};
  const cells = [
    ["Architecture", `${model.algorithm}`, model.version],
    ["Validation (5-fold CV)", `${m.cv_mean?.toFixed(3)} ± ${m.cv_std?.toFixed(3)}`, "ROC-AUC"],
    ["Held-out test set", `${m.test_size?.toLocaleString("en-IN")} rows`, `Accuracy ${pct(m.accuracy)}`],
    ["Test ROC-AUC", m.roc_auc?.toFixed(3), `F1 ${m.f1?.toFixed(3)}`],
    ["Training checkpoint", dateTime(model.trained_at), `${model.dataset_source === "synthetic" ? "Synthetic (illustrative)" : "Kaggle dataset"} · ${model.training_rows?.toLocaleString("en-IN")} rows`],
    ["Leakage guard", model.leakage_guard ? "Active" : "Check features", "Outcome fields excluded"],
  ];
  return <section aria-label="Active model" className="grid grid-cols-2 gap-4 rounded-xl bg-primary-container p-space-lg text-on-primary shadow-md md:grid-cols-3 xl:grid-cols-6">
    {cells.map(([label, value, hint]) => <div key={label} className="min-w-0"><p className="font-label-sm text-label-sm uppercase tracking-wider text-on-primary-container">{label}</p><p className="mt-1 truncate font-label-lg text-label-lg font-semibold text-white">{value ?? "—"}</p><p className="truncate font-label-sm text-label-sm text-primary-fixed-dim">{hint}</p></div>)}
  </section>;
}

function NumberField({ name, values, errors, onChange, unused }) {
  const [min, max, step] = RANGES[name];
  return <label className="flex flex-col gap-1.5">
    <span className="flex items-center justify-between gap-2 font-body-sm text-body-sm text-on-surface-variant">{FEATURE_LABELS[name]}{unused && <span className="rounded bg-surface-container px-1.5 py-0.5 font-label-sm text-[10px] uppercase text-outline" title="This field is not present in the training data, so it does not affect the prediction.">not used by model</span>}</span>
    <div className="relative"><input type="number" name={name} min={min} max={max} step={step} value={values[name]} onChange={onChange} className={`h-11 w-full rounded-lg border bg-surface-container-low px-3 pr-14 font-label-md text-label-md tabular-nums text-on-surface outline-none focus:ring-2 focus:ring-secondary/30 ${errors[name] ? "border-error" : "border-transparent"}`} /><span className="pointer-events-none absolute right-3 top-3 font-label-sm text-label-sm text-outline">/ {max}</span></div>
    {errors[name] && <span className="font-body-sm text-error">Allowed range {errors[name]}</span>}
  </label>;
}

function ResultCard({ result, onCommit, committing, canCommit }) {
  if (!result) return <Card className="flex h-full flex-col"><EmptyState icon="online_prediction" title="No prediction yet" description="Choose a student or enter a manual assessment, then run the prediction. Results, local feature impacts and guidance appear here." /></Card>;
  const placed = result.label === "placed";
  const top = result.contributions.slice(0, 8);
  const maxImpact = Math.max(...top.map((c) => Math.abs(c.impact)), 0.0001);
  return <Card className="flex flex-col gap-5 p-space-lg">
    <div className="flex flex-wrap items-center justify-between gap-2"><span className="flex items-center gap-1.5 font-label-sm text-label-sm uppercase tracking-wider text-on-surface-variant"><Icon className="text-[16px]">psychology</Icon>Model inference result</span><Badge tone={confidenceTone[result.confidence]}>Confidence: {result.confidence}</Badge></div>
    <div><p className="font-label-sm text-label-sm uppercase tracking-wider text-secondary">{result.student ? `${result.student.usn} · ${result.student.full_name}` : "Manual what-if assessment"}</p><h2 className={`mt-1 font-headline-xl text-headline-xl ${placed ? "text-primary" : "text-error"}`}>PREDICTED: {placed ? "PLACED" : "NOT PLACED"}</h2><p className="mt-2 font-body-sm text-on-surface-variant">Statistical estimate from historical data, not a guarantee of placement.</p></div>
    <div className="rounded-xl bg-surface-container-low p-4">
      <div className="flex items-baseline justify-between"><span className="font-headline-sm text-headline-sm text-on-surface">Placement probability</span><span className="font-headline-lg text-headline-lg tabular-nums text-secondary">{pct(result.probability)}</span></div>
      <div className="relative mt-3 h-2.5 rounded-full bg-surface-container-high"><div className="h-full rounded-full bg-gradient-to-r from-[#4338CA] to-[#38BDF8]" style={{ width: `${result.probability * 100}%` }} /><div className="absolute -top-1 h-4.5 w-0.5 bg-primary" style={{ left: `${result.threshold * 100}%`, height: 18 }} title={`Threshold ${pct(result.threshold)}`} /></div>
      <div className="mt-2 flex justify-between font-label-sm text-label-sm text-outline"><span>0%</span><span>Threshold {pct(result.threshold, 0)}</span><span>100%</span></div>
    </div>
    <div>
      <div className="mb-2 flex items-center justify-between"><h3 className="font-headline-sm text-headline-sm text-primary">Feature impact on this prediction</h3><span className="font-label-sm text-label-sm text-outline">Δ probability vs. median</span></div>
      <ul className="space-y-2.5">{top.map((c) => <li key={c.feature}><div className="flex justify-between gap-2 font-body-sm"><span className="truncate text-on-surface">{FEATURE_LABELS[c.feature] || c.feature} <span className="font-label-sm text-label-sm text-outline">({typeof c.value === "number" ? Number(c.value.toFixed(2)) : String(c.value)})</span></span><span className={`shrink-0 font-label-md text-label-md tabular-nums ${c.impact >= 0 ? "text-emerald-700" : "text-rose-700"}`}>{c.impact >= 0 ? "+" : ""}{(c.impact * 100).toFixed(1)} pp</span></div><div className="mt-1 h-1.5 rounded-full bg-surface-container"><div className={`h-full rounded-full ${c.impact >= 0 ? "bg-emerald-500" : "bg-rose-500"}`} style={{ width: `${(Math.abs(c.impact) / maxImpact) * 100}%` }} /></div></li>)}</ul>
    </div>
    <div className="rounded-xl border border-secondary/20 bg-secondary-fixed/40 p-4"><h3 className="flex items-center gap-1.5 font-headline-sm text-headline-sm text-primary"><Icon className="text-[18px] text-secondary">tips_and_updates</Icon>Counselling advisory</h3><p className="mt-1 font-body-sm text-on-surface">{result.advisory.summary}</p><ul className="mt-2 list-disc space-y-1 pl-5 font-body-sm text-on-surface-variant">{result.advisory.points.map((p) => <li key={p}>{p}</li>)}</ul></div>
    <div className="flex items-center gap-3 rounded-xl bg-surface-container-low p-3"><span className="flex h-10 w-10 items-center justify-center rounded-lg bg-surface-container-lowest text-secondary"><Icon>leaderboard</Icon></span><div><p className="font-headline-sm text-headline-sm text-primary">{result.percentile == null ? "Cohort percentile unavailable" : `Cohort percentile: ${result.percentile}th`}</p><p className="font-body-sm text-on-surface-variant">{result.percentile == null ? "Run batch inference to build a comparison cohort." : `Compared with the latest saved predictions${result.student?.batch_year ? ` for batch ${result.student.batch_year}` : ""}.`}</p></div></div>
    {result.unused_by_model?.length > 0 && <p className="font-label-sm text-label-sm text-outline">Not used by model: {result.unused_by_model.map((f) => FEATURE_LABELS[f] || f).join(", ")}.</p>}
    <Button onClick={onCommit} loading={committing} disabled={!canCommit || result.saved}><Icon>bookmark_added</Icon>{result.saved ? "Saved to log" : result.student ? "Commit to profile" : "Save to inference log"}</Button>
  </Card>;
}

export default function PredictionPage() {
  const { profile } = useAuth();
  const [params, setParams] = useSearchParams();
  const [model, setModel] = useState(null);
  const [modelLoading, setModelLoading] = useState(true);
  const [mode, setMode] = useState(params.get("student_id") ? "student" : "student");
  const [student, setStudent] = useState(null);
  const [recent, setRecent] = useState([]);
  const [values, setValues] = useState(DEFAULTS);
  const [errors, setErrors] = useState({});
  const [result, setResult] = useState(null);
  const [running, setRunning] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [batchOpen, setBatchOpen] = useState(false);
  const [weightsOpen, setWeightsOpen] = useState(false);
  const [log, setLog] = useState(null);
  const [logError, setLogError] = useState("");
  const [logPage, setLogPage] = useState(1);
  const [logSearch, setLogSearch] = useState("");
  const [logQuery, setLogQuery] = useState("");
  const [detail, setDetail] = useState(null);
  const unused = useMemo(() => new Set(model?.unused_by_model || []), [model]);
  const canBatch = ["super_admin", "placement_officer"].includes(profile?.role);

  useEffect(() => {
    predictionService.model().then(setModel).catch(() => setModel(null)).finally(() => setModelLoading(false));
    studentsService.list({ per_page: 3, sort: "created_at", order: "desc" }).then((d) => setRecent(d.items || [])).catch(() => {});
  }, []);

  useEffect(() => {
    const id = params.get("student_id");
    if (!id) return;
    studentsService.get(id).then((s) => { setStudent(s); setValues(fromStudent(s)); setMode("student"); }).catch(() => toast.error("Could not load the requested student."));
  }, [params]);

  const loadLog = useCallback(async () => {
    setLogError("");
    try { setLog(await predictionService.history({ page: logPage, per_page: 8, search: logQuery })); }
    catch (error) { setLogError(error.apiError?.message || "Could not load the inference log."); }
  }, [logPage, logQuery]);
  useEffect(() => { loadLog(); }, [loadLog]);
  useEffect(() => { const t = window.setTimeout(() => { setLogPage(1); setLogQuery(logSearch.trim()); }, 300); return () => window.clearTimeout(t); }, [logSearch]);

  const pickStudent = (s) => { setStudent(s); setValues(fromStudent(s)); setResult(null); setErrors({}); setParams(s ? { student_id: s.id } : {}, { replace: true }); };
  const switchMode = (next) => { setMode(next); setResult(null); if (next === "manual") { setStudent(null); setValues(DEFAULTS); setParams({}, { replace: true }); } };
  const change = (event) => { const { name, value, type, checked } = event.target; setValues((v) => ({ ...v, [name]: type === "checkbox" ? checked : value })); setErrors((e) => ({ ...e, [name]: undefined })); };
  const reset = () => { setValues(student ? fromStudent(student) : DEFAULTS); setErrors({}); setResult(null); };

  const run = async (save = false) => {
    const localErrors = validate(values);
    setErrors(localErrors);
    if (Object.keys(localErrors).length) return null;
    if (mode === "student" && !student) { toast.error("Select a student first, or switch to Manual Assessment."); return null; }
    const payload = { features: toPayload(values), save };
    if (mode === "student" && student) payload.student_id = student.id;
    const data = await predictionService.predict(payload);
    setResult(data);
    return data;
  };
  const runPrediction = async () => {
    setRunning(true);
    try { await run(false); } catch (error) { toast.error(error.apiError?.message || "Prediction failed."); } finally { setRunning(false); }
  };
  const commit = async () => {
    setCommitting(true);
    try { const data = await run(true); if (data?.saved) { toast.success("Prediction saved to the inference log."); setLogPage(1); loadLog(); } }
    catch (error) { toast.error(error.apiError?.message || "Could not save prediction."); } finally { setCommitting(false); }
  };
  const exportLog = async () => { try { await saveResponse(predictionService.exportHistory({ search: logQuery }), "predictions.csv"); } catch (error) { toast.error(error.apiError?.message || "Export failed."); } };

  const importances = model?.feature_importances || [];
  const logColumns = [
    { key: "student", label: "Candidate", render: (s) => s ? <div className="flex items-center gap-2.5"><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-container font-label-sm text-label-sm text-primary">{initials(s.full_name)}</span><div className="min-w-0"><p className="truncate font-body-sm font-semibold text-on-surface">{s.full_name}</p><p className="font-label-sm text-label-sm text-outline">{s.usn} · {s.department}</p></div></div> : <span className="font-body-sm text-on-surface-variant">Manual what-if</span> },
    { key: "created_at", label: "Timestamp", render: (v) => <span className="font-label-sm text-label-sm tabular-nums">{dateTime(v)}</span> },
    { key: "features", label: "Snapshot (CGPA / Apt / Tech)", render: (f = {}) => <span className="font-label-sm text-label-sm tabular-nums text-on-surface-variant">{f.cgpa ?? "—"} / {f.aptitude_score ?? "—"} / {f.technical_score ?? "—"}</span> },
    { key: "probability", label: "Probability", align: "right", render: (v) => <span className="font-label-md text-label-md tabular-nums text-secondary">{pct(v)}</span> },
    { key: "predicted_label", label: "Outcome", render: (v) => <Badge tone={v === "placed" ? "info" : "danger"}>{v === "placed" ? "Placed" : "At risk"}</Badge> },
    { key: "model_version", label: "Model", render: (v) => <span className="font-label-sm text-label-sm text-outline">{v}</span> },
    { key: "actions", label: "", align: "right", render: (_, row) => <button type="button" aria-label="View prediction details" onClick={() => setDetail(row)} className="rounded-lg p-2 hover:bg-surface-container"><Icon>visibility</Icon></button> },
  ];

  return <div className="flex flex-col gap-space-md">
    <PageHeader eyebrow="Inference Engine · Academic Intelligence" title="Machine Learning Placement Prediction" subtitle={model?.loaded ? `scikit-learn ${model.algorithm} pipeline trained on ${model.training_rows?.toLocaleString("en-IN")} historical records. Outcome fields are never used as inputs.` : "Placement probability from the active trained scikit-learn model."}
      actions={<>{canBatch && <Button variant="secondary" onClick={() => setBatchOpen(true)} disabled={!model?.loaded}><Icon>dynamic_feed</Icon>Run Batch Inference</Button>}<Button onClick={() => setWeightsOpen(true)} disabled={!model?.loaded}><Icon>bar_chart</Icon>Inspect Weights</Button></>} />
    <ModelBanner model={model} loading={modelLoading} />

    <div className="grid grid-cols-1 gap-space-md xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
      <Card className="flex flex-col gap-5 p-space-lg">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><h2 className="flex items-center gap-2 font-headline-md text-headline-md text-primary"><Icon className="text-secondary">tune</Icon>Inference Feature Pipeline</h2><Segmented label="Input source" value={mode} onChange={switchMode} options={[{ value: "student", label: "Select Existing Student" }, { value: "manual", label: "Manual Assessment" }]} /></div>
        {mode === "student" && <div className="rounded-xl bg-surface-container-low p-4"><p className="mb-2 font-label-sm text-label-sm uppercase tracking-wider text-outline">Auto-fill from registry</p><StudentPicker value={student} onChange={pickStudent} />{recent.length > 0 && <div className="mt-3 flex flex-wrap items-center gap-2"><span className="font-label-sm text-label-sm text-outline">Recently added:</span>{recent.map((s) => <button key={s.id} type="button" onClick={() => pickStudent(s)} className="min-h-[32px] rounded bg-surface-container-lowest px-2 py-1 font-label-sm text-label-sm text-secondary hover:bg-secondary-fixed">{s.full_name} ({s.cgpa ?? "—"})</button>)}</div>}{student && <p className="mt-3 font-body-sm text-on-surface-variant">Values below come from the student record. Edits are treated as a what-if scenario for this student.</p>}</div>}
        <fieldset className="space-y-3"><legend className="mb-3 flex w-full items-center justify-between"><span className="border-l-4 border-secondary pl-2 font-headline-sm text-headline-sm text-on-surface">Academic credentials</span><span className="font-label-sm text-label-sm text-outline">Stage 1 inputs</span></legend><div className="grid grid-cols-1 gap-3 sm:grid-cols-3">{STAGE1.map((n) => <NumberField key={n} name={n} values={values} errors={errors} onChange={change} unused={unused.has(n)} />)}</div></fieldset>
        <fieldset className="space-y-3"><legend className="mb-3 flex w-full items-center justify-between"><span className="border-l-4 border-secondary pl-2 font-headline-sm text-headline-sm text-on-surface">Aptitude & industry readiness</span><span className="font-label-sm text-label-sm text-outline">Stage 2 inputs</span></legend><div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">{STAGE2.map((n) => <NumberField key={n} name={n} values={values} errors={errors} onChange={change} unused={unused.has(n)} />)}</div>
          <div className="flex flex-wrap gap-4 pt-1">{["extracurricular", "placement_training"].map((n) => <label key={n} className="flex min-h-[40px] items-center gap-2 font-body-sm text-on-surface"><input type="checkbox" name={n} checked={values[n]} onChange={change} className="h-4 w-4 accent-[#4e45d5]" />{FEATURE_LABELS[n]}{unused.has(n) && <span className="font-label-sm text-[10px] uppercase text-outline">not used by model</span>}</label>)}</div></fieldset>
        <div className="flex gap-3 rounded-xl border border-secondary/20 bg-secondary-fixed/30 p-4"><Icon className="text-secondary">verified_user</Icon><div><p className="font-headline-sm text-headline-sm text-primary">Leakage guard</p><p className="font-body-sm text-on-surface-variant">Placement status, company and package are never model inputs, so the estimate cannot see the outcome it predicts.</p></div></div>
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-between"><Button variant="secondary" onClick={reset}><Icon>restart_alt</Icon>Reset defaults</Button><Button onClick={runPrediction} loading={running} disabled={!model?.loaded} className="sm:min-w-64"><Icon>bolt</Icon>Run prediction</Button></div>
      </Card>
      <ResultCard result={result} onCommit={commit} committing={committing} canCommit={Boolean(model?.loaded)} />
    </div>

    <Card className="p-space-lg">
      <div className="mb-space-md flex flex-col gap-3 md:flex-row md:items-center md:justify-between"><div><h2 className="flex items-center gap-2 font-headline-md text-headline-md text-primary">Saved Inference Audit Log {log && <Badge>{log.total} records</Badge>}</h2><p className="font-body-sm text-on-surface-variant">Every saved prediction with its feature snapshot and model version.</p></div><div className="flex flex-wrap gap-2"><label className="relative"><Icon className="absolute left-2 top-2.5 text-[18px] text-outline">filter_list</Icon><input value={logSearch} onChange={(e) => setLogSearch(e.target.value)} placeholder="Filter by USN or name…" aria-label="Filter inference log" className="h-10 w-56 rounded-lg bg-surface-container-low pl-8 pr-3 font-body-sm outline-none focus:ring-2 focus:ring-secondary/30" /></label><Button variant="secondary" onClick={exportLog}><Icon>download</Icon>CSV export</Button></div></div>
      {logError ? <ErrorState message={logError} onRetry={loadLog} /> : !log ? <Skeleton className="h-48" /> : log.items.length === 0 ? <EmptyState icon="history" title="No saved predictions" description="Commit a prediction or run batch inference to populate the log." /> : <>
        <DataTable columns={logColumns} rows={log.items} />
        <div className="flex items-center justify-between pt-3 font-label-sm text-label-sm text-on-surface-variant"><span>Page {log.page} of {Math.max(1, Math.ceil(log.total / log.per_page))}</span><div className="flex gap-2"><Button variant="secondary" disabled={logPage <= 1} onClick={() => setLogPage((p) => p - 1)}>Previous</Button><Button variant="secondary" disabled={logPage >= Math.ceil(log.total / log.per_page)} onClick={() => setLogPage((p) => p + 1)}>Next</Button></div></div>
      </>}
    </Card>

    <BatchInferenceModal open={batchOpen} onClose={() => setBatchOpen(false)} onDone={() => loadLog()} batches={[...new Set(recent.map((s) => s.batch_year))]} />
    <Drawer open={weightsOpen} onClose={() => setWeightsOpen(false)} eyebrow={model?.version} title="Global feature importance">
      <p className="mb-3 font-body-sm text-on-surface-variant">Permutation importance on the held-out test set: how much test ROC-AUC drops when each feature is shuffled. Larger means the model relies on it more.</p>
      <LazyPlot height={380} data={[{ type: "bar", orientation: "h", y: [...importances].reverse().map((f) => FEATURE_LABELS[f.feature] || f.feature), x: [...importances].reverse().map((f) => f.importance), marker: { color: chartColors.indigo }, hovertemplate: "%{y}: %{x:.4f}<extra></extra>" }]} layout={{ margin: { l: 170, r: 16, t: 8, b: 40 }, xaxis: { title: { text: "Δ ROC-AUC" } } }} />
      {model?.confusion_matrix && <div className="mt-5"><h3 className="mb-2 font-headline-sm text-headline-sm text-primary">Confusion matrix (test set, threshold 0.5)</h3><table className="w-full text-center font-label-md text-label-md tabular-nums"><thead><tr className="text-outline"><th></th><th className="p-2">Pred. not placed</th><th className="p-2">Pred. placed</th></tr></thead><tbody>{model.confusion_matrix.map((row, i) => <tr key={i}><th className="p-2 text-left font-label-sm text-outline">{i ? "Actual placed" : "Actual not placed"}</th>{row.map((v, j) => <td key={j} className={`rounded p-3 ${i === j ? "bg-secondary-fixed text-primary" : "bg-surface-container-low text-on-surface"}`}>{v}</td>)}</tr>)}</tbody></table></div>}
      {model?.unused_by_model?.length > 0 && <p className="mt-4 font-body-sm text-on-surface-variant">Not in the training data (shown in the form but ignored): {model.unused_by_model.map((f) => FEATURE_LABELS[f] || f).join(", ")}.</p>}
    </Drawer>
    <Drawer open={Boolean(detail)} onClose={() => setDetail(null)} eyebrow="Inference record" title={detail?.student?.full_name || "Manual what-if"}>
      {detail && <div className="space-y-4">
        <div className="flex flex-wrap gap-2"><Badge tone={detail.predicted_label === "placed" ? "info" : "danger"}>{detail.predicted_label}</Badge><Badge>{pct(detail.probability)}</Badge><Badge>{detail.model_version}</Badge><Badge>{dateTime(detail.created_at)}</Badge></div>
        <dl className="grid grid-cols-2 gap-2">{Object.entries(detail.features || {}).map(([k, v]) => <div key={k} className="rounded-lg bg-surface-container-low p-2.5"><dt className="font-label-sm text-label-sm text-outline">{FEATURE_LABELS[k] || k}</dt><dd className="font-label-md text-label-md text-on-surface">{String(v)}</dd></div>)}</dl>
        {detail.contributions?.length > 0 && <div><h3 className="mb-2 font-headline-sm text-primary">Top contributions</h3><ul className="space-y-1">{detail.contributions.slice(0, 6).map((c) => <li key={c.feature} className="flex justify-between font-body-sm"><span>{FEATURE_LABELS[c.feature] || c.feature}</span><span className={c.impact >= 0 ? "text-emerald-700" : "text-rose-700"}>{c.impact >= 0 ? "+" : ""}{(c.impact * 100).toFixed(1)} pp</span></li>)}</ul></div>}
      </div>}
    </Drawer>
  </div>;
}
