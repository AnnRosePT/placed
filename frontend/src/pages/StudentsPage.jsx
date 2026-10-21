import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import toast from "react-hot-toast";
import { studentsService } from "../services/studentsService.js";
import { adminService } from "../services/adminService.js";
import { Button, Card, DataTable, EmptyState, ErrorState, FilterChip, Icon, MetricCard, PageHeader, Select, Skeleton, StatusChip, ConfirmDialog } from "../components/ui/index.jsx";
import { ImportModal, StudentFormModal, StudentProfileDrawer } from "./StudentModals.jsx";

const DEPARTMENTS = [
	{ value: "", label: "All Departments" },
	{ value: "CSE", label: "Computer Science (CSE)" },
	{ value: "IT", label: "Information Technology (IT)" },
	{ value: "AIDS", label: "AI & Data Science (AIDS)" },
	{ value: "ECE", label: "Electronics & Communication (ECE)" },
];
const STATUSES = [
	{ value: "", label: "All statuses" },
	{ value: "placed", label: "Placed" },
	{ value: "in_process", label: "In Process" },
	{ value: "not_placed", label: "Not Placed" },
	{ value: "opted_out", label: "Opted Out" },
];
const CGPA_TIERS = [
	{ value: "", label: "All CGPA tiers" },
	{ value: "tier9", label: "≥ 9.0" },
	{ value: "tier8", label: "8.0 – 8.99" },
	{ value: "tier7", label: "7.0 – 7.99" },
	{ value: "under7", label: "< 7.0 · Support" },
];
const STATUS_LABELS = Object.fromEntries(STATUSES.map(({ value, label }) => [value, label]));
const TIER_LABELS = Object.fromEntries(CGPA_TIERS.map(({ value, label }) => [value, label]));

function defaultPageSize() {
	try { return Number(window.localStorage.getItem("placementai.default_page_size")) || 10; } catch { return 10; }
}

function initials(name = "") {
	return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "?";
}

function tierFromParams(params) {
	const min = params.get("cgpa_min");
	const max = params.get("cgpa_max");
	if (max === "6.99") return "under7";
	if (min === "9") return "tier9";
	if (min === "8" && max === "8.99") return "tier8";
	if (min === "7" && max === "7.99") return "tier7";
	return "";
}

function paramsForTier(tier) {
	if (tier === "under7") return { cgpa_min: "", cgpa_max: "6.99" };
	if (tier === "tier9") return { cgpa_min: "9", cgpa_max: "" };
	if (tier === "tier8") return { cgpa_min: "8", cgpa_max: "8.99" };
	if (tier === "tier7") return { cgpa_min: "7", cgpa_max: "7.99" };
	return { cgpa_min: "", cgpa_max: "" };
}

function downloadBlob(blob, filename) {
	const url = URL.createObjectURL(blob);
	const anchor = document.createElement("a");
	anchor.href = url;
	anchor.download = filename;
	document.body.appendChild(anchor);
	anchor.click();
	anchor.remove();
	URL.revokeObjectURL(url);
}

function SkeletonRows() {
	return <div className="overflow-hidden rounded-xl border border-surface-container bg-surface-container-lowest"><div className="grid grid-cols-6 gap-4 bg-surface-container px-4 py-3">{Array.from({ length: 6 }, (_, index) => <Skeleton key={index} className="h-3" />)}</div>{Array.from({ length: 7 }, (_, index) => <div key={index} className="grid grid-cols-6 items-center gap-4 border-t border-surface-container px-4 py-4"><div className="col-span-2 flex items-center gap-3"><Skeleton className="h-9 w-9 shrink-0 rounded-full" /><div className="w-full space-y-2"><Skeleton className="h-4 w-2/3" /><Skeleton className="h-3 w-4/5" /></div></div><Skeleton className="h-5 w-12" /><Skeleton className="h-5 w-10" /><Skeleton className="h-5 w-10" /><Skeleton className="h-5 w-20" /></div>)}</div>;
}

