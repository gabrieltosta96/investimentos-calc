import { useEffect, useRef } from "react";
import { renderLineChart } from "../pages/investimentos/lib/charts.js";

// SVG line chart with crosshair tooltip (values in R$). Redraws on resize.
export const LineChart = ({ series, label }: { series: Parameters<typeof renderLineChart>[1]; label?: string }) => {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const draw = () => ref.current && renderLineChart(ref.current, series, { label });
    draw();
    let timer: number | undefined;
    const onResize = () => {
      clearTimeout(timer);
      timer = window.setTimeout(draw, 150);
    };
    window.addEventListener("resize", onResize);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("resize", onResize);
    };
  }, [series, label]);
  return <div ref={ref} className="chart" />;
};
