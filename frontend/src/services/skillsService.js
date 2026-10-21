import api from "./api.js";

export const skillsService = {
  assess: (studentId, assessment) => api.post(`/students/${studentId}/skills`, assessment).then(({ data }) => data),
  gap: (studentId) => api.get(`/skills/gap/${studentId}`).then(({ data }) => data),
  gapExport: (studentId) => api.get(`/skills/gap/${studentId}/export.csv`, { responseType: "blob" }),
  cohort: (params = {}) => api.get("/skills/cohort", { params }).then(({ data }) => data),
  cohortExport: (params = {}) => api.get("/skills/cohort/export.csv", { params, responseType: "blob" }),
  setRemediation: (studentId, status) => api.patch(`/skills/remediation/${studentId}`, { status }).then(({ data }) => data),
  sync: (params = {}) => api.post("/skills/cohort/sync", null, { params }).then(({ data }) => data),
};
