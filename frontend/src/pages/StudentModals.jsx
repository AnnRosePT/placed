import { useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import { useNavigate } from "react-router-dom";
import { studentsService } from "../services/studentsService.js";
import { Button, DataTable, Icon, Input, Modal, Select, Skeleton, StatusChip } from "../components/ui/index.jsx";

const EMPTY_STUDENT = {
  usn: "", full_name: "", email: "", department: "CSE", batch_year: new Date().getFullYear(),
  tenth_pct: "", twelfth_pct: "", cgpa: "", aptitude_score: "", technical_score: "",
  communication_score: "", internships: 0, projects: 0, certifications: 0, backlogs: 0,
  extracurricular: false, placement_training: false, placement_status: "in_process", company: "", package_lpa: "",
};

const statuses = [
  { value: "in_process", label: "In Process" },
  { value: "placed", label: "Placed" },
  { value: "not_placed", label: "Not Placed" },
  { value: "opted_out", label: "Opted Out" },
];

function studentPayload(values) {
  const fields = ["usn", "full_name", "email", "department", "batch_year", "tenth_pct", "twelfth_pct", "cgpa", "aptitude_score", "technical_score", "communication_score", "internships", "projects", "certifications", "backlogs", "extracurricular", "placement_training", "placement_status", "company", "package_lpa"];
  const payload = Object.fromEntries(fields.map((field) => [field, values[field]]));
  payload.usn = values.usn.trim().toUpperCase();
  payload.full_name = values.full_name.trim();
  payload.email = values.email.trim() || null;
  ["tenth_pct", "twelfth_pct", "cgpa", "package_lpa"].forEach((key) => { payload[key] = payload[key] === "" ? null : Number(payload[key]); });
  ["aptitude_score", "technical_score", "communication_score", "internships", "projects", "certifications", "backlogs", "batch_year"].forEach((key) => { payload[key] = Number(payload[key]); });
  return payload;
}

function validateStudent(values) {
  const errors = {};
  if (!values.usn.trim()) errors.usn = "USN is required.";
  else if (values.usn.trim().length > 50) errors.usn = "USN must be 50 characters or fewer.";
  if (!values.full_name.trim()) errors.full_name = "Full name is required.";
  if (values.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email.trim())) errors.email = "Enter a valid email address.";
  if (!values.department) errors.department = "Choose a department.";
  const ranges = { batch_year: [-Infinity, Infinity], tenth_pct: [0, 100], twelfth_pct: [0, 100], cgpa: [0, 10], aptitude_score: [0, 100], technical_score: [0, 100], communication_score: [0, 100], internships: [0, Infinity], projects: [0, Infinity], certifications: [0, Infinity], backlogs: [0, Infinity], package_lpa: [0, 9999.99] };
  for (const [field, [min, max]] of Object.entries(ranges)) {
    const value = values[field];
    if (value === "" || value == null) continue;
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < min || parsed > max) errors[field] = `Value must be between ${Number.isFinite(min) ? min : "−∞"} and ${Number.isFinite(max) ? max : "∞"}.`;
    else if (field !== "cgpa" && field !== "tenth_pct" && field !== "twelfth_pct" && field !== "package_lpa" && !Number.isInteger(parsed)) errors[field] = "Enter a whole number.";
  }
  return errors;
}