export default function StudentsPage() {
	const [searchParams, setSearchParams] = useSearchParams();
	const queryString = searchParams.toString();
	const [search, setSearch] = useState(searchParams.get("search") || "");
	const [department, setDepartment] = useState(searchParams.get("department") || "");
	const [status, setStatus] = useState(searchParams.get("status") || "");
	const [cgpaTier, setCgpaTier] = useState(tierFromParams(searchParams));
	const page = Math.max(1, Number(searchParams.get("page") || 1));
	const perPage = Number(searchParams.get("per_page") || defaultPageSize());
	const sort = searchParams.get("sort") || "cgpa";
	const order = searchParams.get("order") || "desc";
	const [data, setData] = useState(null);
	const [thresholds, setThresholds] = useState({ technical_threshold: 60, aptitude_threshold: 65 });
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState("");
	const [reloadKey, setReloadKey] = useState(0);
	const [formOpen, setFormOpen] = useState(false);
	const [editing, setEditing] = useState(null);
	const [importOpen, setImportOpen] = useState(false);
	const [viewId, setViewId] = useState(null);
	const [deleteTarget, setDeleteTarget] = useState(null);
	const [deleteBusy, setDeleteBusy] = useState(false);
	const [menuId, setMenuId] = useState(null);

	useEffect(() => {
		setSearch(searchParams.get("search") || "");
		setDepartment(searchParams.get("department") || "");
		setStatus(searchParams.get("status") || "");
		setCgpaTier(tierFromParams(searchParams));
	}, [queryString]);

	const updateParams = useCallback((patch, { resetPage = true } = {}) => {
		const next = new URLSearchParams(searchParams);
		Object.entries(patch).forEach(([key, value]) => {
			if (value === "" || value == null) next.delete(key);
			else next.set(key, String(value));
		});
		if (resetPage && !("page" in patch)) next.delete("page");
		setSearchParams(next, { replace: true });
	}, [searchParams, setSearchParams]);

	useEffect(() => {
		const timer = window.setTimeout(() => {
			if ((searchParams.get("search") || "") !== search.trim()) updateParams({ search: search.trim() });
		}, 300);
		return () => window.clearTimeout(timer);
	}, [search, searchParams, updateParams]);

	const requestParams = useMemo(() => {
		const tierParams = paramsForTier(tierFromParams(searchParams));
		return {
			search: searchParams.get("search") || "",
			department: searchParams.get("department") || "",
			status: searchParams.get("status") || "",
			...tierParams,
			page,
			per_page: perPage,
			sort,
			order,
		};
	}, [queryString, page, perPage, sort, order]);

	const loadStudents = useCallback(async () => {
		setLoading(true);
		setError("");
		try {
			setData(await studentsService.list(requestParams));
		} catch (cause) {
			setError(cause.apiError?.message || "Unable to load students. Check that the API is available.");
		} finally {
			setLoading(false);
		}
	}, [requestParams, reloadKey]);

	useEffect(() => { loadStudents(); }, [loadStudents]);
	useEffect(() => {
		let active = true;
		adminService.settings().then((settings) => {
			if (active) setThresholds((current) => ({ ...current, ...settings }));
		}).catch(() => {});
		return () => { active = false; };
	}, []);

	const openCreate = () => { setEditing(null); setFormOpen(true); };
	const openEdit = (student) => { setEditing(student); setFormOpen(true); setMenuId(null); };
	const refresh = () => setReloadKey((key) => key + 1);
	const exportCsv = async () => {
		try {
			const { data: blob, headers } = await studentsService.export(requestParams);
			const filename = headers["content-disposition"]?.match(/filename="?([^";]+)"?/)?.[1] || `students_${new Date().toISOString().slice(0, 10)}.csv`;
			downloadBlob(blob, filename);
			toast.success("Student export downloaded.");
		} catch (cause) { toast.error(cause.apiError?.message || "Export failed."); }
	};
	const downloadTemplate = async () => {
		try {
			const { data: blob } = await studentsService.template();
			downloadBlob(blob, "students_template.csv");
		} catch (cause) { toast.error(cause.apiError?.message || "Template download failed."); }
	};
	const deleteStudent = async () => {
		if (!deleteTarget) return;
		setDeleteBusy(true);
		try {
			await studentsService.remove(deleteTarget.id);
			toast.success("Student record deleted.");
			setDeleteTarget(null);
			refresh();
		} catch (cause) { toast.error(cause.apiError?.message || "Could not delete student."); }
		finally { setDeleteBusy(false); }
	};

	const rows = data?.items || [];
	const summary = data?.summary || {};
	const total = data?.total ?? 0;
	const activeChips = [
		department && { key: "department", label: `Dept: ${department}` },
		status && { key: "status", label: `Status: ${STATUS_LABELS[status] || status}` },
		cgpaTier && { key: "tier", label: `CGPA: ${TIER_LABELS[cgpaTier]}` },
		(searchParams.get("search") || "") && { key: "search", label: `Search: ${searchParams.get("search")}` },
	].filter(Boolean);
	const removeFilter = (key) => {
		if (key === "tier") updateParams(paramsForTier(""));
		else if (key === "search") updateParams({ search: "" });
		else updateParams({ [key]: "" });
	};
	const resetFilters = () => {
		setSearch(""); setDepartment(""); setStatus(""); setCgpaTier("");
		setSearchParams(new URLSearchParams({ per_page: String(perPage) }), { replace: true });
	};
	const changeTier = (value) => {
		setCgpaTier(value);
		updateParams(paramsForTier(value));
	};
	const changeSort = (key) => updateParams({ sort: key, order: sort === key && order === "asc" ? "desc" : "asc" }, { resetPage: false });

	const columns = [
		{ key: "full_name", label: "Student Identity", sortable: true, render: (_, student) => <div className="flex min-w-56 items-center gap-2.5"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary-container font-headline-sm text-on-primary">{initials(student.full_name)}</span><span className="flex min-w-0 flex-col"><span className="truncate font-headline-sm text-on-surface">{student.full_name}</span><span className="flex min-w-0 items-center gap-1 truncate font-label-sm text-label-sm text-outline"><span className="font-semibold text-primary">{student.usn}</span>{student.email && <><span>·</span><span className="truncate">{student.email}</span></>}</span></span></div> },
		{ key: "department", label: "Department", sortable: true, render: (value) => <span className="rounded bg-surface-container px-2 py-1 font-label-sm text-label-sm text-on-surface">{value}</span> },
		{ key: "cgpa", label: "CGPA", sortable: true, align: "right", render: (value) => <span className={`rounded-lg px-2 py-1 font-label-md text-label-md font-semibold tabular-nums ${value != null && Number(value) < 7 ? "bg-error-container text-error" : "bg-surface-container-high text-primary"}`}>{value ?? "—"}</span> },
		{ key: "aptitude_score", label: "Aptitude", sortable: true, align: "right", render: (value) => <span className="font-label-md text-label-md tabular-nums text-on-surface">{value ?? "—"}</span> },
		{ key: "technical_score", label: "Technical", sortable: true, align: "right", render: (value) => <span className={`font-label-md text-label-md tabular-nums ${value != null && Number(value) < Number(thresholds.technical_threshold) ? "font-semibold text-error" : "text-secondary"}`}>{value ?? "—"}</span> },
		{ key: "communication_score", label: "Comm.", sortable: true, align: "right", render: (value) => <span className="font-label-md text-label-md tabular-nums text-on-surface">{value ?? "—"}</span> },
		{ key: "placement_status", label: "Placement Status", sortable: true, render: (value, student) => <span className="flex flex-col items-start gap-1"><StatusChip status={value} />{student.company && <span className="pl-2 font-body-sm text-on-surface-variant">{student.company}</span>}</span> },
		{ key: "actions", label: "Actions", align: "right", sortable: false, render: (_, student) => <div className="relative flex justify-end"><button type="button" aria-label={`Actions for ${student.full_name}`} aria-expanded={menuId === student.id} onClick={() => setMenuId((current) => current === student.id ? null : student.id)} className="rounded-lg p-1.5 text-on-surface-variant hover:bg-surface-container"><Icon>more_vert</Icon></button>{menuId === student.id && <div className="absolute right-0 top-9 z-20 w-44 rounded-xl border border-surface-container bg-surface-container-lowest p-1.5 text-left shadow-xl"><button className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left font-body-sm hover:bg-surface-container-low" onClick={() => { setViewId(student.id); setMenuId(null); }}><Icon>visibility</Icon>View profile</button><button className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left font-body-sm hover:bg-surface-container-low" onClick={() => openEdit(student)}><Icon>edit</Icon>Edit record</button><button className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left font-body-sm text-error hover:bg-error-container" onClick={() => { setDeleteTarget(student); setMenuId(null); }}><Icon>delete</Icon>Delete</button></div>}</div> },
	];

	return <div className="flex flex-col gap-space-md">
		<PageHeader eyebrow="Cohort Roster" title="Student Directory & Records Management" subtitle="Search, manage, evaluate and track student records, academic metrics, and placement readiness."
			actions={<><Button type="button" variant="secondary" onClick={() => setImportOpen(true)}><Icon>upload_file</Icon>Import CSV</Button><Button type="button" variant="secondary" onClick={exportCsv}><Icon>download</Icon>Export CSV</Button><Button type="button" onClick={openCreate}><Icon>person_add</Icon>Add Student</Button></>} />

		<section aria-label="Student metrics" className="grid grid-cols-1 gap-space-sm sm:grid-cols-2 xl:grid-cols-4">
			<MetricCard label="Total enrolled" value={summary.total ?? "—"} icon="groups" trend="Matching current filters" />
			<MetricCard label="Successfully placed" value={summary.placed ?? "—"} icon="verified" trend={summary.total ? `${((summary.placed / summary.total) * 100).toFixed(1)}% of filtered students` : "Current placements"} />
			<MetricCard label="In evaluation" value={summary.in_process ?? "—"} icon="hourglass_top" trend="Active placement pipeline" />
			<MetricCard label="Requires support" value={summary.requires_support ?? "—"} icon="warning" trend="CGPA below 7.0 or low skill scores" />
		</section>

		<Card className="flex flex-col gap-3 bg-gradient-to-r from-surface-container-high via-surface-container to-surface-container-low p-space-md md:flex-row md:items-center md:justify-between">
			<div className="flex min-w-0 items-center gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-surface-container-lowest text-secondary"><Icon className="text-[22px]">dataset</Icon></span><div><h2 className="font-headline-sm text-headline-sm text-primary">Bulk Student Ingestion & Batch Updates</h2><p className="font-body-sm text-on-surface-variant">Validate CSV uploads before synchronizing student records. Uploads support up to 5,000 rows and 5 MB.</p></div></div>
			<div className="flex shrink-0 flex-wrap gap-2"><Button variant="secondary" onClick={downloadTemplate}><Icon>description</Icon>Download .CSV Template</Button><Button onClick={() => setImportOpen(true)}><Icon>cloud_upload</Icon>Batch Upload</Button></div>
		</Card>

		<Card className="flex flex-col gap-3 p-space-md">
			<div className="grid grid-cols-1 items-center gap-2 sm:grid-cols-2 xl:grid-cols-[minmax(220px,1.5fr)_repeat(3,minmax(150px,1fr))_auto]">
				<label className="relative"><Icon className="absolute left-3 top-2.5 text-[18px] text-outline">search</Icon><input value={search} onChange={(event) => setSearch(event.target.value)} className="h-10 w-full rounded-lg bg-surface-container-low pl-10 pr-3 font-body-sm outline-none focus:ring-2 focus:ring-secondary/30" placeholder="Filter by student name, USN, or roll..." aria-label="Search students" /></label>
				<Select aria-label="Department filter" value={department} onChange={(event) => { setDepartment(event.target.value); updateParams({ department: event.target.value }); }} options={DEPARTMENTS} />
				<Select aria-label="Placement status filter" value={status} onChange={(event) => { setStatus(event.target.value); updateParams({ status: event.target.value }); }} options={STATUSES} />
				<Select aria-label="CGPA tier filter" value={cgpaTier} onChange={(event) => changeTier(event.target.value)} options={CGPA_TIERS} />
				<Button variant="secondary" className="h-10" onClick={resetFilters}><Icon>filter_alt_off</Icon><span className="sm:hidden xl:inline">Reset</span></Button>
			</div>
			<div className="flex flex-wrap items-center justify-between gap-3 border-t border-surface-container pt-3">
				<div className="flex flex-wrap items-center gap-2"><span className="font-label-sm text-label-sm text-outline">Active constraints:</span>{activeChips.length ? activeChips.map((chip) => <FilterChip key={chip.key} onRemove={() => removeFilter(chip.key)}>{chip.label}</FilterChip>) : <span className="font-label-sm text-label-sm text-on-surface-variant">None</span>}</div>
				<span className="font-label-md text-label-md text-primary">{total.toLocaleString()} students</span>
			</div>
		</Card>

		{error ? <ErrorState title="Could not load students" message={error} onRetry={loadStudents} /> : loading ? <SkeletonRows /> : rows.length === 0 ? <Card><EmptyState icon="school" title="No students match these filters" description="Try removing a filter or add a student record." action={<Button onClick={openCreate}><Icon>person_add</Icon>Add Student</Button>} /></Card> : <>
			<DataTable columns={columns} rows={rows} getRowKey={(student) => student.id} sort={sort} order={order} onSort={changeSort} />
			<div className="flex flex-col gap-2 rounded-xl bg-surface-container-low px-space-md sm:flex-row sm:items-center sm:justify-between">
				<div className="flex items-center gap-3"><span className="font-body-sm text-on-surface-variant">Showing {((page - 1) * perPage) + 1} to {Math.min(page * perPage, total)} of {total} students</span><label className="flex items-center gap-2 font-body-sm text-on-surface-variant">Per page:<select aria-label="Rows per page" value={perPage} onChange={(event) => updateParams({ per_page: event.target.value, page: "" })} className="h-9 rounded bg-surface-container-lowest px-2 font-label-sm text-label-sm text-primary"><option value="10">10</option><option value="25">25</option><option value="50">50</option></select></label></div>
				<div className="flex items-center justify-end gap-1"><Button aria-label="Previous page" variant="secondary" className="h-9 w-9 px-0" disabled={page <= 1} onClick={() => updateParams({ page: page - 1 }, { resetPage: false })}><Icon>chevron_left</Icon></Button><span className="min-w-20 text-center font-label-sm text-label-sm">Page {page} / {Math.max(1, Math.ceil(total / perPage))}</span><Button aria-label="Next page" variant="secondary" className="h-9 w-9 px-0" disabled={page >= Math.ceil(total / perPage)} onClick={() => updateParams({ page: page + 1 }, { resetPage: false })}><Icon>chevron_right</Icon></Button></div>
			</div>
		</>}

		<StudentFormModal open={formOpen} student={editing} onClose={() => setFormOpen(false)} onSaved={refresh} />
		<ImportModal open={importOpen} onClose={() => setImportOpen(false)} onImported={refresh} />
		<StudentProfileDrawer studentId={viewId} open={Boolean(viewId)} onClose={() => setViewId(null)} />
		<ConfirmDialog open={Boolean(deleteTarget)} title="Delete student record" message={deleteTarget ? `Permanently delete ${deleteTarget.full_name} (${deleteTarget.usn})? Associated skill assessments will also be deleted.` : ""} confirmText={deleteBusy ? "Deleting…" : "Delete student"} destructive onCancel={() => !deleteBusy && setDeleteTarget(null)} onConfirm={deleteStudent} />
	</div>;
}
