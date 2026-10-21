import api from "./api.js";

export const adminService = {
  settings: () => api.get("/settings").then(({ data }) => data),
  updateSettings: (settings) => api.put("/settings", settings).then(({ data }) => data),
  users: (params = {}) => api.get("/admin/users", { params }).then(({ data }) => data),
  createUser: (payload) => api.post("/admin/users", payload).then(({ data }) => data),
  updateUser: (userId, changes) => api.patch(`/admin/users/${userId}`, changes).then(({ data }) => data),
  audit: (params = {}) => api.get("/admin/audit", { params }).then(({ data }) => data),
  auditExport: (params = {}) => api.get("/admin/audit/export.csv", { params, responseType: "blob" }),
  model: () => api.get("/admin/model").then(({ data }) => data),
  retrain: () => api.post("/admin/model/retrain").then(({ data }) => data),
  job: (id) => api.get(`/admin/model/jobs/${id}`).then(({ data }) => data),
  activate: (version) => api.post(`/admin/model/activate/${encodeURIComponent(version)}`).then(({ data }) => data),
  system: () => api.get("/admin/system").then(({ data }) => data),
  health: () => api.get("/health").then(({ data }) => data),
};
