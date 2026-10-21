import { useState } from "react";

const buttonStyles = {
  primary: "bg-primary-container text-on-primary hover:bg-primary",
  secondary: "bg-surface-container text-on-surface hover:bg-surface-container-high",
  destructive: "bg-error text-on-error hover:opacity-90",
  accent: "bg-secondary text-on-secondary hover:bg-secondary-container",
};

export function Icon({ children, className = "", ...props }) {
  return <span className={`material-symbols-outlined ${className}`} aria-hidden="true" {...props}>{children}</span>;
}

export function Button({ variant = "primary", loading = false, disabled, className = "", children, ...props }) {
  return <button disabled={disabled || loading} className={`inline-flex items-center justify-center gap-2 min-h-[40px] rounded-lg px-4 py-2 font-body-sm text-body-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-secondary focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-60 ${buttonStyles[variant] || buttonStyles.primary} ${className}`} {...props}>
    {loading && <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-r-transparent" />}{children}
  </button>;
}

export function Card({ className = "", children, ...props }) {
  return <section className={`rounded-xl border border-surface-container bg-surface-container-lowest shadow-sm ${className}`} {...props}>{children}</section>;
}

export function MetricCard({ label, value, unit, trend, icon, className = "" }) {
  return <Card className={`p-space-lg ${className}`}><div className="flex items-start justify-between gap-3"><div><p className="font-label-sm text-label-sm uppercase tracking-wider text-outline">{label}</p><div className="mt-2 flex items-baseline gap-1"><span className="font-headline-xl text-headline-xl tabular-nums text-primary">{value ?? "—"}</span>{unit && <span className="font-label-sm text-label-sm text-on-surface-variant">{unit}</span>}</div></div>{icon && <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-surface-container text-secondary"><Icon>{icon}</Icon></span>}</div>{trend && <p className="mt-4 font-body-sm text-body-sm text-on-surface-variant">{trend}</p>}</Card>;
}

const statusStyles = {
  placed: "bg-emerald-50 text-emerald-800",
  in_process: "bg-amber-50 text-amber-800",
  not_placed: "bg-rose-50 text-rose-800",
  opted_out: "bg-surface-container text-on-surface-variant",
};
const statusLabels = { placed: "Placed", in_process: "In Process", not_placed: "Not Placed", opted_out: "Opted Out" };
export function StatusChip({ status }) {
  return <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-label-sm text-label-sm font-semibold ${statusStyles[status] || statusStyles.opted_out}`}><span className="h-1.5 w-1.5 rounded-full bg-current" />{statusLabels[status] || status}</span>;
}

export function DataTable({ columns = [], rows = [], getRowKey = (row) => row.id, onSort, sort, order = "asc", banded = true, className = "" }) {
  return <div className={`w-full overflow-x-auto rounded-xl border border-surface-container bg-surface-container-lowest ${className}`}><table className="w-full min-w-[680px] border-collapse text-left font-body-md text-body-md"><thead className="bg-surface-container text-label-sm text-on-surface-variant"><tr>{columns.map((column) => <th key={column.key} className={`whitespace-nowrap px-space-md py-3 font-semibold uppercase tracking-wider ${column.align === "right" ? "text-right" : ""}`}><button type="button" className="inline-flex items-center gap-1 disabled:cursor-default" disabled={!column.sortable} onClick={() => onSort?.(column.key)}>{column.label}{column.sortable && <Icon className="text-[15px]">{sort === column.key ? order === "asc" ? "arrow_upward" : "arrow_downward" : "unfold_more"}</Icon>}</button></th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={getRowKey(row)} className={`${banded && index % 2 ? "bg-surface-container-low/50" : ""} border-t border-surface-container-high/60 hover:bg-surface-container-low transition-colors`}>{columns.map((column) => <td key={column.key} className={`px-space-md py-3 ${column.align === "right" ? "text-right" : ""}`}>{column.render ? column.render(row[column.key], row) : row[column.key] ?? "—"}</td>)}</tr>)}</tbody></table>{rows.length === 0 && <div className="p-6 text-center text-body-sm text-on-surface-variant">No records</div>}</div>;
}

export function Pagination({ page, perPage, total, onPageChange }) {
  const pages = Math.max(1, Math.ceil(total / perPage));
  return <div className="flex items-center justify-between gap-3 py-3 font-label-sm text-label-sm text-on-surface-variant"><span>{total ? `${(page - 1) * perPage + 1}–${Math.min(page * perPage, total)} of ${total}` : "0 results"}</span><div className="flex gap-2"><Button variant="secondary" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>Previous</Button><Button variant="secondary" disabled={page >= pages} onClick={() => onPageChange(page + 1)}>Next</Button></div></div>;
}

export function Select({ label, options = [], className = "", ...props }) {
  return <label className="flex flex-col gap-1.5">{label && <span className="font-label-sm text-label-sm uppercase tracking-wider text-outline">{label}</span>}<select className={`h-10 rounded-lg border-0 bg-surface-container-low px-3 font-body-sm text-on-surface outline-none focus:ring-2 focus:ring-secondary/30 ${className}`} {...props}>{options.map((option) => typeof option === "string" ? <option key={option}>{option}</option> : <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>;
}

export function Input({ label, error, className = "", ...props }) {
  return <label className="flex flex-col gap-1.5">{label && <span className="font-label-sm text-label-sm uppercase tracking-wider text-on-surface">{label}</span>}<input className={`h-10 w-full rounded-lg border border-outline-variant/50 bg-surface-container-lowest px-3 font-body-md text-on-surface outline-none transition focus:ring-2 focus:ring-secondary/30 ${className}`} {...props} />{error && <span className="text-body-sm text-error">{error}</span>}</label>;
}

export function FilterChip({ children, onRemove }) {
  return <span className="inline-flex items-center gap-1 rounded-full bg-surface-container-high px-2.5 py-1 font-label-sm text-label-sm text-on-surface">{children}{onRemove && <button type="button" aria-label="Remove filter" onClick={onRemove}><Icon className="text-[14px]">close</Icon></button>}</span>;
}

export function ProgressBar({ value = 0, className = "" }) {
  const clamped = Math.min(100, Math.max(0, Number(value) || 0));
  return <div className={`h-1.5 w-full overflow-hidden rounded-full bg-surface-container ${className}`} role="progressbar" aria-valuenow={clamped} aria-valuemin="0" aria-valuemax="100"><div className="h-full rounded-full bg-gradient-to-r from-[#4338CA] to-[#38BDF8] transition-all" style={{ width: `${clamped}%` }} /></div>;
}

export function Modal({ open, title, onClose, children, footer }) {
  if (!open) return null;
  return <div className="fixed inset-0 z-[80] flex items-center justify-center bg-primary/40 p-4" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose?.()}><section role="dialog" aria-modal="true" aria-label={title} className="w-full max-w-lg rounded-xl bg-surface-container-lowest p-6 shadow-2xl"><header className="mb-4 flex items-center justify-between"><h2 className="font-headline-md text-headline-md text-primary">{title}</h2><button type="button" onClick={onClose} aria-label="Close"><Icon>close</Icon></button></header>{children}{footer && <footer className="mt-6 flex justify-end gap-2">{footer}</footer>}</section></div>;
}

export function ConfirmDialog({ open, title = "Confirm action", message, onConfirm, onCancel, confirmText = "Confirm", destructive = false }) {
  return <Modal open={open} title={title} onClose={onCancel} footer={<><Button variant="secondary" onClick={onCancel}>Cancel</Button><Button variant={destructive ? "destructive" : "primary"} onClick={onConfirm}>{confirmText}</Button></>}><p className="font-body-md text-on-surface-variant">{message}</p></Modal>;
}

export function Skeleton({ className = "h-4 w-full", ...props }) {
  return <div className={`animate-pulse rounded bg-surface-container ${className}`} aria-hidden="true" {...props} />;
}

export function EmptyState({ icon = "inbox", title = "No data yet", description, action }) {
  return <div className="flex flex-col items-center justify-center gap-2 p-10 text-center"><Icon className="text-4xl text-outline">{icon}</Icon><h3 className="font-headline-md text-headline-md text-primary">{title}</h3>{description && <p className="max-w-md font-body-sm text-on-surface-variant">{description}</p>}{action}</div>;
}

export function ErrorState({ title = "Something went wrong", message, onRetry }) {
  return <div className="rounded-xl bg-error-container p-5 text-on-error-container"><div className="flex items-start gap-3"><Icon>error</Icon><div><h3 className="font-headline-sm text-headline-sm">{title}</h3><p className="mt-1 font-body-sm">{message}</p>{onRetry && <Button className="mt-3" variant="secondary" onClick={onRetry}>Try again</Button>}</div></div></div>;
}

export function PageHeader({ eyebrow, title, subtitle, actions }) {
  return <header className="flex flex-col justify-between gap-space-md rounded-xl bg-surface-container-lowest p-space-lg shadow-sm xl:flex-row xl:items-center"><div className="min-w-0"><div className="mb-1 flex items-center gap-2 font-label-sm text-label-sm uppercase tracking-wider text-secondary"><span className="h-1.5 w-1.5 rounded-full bg-secondary" />{eyebrow || "PlacementAI"}</div><h1 className="font-headline-xl text-headline-xl text-primary">{title}</h1>{subtitle && <p className="mt-1 max-w-3xl font-body-md text-on-surface-variant">{subtitle}</p>}</div>{actions && <div className="flex flex-wrap gap-2">{actions}</div>}</header>;
}

export function useDisclosure(initial = false) {
  const [open, setOpen] = useState(initial);
  return { open, onOpen: () => setOpen(true), onClose: () => setOpen(false), toggle: () => setOpen((value) => !value) };
}

export function Badge({ tone = "neutral", className = "", children }) {
  const tones = {
    neutral: "bg-surface-container text-on-surface-variant",
    info: "bg-secondary-fixed text-on-secondary-fixed-variant",
    success: "bg-emerald-50 text-emerald-800",
    warning: "bg-amber-50 text-amber-800",
    danger: "bg-error-container text-on-error-container",
    dark: "bg-primary-container text-on-primary",
  };
  return <span className={`inline-flex items-center gap-1 rounded px-2 py-0.5 font-label-sm text-label-sm font-semibold ${tones[tone] || tones.neutral} ${className}`}>{children}</span>;
}

export function Segmented({ options, value, onChange, label }) {
  return <div role="tablist" aria-label={label} className="inline-flex rounded-lg bg-surface-container-low p-1">{options.map((option) => <button key={option.value} type="button" role="tab" aria-selected={value === option.value} onClick={() => onChange(option.value)} className={`min-h-[36px] rounded px-3 py-1.5 font-label-sm text-label-sm transition ${value === option.value ? "bg-surface-container-lowest font-semibold text-primary shadow-sm" : "text-on-surface-variant hover:text-on-surface"}`}>{option.label}</button>)}</div>;
}

export function Drawer({ open, title, eyebrow, onClose, children, footer, width = "max-w-xl" }) {
  if (!open) return null;
  return <div className="fixed inset-0 z-[75]">
    <button type="button" aria-label="Close panel" className="absolute inset-0 bg-primary/30" onClick={onClose} />
    <aside role="dialog" aria-modal="true" aria-label={title} className={`absolute right-0 top-0 flex h-full w-full ${width} flex-col bg-surface-container-lowest shadow-2xl`}>
      <header className="flex items-center justify-between border-b border-surface-container bg-surface-container-low p-5"><div className="min-w-0">{eyebrow && <p className="font-label-sm text-label-sm uppercase tracking-wider text-secondary">{eyebrow}</p>}<h2 className="truncate font-headline-md text-headline-md text-primary">{title}</h2></div><button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-2 hover:bg-surface-container"><Icon>close</Icon></button></header>
      <div className="flex-1 overflow-y-auto p-5">{children}</div>
      {footer && <footer className="flex flex-wrap gap-2 border-t border-surface-container p-4">{footer}</footer>}
    </aside>
  </div>;
}

export function SectionTitle({ title, subtitle, icon, actions }) {
  return <div className="mb-space-md flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div className="flex min-w-0 items-start gap-2">{icon && <Icon className="mt-0.5 text-secondary">{icon}</Icon>}<div className="min-w-0"><h2 className="font-headline-md text-headline-md text-primary">{title}</h2>{subtitle && <p className="mt-0.5 font-body-sm text-body-sm text-on-surface-variant">{subtitle}</p>}</div></div>{actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}</div>;
}

export function Stat({ label, value, hint, tone = "text-primary" }) {
  return <div className="min-w-0"><p className="font-label-sm text-label-sm uppercase tracking-wider text-outline">{label}</p><p className={`mt-1 font-headline-md text-headline-md tabular-nums ${tone}`}>{value}</p>{hint && <p className="font-body-sm text-body-sm text-on-surface-variant">{hint}</p>}</div>;
}
