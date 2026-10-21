import createPlotlyComponent from "react-plotly.js/factory";
import Plotly from "plotly.js-dist-min";

const Plot = createPlotlyComponent(Plotly);
export const chartColors = {
  navy: "#1e1b4b", indigo: "#4e45d5", violet: "#6860ef", sky: "#38bdf8", emerald: "#10b981",
  amber: "#f59e0b", rose: "#e11d48", slate: "#94a3b8", lavender: "#c3c0ff",
};
export const statusColors = { placed: chartColors.indigo, in_process: chartColors.sky, not_placed: chartColors.rose, opted_out: chartColors.slate };
export const plotlyLayoutTheme = {
  paper_bgcolor: "rgba(0,0,0,0)",
  plot_bgcolor: "rgba(0,0,0,0)",
  font: { family: "Hanken Grotesk, sans-serif", color: "#0b1c30", size: 12 },
  colorway: [chartColors.navy, chartColors.indigo, chartColors.sky, chartColors.emerald, chartColors.amber, chartColors.rose],
  margin: { t: 36, r: 16, b: 44, l: 48 },
  hoverlabel: { font: { family: "JetBrains Mono, monospace", size: 11 }, bgcolor: "#ffffff", bordercolor: "#c8c5d0" },
  xaxis: { gridcolor: "#e5eeff", zerolinecolor: "#dce9ff", tickfont: { family: "JetBrains Mono, monospace", size: 11 } },
  yaxis: { gridcolor: "#e5eeff", zerolinecolor: "#dce9ff", tickfont: { family: "JetBrains Mono, monospace", size: 11 } },
  legend: { orientation: "h", x: 0, y: 1.02, yanchor: "bottom", font: { size: 11 } },
};

// Plotly mutates the layout it receives (e.g. it writes axis.type), so every chart
// must get its own deep copy of the theme — never a shared nested object.
function merge(baseTheme, extraLayout) {
  const base = JSON.parse(JSON.stringify(baseTheme));
  const extra = JSON.parse(JSON.stringify(extraLayout));
  const out = { ...base, ...extra };
  for (const key of ["xaxis", "yaxis", "font", "margin", "legend"]) if (base[key] && extra[key]) out[key] = { ...base[key], ...extra[key] };
  return out;
}

export default function PlotlyChart({ data = [], layout = {}, config = {}, className = "", ...props }) {
  return <div className={`h-full w-full min-w-0 ${className}`}><Plot data={data} layout={merge({ ...plotlyLayoutTheme, autosize: true }, layout)} config={{ responsive: true, displaylogo: false, modeBarButtonsToRemove: ["lasso2d", "select2d"], toImageButtonOptions: { format: "png", scale: 2 }, ...config }} useResizeHandler style={{ width: "100%", height: "100%" }} {...props} /></div>;
}
