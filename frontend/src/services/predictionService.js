import api from "./api.js";

export const predictionService = {
  model: () => api.get("/model").then(({ data }) => data),
  predict: (payload) => api.post("/predict", payload).then(({ data }) => data),
  batch: (payload) => api.post("/predict/batch", payload).then(({ data }) => data),
  history: (params = {}) => api.get("/predictions", { params }).then(({ data }) => data),
  exportHistory: (params = {}) => api.get("/predictions/export.csv", { params, responseType: "blob" }),
};
