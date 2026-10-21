import api from "./api.js";

const get = (path, params) => api.get(path, { params }).then(({ data }) => data);
export const analyticsService = {
  dashboard: (params = {}) => get("/dashboard", params),
  activity: () => get("/dashboard/activity"),
  dashboardSummary: (params = {}) => api.get("/dashboard/summary.csv", { params, responseType: "blob" }),
  overview: (params = {}) => get("/analytics/overview", params),
  departments: (params = {}) => get("/analytics/departments", params),
  correlation: (params = {}) => get("/analytics/cgpa-correlation", params),
  packages: (params = {}) => get("/analytics/packages", params),
  skills: (params = {}) => get("/analytics/skills", params),
  reportHistory: () => get("/reports/history"),
  report: (path, params = {}) => api.get(`/reports/${path}`, { params, responseType: "blob" }),
};
