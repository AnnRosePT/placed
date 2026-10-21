import { useEffect, useRef, useState } from "react";
import { studentsService } from "../services/studentsService.js";
import { Icon } from "./ui/index.jsx";

/** Async searchable student selector backed by GET /api/students?search=. */
export default function StudentPicker({ value, onChange, placeholder = "Search by USN or name…", label = "Select student" }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const boxRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    let active = true;
    setLoading(true);
    setItems([]);
    const timer = window.setTimeout(() => {
      studentsService.list({ search: query.trim(), per_page: 12, sort: "usn", order: "asc" })
        .then((data) => { if (active) setItems(data.items || []); })
        .catch(() => { if (active) setItems([]); })
        .finally(() => { if (active) setLoading(false); });
    }, 250);
    return () => { active = false; window.clearTimeout(timer); };
  }, [query, open]);

  useEffect(() => {
    const close = (event) => { if (boxRef.current && !boxRef.current.contains(event.target)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  return <div ref={boxRef} className="relative w-full">
    <button type="button" aria-label={label} aria-expanded={open} onClick={() => setOpen((o) => !o)} className="flex min-h-[44px] w-full items-center justify-between gap-2 rounded-lg border border-outline-variant/60 bg-surface-container-lowest px-3 py-2 text-left font-body-sm text-on-surface hover:border-secondary focus:outline-none focus:ring-2 focus:ring-secondary/30">
      <span className="flex min-w-0 items-center gap-2"><Icon className="text-[18px] text-outline">badge</Icon>{value ? <span className="truncate"><span className="font-label-md text-label-md text-primary">{value.usn}</span> · {value.full_name}{value.department ? ` · ${value.department}` : ""}</span> : <span className="text-outline">{placeholder}</span>}</span>
      <Icon className="text-[18px] text-outline">unfold_more</Icon>
    </button>
    {open && <div className="absolute left-0 right-0 top-full z-40 mt-1 rounded-xl border border-surface-container bg-surface-container-lowest p-2 shadow-xl">
      <label className="relative block"><Icon className="absolute left-2 top-2.5 text-[18px] text-outline">search</Icon><input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder={placeholder} aria-label="Search students" className="h-10 w-full rounded-lg bg-surface-container-low pl-8 pr-3 font-body-sm outline-none focus:ring-2 focus:ring-secondary/30" /></label>
      <ul className="mt-2 max-h-64 overflow-y-auto" role="listbox">
        {loading && <li className="p-3 font-body-sm text-on-surface-variant">Searching…</li>}
        {!loading && items.length === 0 && <li className="p-3 font-body-sm text-on-surface-variant">No students found.</li>}
        {!loading && items.map((s) => <li key={s.id}><button type="button" role="option" aria-selected={value?.id === s.id} onClick={() => { onChange(s); setOpen(false); }} className="flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left hover:bg-surface-container-low"><span className="min-w-0"><span className="block truncate font-body-sm font-semibold text-on-surface">{s.full_name}</span><span className="font-label-sm text-label-sm text-outline">{s.usn} · {s.department} · {s.batch_year}</span></span><span className="shrink-0 font-label-sm text-label-sm text-primary">CGPA {s.cgpa ?? "—"}</span></button></li>)}
      </ul>
    </div>}
  </div>;
}