export function StudentFormModal({ open, student, onClose, onSaved }) {
  const [values, setValues] = useState(EMPTY_STUDENT);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (open) {
      setValues({ ...EMPTY_STUDENT, ...(student || {}) });
      setErrors({});
    }
  }, [open, student]);

  const change = (event) => {
    const { name, value, type, checked } = event.target;
    setValues((current) => ({ ...current, [name]: type === "checkbox" ? checked : value }));
    setErrors((current) => ({ ...current, [name]: undefined, _form: undefined }));
  };
  const save = async (event) => {
    event.preventDefault();
    const localErrors = validateStudent(values);
    setErrors(localErrors);
    if (Object.keys(localErrors).length) return;
    setSaving(true);
    try {
      const payload = studentPayload(values);
      if (student?.id) await studentsService.update(student.id, payload);
      else await studentsService.create(payload);
      toast.success(student?.id ? "Student updated." : "Student added.");
      onSaved();
      onClose();
    } catch (error) {
      if (error.response?.status === 409 || error.apiError?.code === "duplicate_usn") {
        setErrors((current) => ({ ...current, usn: "USN already exists." }));
      } else if (Array.isArray(error.apiError?.details)) {
        const mapped = {};
        error.apiError.details.forEach((item) => { mapped[item.loc?.[0]] = item.msg; });
        setErrors((current) => ({ ...current, ...mapped }));
      } else {
        setErrors((current) => ({ ...current, _form: error.apiError?.message || "Unable to save student." }));
      }
    } finally {
      setSaving(false);
    }
  };

  const field = (name, label, type = "text", extra = {}) => <Input key={name} label={label} type={type} name={name} value={values[name] ?? ""} onChange={change} error={errors[name]} {...extra} />;

  return <Modal open={open} title={student ? "Edit Student Record" : "Add Student Record"} onClose={onClose}>
    <form onSubmit={save} className="max-h-[70vh] space-y-4 overflow-y-auto pr-1">
      <p className="font-label-sm text-label-sm uppercase tracking-wider text-secondary">Student profile and academic record</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {field("usn", "USN", "text", { maxLength: 50, autoComplete: "off" })}
        {field("full_name", "Full name", "text", { maxLength: 200 })}
        {field("email", "Email", "email", { maxLength: 320 })}
        <Select label="Department" name="department" value={values.department} onChange={change} options={[{ value: "CSE", label: "CSE" }, { value: "IT", label: "IT" }, { value: "AIDS", label: "AIDS" }, { value: "ECE", label: "ECE" }]} />
        {field("batch_year", "Batch year", "number", { step: 1 })}
        {field("cgpa", "CGPA", "number", { min: 0, max: 10, step: 0.01 })}
        {field("tenth_pct", "10th marks (%)", "number", { min: 0, max: 100, step: 0.01 })}
        {field("twelfth_pct", "12th marks (%)", "number", { min: 0, max: 100, step: 0.01 })}
        {field("aptitude_score", "Aptitude score", "number", { min: 0, max: 100, step: 1 })}
        {field("technical_score", "Technical score", "number", { min: 0, max: 100, step: 1 })}
        {field("communication_score", "Communication score", "number", { min: 0, max: 100, step: 1 })}
        {field("internships", "Internships", "number", { min: 0, step: 1 })}
        {field("projects", "Projects", "number", { min: 0, step: 1 })}
        {field("certifications", "Certifications", "number", { min: 0, step: 1 })}
        {field("backlogs", "Backlogs", "number", { min: 0, step: 1 })}
        <Select label="Placement status" name="placement_status" value={values.placement_status} onChange={change} options={statuses} />
        {field("company", "Company", "text", { maxLength: 200 })}
        {field("package_lpa", "Package (LPA)", "number", { min: 0, max: 9999.99, step: 0.01 })}
      </div>
      <div className="flex flex-wrap gap-4 text-body-sm text-on-surface-variant">
        <label className="flex items-center gap-2"><input type="checkbox" name="extracurricular" checked={Boolean(values.extracurricular)} onChange={change} />Extracurricular</label>
        <label className="flex items-center gap-2"><input type="checkbox" name="placement_training" checked={Boolean(values.placement_training)} onChange={change} />Placement training</label>
      </div>
      {errors._form && <p role="alert" className="rounded-lg bg-error-container p-3 text-body-sm text-on-error-container">{errors._form}</p>}
      <div className="flex justify-end gap-2 border-t border-surface-container pt-4"><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" loading={saving}><Icon>save</Icon>Save Record</Button></div>
    </form>
  </Modal>;
}

