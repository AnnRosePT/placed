export const pct = (value, digits = 1) => (value == null || Number.isNaN(Number(value)) ? "—" : `${(Number(value) * 100).toFixed(digits)}%`);
export const num = (value, digits = 2) => (value == null || Number.isNaN(Number(value)) ? "—" : Number(value).toFixed(digits));
export const lpa = (value) => (value == null ? "—" : `₹${Number(value).toFixed(2).replace(/\.00$/, "")} LPA`);
export const int = (value) => (value == null ? "—" : Number(value).toLocaleString("en-IN"));

export function initials(name = "") {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "?";
}

export function relativeTime(iso) {
  if (!iso) return "—";
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (Number.isNaN(seconds)) return "—";
  if (seconds < 45) return "just now";
  const units = [["year", 31536000], ["month", 2592000], ["day", 86400], ["hour", 3600], ["minute", 60]];
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) {
      const n = Math.round(seconds / size);
      return `${n} ${unit}${n === 1 ? "" : "s"} ago`;
    }
  }
  return `${seconds}s ago`;
}

export function dateTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

export const FEATURE_LABELS = {
  tenth_pct: "10th marks (%)", twelfth_pct: "12th marks (%)", cgpa: "CGPA", aptitude_score: "Aptitude score",
  technical_score: "Technical score", communication_score: "Communication score", internships: "Internships",
  projects: "Projects", certifications: "Certifications / workshops", backlogs: "Active backlogs",
  extracurricular: "Extracurricular", placement_training: "Placement training",
};

export const AXIS_LABELS = {
  dsa: "DSA & Problem Solving", system_design: "System Design", core_cs: "Core CS", aptitude: "Aptitude", communication: "Communication",
};

export const DEPARTMENT_OPTIONS = [
  { value: "", label: "All departments" },
  { value: "CSE", label: "Computer Science (CSE)" },
  { value: "IT", label: "Information Technology (IT)" },
  { value: "AIDS", label: "AI & Data Science (AIDS)" },
  { value: "ECE", label: "Electronics & Communication (ECE)" },
];
