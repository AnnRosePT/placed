import { Suspense, lazy } from "react";
import { Skeleton } from "../ui/index.jsx";

// Plotly is ~3 MB; load it only when a chart is first rendered.
const PlotlyChart = lazy(() => import("./PlotlyChart.jsx"));

export default function LazyPlot({ height = 300, ...props }) {
  return <Suspense fallback={<Skeleton className="w-full" style={{ height }} />}><div style={{ height }} className="w-full min-w-0"><PlotlyChart {...props} /></div></Suspense>;
}