export function ImportModal({ open, onClose, onImported }) {
  const [file, setFile] = useState(null);
  const [dryRun, setDryRun] = useState(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef(null);
  useEffect(() => { if (open) { setFile(null); setDryRun(null); } }, [open]);

  const selectFile = (candidate) => {
    if (!candidate) return;
    if (!candidate.name.toLowerCase().endsWith(".csv")) return toast.error("Choose a .csv file.");
    if (candidate.size > 5 * 1024 * 1024) return toast.error("CSV files must be 5 MB or smaller.");
    setFile(candidate);
    setDryRun(null);
  };
  const previewImport = async () => {
    if (!file) return toast.error("Select a CSV file first.");
    setBusy(true);
    try {
      setDryRun(await studentsService.import(file, { mode: "upsert", dry_run: true }));
    } catch (error) {
      toast.error(error.apiError?.message || "CSV validation failed.");
    } finally { setBusy(false); }
  };
  const confirmImport = async () => {
    if (!file || !dryRun || dryRun.valid_count < 1) return;
    setBusy(true);
    try {
      const result = await studentsService.import(file, { mode: "upsert", dry_run: false });
      toast.success(`Import complete: ${result.inserted} added, ${result.updated} updated, ${result.failed} failed.`);
      onImported();
      onClose();
    } catch (error) {
      toast.error(error.apiError?.message || "Import failed.");
    } finally { setBusy(false); }
  };
  const errorColumns = [
    { key: "row", label: "Row", sortable: false },
    { key: "field", label: "Field", sortable: false },
    { key: "message", label: "Issue", sortable: false },
  ];
  const previewColumns = [
    { key: "usn", label: "USN", sortable: false },
    { key: "full_name", label: "Student", sortable: false },
    { key: "department", label: "Dept", sortable: false },
    { key: "cgpa", label: "CGPA", sortable: false },
  ];

  return <Modal open={open} title="Import Student Master CSV" onClose={onClose}>
    <div className="max-h-[72vh] space-y-4 overflow-y-auto">
      <p className="font-label-sm text-label-sm text-on-surface-variant">UTF-8 CSV · Maximum 5 MB · Up to 5,000 rows</p>
      <div onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={(event) => { event.preventDefault(); setDragging(false); selectFile(event.dataTransfer.files?.[0]); }} className={`rounded-xl border-2 border-dashed p-7 text-center transition ${dragging ? "border-secondary bg-secondary/5" : "border-outline-variant bg-surface-container-low"}`}>
        <Icon className="mb-2 text-4xl text-secondary">cloud_upload</Icon><p className="font-headline-sm text-primary">Click to upload or drag and drop</p><p className="mt-1 break-all font-body-sm text-on-surface-variant">{file?.name || "CSV file up to 5 MB"}</p>
        <input ref={inputRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(event) => selectFile(event.target.files?.[0])} />
        <Button type="button" variant="secondary" className="mt-4" onClick={() => inputRef.current?.click()}>Browse CSV</Button>
      </div>
      <div className="rounded-lg bg-surface-container-low p-3"><p className="font-label-sm text-label-sm font-semibold text-primary">Required headers follow the student template</p><p className="mt-1 font-body-sm text-on-surface-variant">Download the CSV template from the page. Invalid rows are reported before writing.</p></div>
      {dryRun && <div className="space-y-3" aria-live="polite">
        <div className="flex flex-wrap gap-2 font-label-sm text-label-sm"><span className="rounded-full bg-emerald-50 px-3 py-1 text-emerald-800">{dryRun.valid_count} valid</span><span className={`rounded-full px-3 py-1 ${dryRun.error_count ? "bg-error-container text-on-error-container" : "bg-surface-container text-on-surface-variant"}`}>{dryRun.error_count} errors</span></div>
        {dryRun.preview?.length > 0 && <div><h4 className="mb-2 font-headline-sm text-primary">Preview (first 10 valid rows)</h4><DataTable columns={previewColumns} rows={dryRun.preview} banded={false} /></div>}
        {dryRun.errors?.length > 0 && <div><h4 className="mb-2 font-headline-sm text-error">Row errors</h4><DataTable columns={errorColumns} rows={dryRun.errors} getRowKey={(row) => `${row.row}-${row.field}`} banded={false} className="max-h-48 overflow-auto" /></div>}
      </div>}
      <div className="flex flex-wrap justify-end gap-2 border-t border-surface-container pt-4"><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>{!dryRun ? <Button type="button" disabled={!file} loading={busy} onClick={previewImport}><Icon>fact_check</Icon>Validate CSV</Button> : <Button type="button" disabled={!dryRun.valid_count} loading={busy} onClick={confirmImport}><Icon>cloud_sync</Icon>Confirm import ({dryRun.valid_count})</Button>}</div>
    </div>
  </Modal>;
}

export function StudentProfileDrawer({ studentId, open, onClose }) {
  const navigate = useNavigate();
  const [profile, setProfile] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!open || !studentId) return;
    let active = true;
    setLoading(true); setError("");
    studentsService.get(studentId).then((data) => { if (active) setProfile(data); })
      .catch((cause) => { if (active) setError(cause.apiError?.message || "Could not load student profile."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [open, studentId]);
  if (!open) return null;

  const infoFields = [
    ["Email", profile?.email], ["Department", profile?.department], ["Batch year", profile?.batch_year],
    ["CGPA", profile?.cgpa], ["10th", profile?.tenth_pct == null ? null : `${profile.tenth_pct}%`],
    ["12th", profile?.twelfth_pct == null ? null : `${profile.twelfth_pct}%`],
    ["Aptitude", profile?.aptitude_score], ["Technical", profile?.technical_score],
    ["Communication", profile?.communication_score], ["Internships", profile?.internships],
    ["Projects", profile?.projects], ["Certifications", profile?.certifications], ["Backlogs", profile?.backlogs],
    ["Company", profile?.company], ["Package", profile?.package_lpa == null ? null : `${profile.package_lpa} LPA`],
  ];
  return <div className={`fixed inset-0 z-[75] ${open ? "pointer-events-auto" : "pointer-events-none"}`} aria-hidden={!open}>
    <button type="button" aria-label="Close student details" className={`absolute inset-0 bg-primary/30 transition-opacity ${open ? "opacity-100" : "opacity-0"}`} onClick={onClose} />
    <aside role="dialog" aria-modal="true" aria-label="Student profile" className={`absolute right-0 top-0 flex h-full w-full max-w-xl flex-col bg-surface-container-lowest shadow-2xl transition-transform ${open ? "translate-x-0" : "translate-x-full"}`}>
      <header className="flex items-center justify-between border-b border-surface-container bg-surface-container-low p-5"><div><p className="font-label-sm text-label-sm uppercase tracking-wider text-secondary">Full student profile</p><h2 className="font-headline-md text-primary">{profile?.full_name || "Student details"}</h2></div><button type="button" onClick={onClose} aria-label="Close"><Icon>close</Icon></button></header>
      <div className="flex-1 space-y-5 overflow-y-auto p-5">
        {loading && <div className="space-y-3"><Skeleton className="h-8" /><Skeleton className="h-40" /><Skeleton className="h-24" /></div>}
        {error && <p role="alert" className="rounded-lg bg-error-container p-3 text-body-sm text-on-error-container">{error}</p>}
        {profile && !loading && <>
          <div className="flex flex-wrap items-center gap-2"><span className="rounded bg-surface-container px-2 py-1 font-label-sm text-label-sm text-primary">{profile.usn}</span><StatusChip status={profile.placement_status} />{profile.company && <span className="font-body-sm text-on-surface-variant">{profile.company}</span>}</div>
          <dl className="grid grid-cols-2 gap-3">{infoFields.map(([label, value]) => <div key={label} className="rounded-lg bg-surface-container-low p-3"><dt className="font-label-sm text-label-sm uppercase text-outline">{label}</dt><dd className="mt-1 break-words font-body-md text-on-surface">{value ?? "—"}</dd></div>)}</dl>
          <section className="rounded-xl border border-surface-container p-4"><h3 className="font-headline-sm text-primary">Latest skill assessment</h3>{profile.latest_skill_assessment ? <dl className="mt-3 grid grid-cols-2 gap-2 text-body-sm">{["dsa", "system_design", "core_cs", "aptitude", "communication"].map((key) => <div key={key} className="flex justify-between rounded bg-surface-container-low px-3 py-2"><dt className="capitalize text-on-surface-variant">{key.replaceAll("_", " ")}</dt><dd className="font-label-sm text-label-sm text-primary">{profile.latest_skill_assessment[key]}/100</dd></div>)}</dl> : <p className="mt-2 font-body-sm text-on-surface-variant">No skill assessment recorded.</p>}</section>
          <section className="rounded-xl border border-surface-container p-4"><h3 className="font-headline-sm text-primary">Latest prediction</h3>{profile.latest_prediction ? <div className="mt-2 flex items-center justify-between"><span className="font-body-sm text-on-surface-variant">{profile.latest_prediction.predicted_label}</span><span className="font-label-md text-label-md text-secondary">{(Number(profile.latest_prediction.probability) * 100).toFixed(1)}%</span></div> : <p className="mt-2 font-body-sm text-on-surface-variant">No saved prediction.</p>}</section>
        </>}
      </div>
      <footer className="flex flex-wrap gap-2 border-t border-surface-container p-4"><Button type="button" variant="secondary" onClick={() => { navigate(`/prediction?student_id=${studentId}`); }}>Run prediction<Icon>online_prediction</Icon></Button><Button type="button" variant="secondary" onClick={() => { navigate(`/skill-gap?student=${studentId}`); }}>Skill gap<Icon>radar</Icon></Button><Button type="button" className="ml-auto" variant="secondary" onClick={onClose}>Close</Button></footer>
    </aside>
  </div>;
}
