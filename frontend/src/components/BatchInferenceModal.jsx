import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { predictionService } from "../services/predictionService.js";
import { Button, Icon, Modal, Select } from "./ui/index.jsx";
import { DEPARTMENT_OPTIONS } from "../utils/format.js";

export default function BatchInferenceModal({ open, onClose, onDone, batches = [] }) {
  const [department, setDepartment] = useState("");
  const [batchYear, setBatchYear] = useState("");
  const [onlyUnpredicted, setOnlyUnpredicted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  useEffect(() => { if (open) { setResult(null); setBusy(false); } }, [open]);

  const run = async () => {
    setBusy(true);
    setResult(null);
    try {
      const data = await predictionService.batch({ department: department || null, batch_year: batchYear ? Number(batchYear) : null, only_unpredicted: onlyUnpredicted });
      setResult(data);
      toast.success(`Batch inference saved ${data.count} predictions.`);
      onDone?.(data);
    } catch (error) {
      toast.error(error.apiError?.message || "Batch inference failed.");
    } finally { setBusy(false); }
  };

  return <Modal open={open} title="Run Batch Inference" onClose={() => !busy && onClose()}>
    <div className="space-y-4">
      <p className="font-body-sm text-on-surface-variant">Scores every eligible (not opted-out) student in the selected cohort with the active model and saves each result to the prediction log.</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Select label="Department" value={department} onChange={(e) => setDepartment(e.target.value)} options={DEPARTMENT_OPTIONS} />
        <Select label="Batch year" value={batchYear} onChange={(e) => setBatchYear(e.target.value)} options={[{ value: "", label: "All batches" }, ...batches.map((b) => ({ value: String(b), label: String(b) }))]} />
      </div>
      <label className="flex items-center gap-2 font-body-sm text-on-surface"><input type="checkbox" checked={onlyUnpredicted} onChange={(e) => setOnlyUnpredicted(e.target.checked)} />Only students without a saved prediction</label>
      {busy && <div className="space-y-2" aria-live="polite"><div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-container"><div className="h-full w-1/3 animate-pulse rounded-full bg-gradient-to-r from-[#4338CA] to-[#38BDF8]" /></div><p className="font-label-sm text-label-sm text-on-surface-variant">Scoring cohort…</p></div>}
      {result && <div className="grid grid-cols-3 gap-2 rounded-lg bg-surface-container-low p-3 text-center" aria-live="polite">
        <div><p className="font-label-sm text-label-sm text-outline">SCORED</p><p className="font-headline-md text-primary tabular-nums">{result.count}</p></div>
        <div><p className="font-label-sm text-label-sm text-outline">PRED. PLACED</p><p className="font-headline-md text-secondary tabular-nums">{result.placed_pred}</p></div>
        <div><p className="font-label-sm text-label-sm text-outline">AT RISK</p><p className="font-headline-md text-error tabular-nums">{result.at_risk}</p></div>
      </div>}
      <div className="flex justify-end gap-2 border-t border-surface-container pt-4"><Button variant="secondary" onClick={onClose} disabled={busy}>{result ? "Close" : "Cancel"}</Button><Button onClick={run} loading={busy}><Icon>bolt</Icon>Run inference</Button></div>
    </div>
  </Modal>;
}
