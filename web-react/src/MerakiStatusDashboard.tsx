import React, { useEffect, useMemo, useRef, useState } from "react";
{!loading && error && <div className="text-sm text-slate-500">{error}</div>}
{!loading && !error && (!hist || hist.length === 0) && <div className="text-sm text-slate-500">No data.</div>}
{!loading && hist && hist.length > 0 && (
<LatencySparkline points={hist} />
)}
</CardContent>
</Card>
</div>
);
}


function LatencySparkline({ points }: { points: Array<{ t?: string, gateway?: number, firewall?: number, local?: number }> | any[] }) {
// Minimal inline sparkline (no external chart lib required)
// Expect points as [{ t: ISO, gateway: ms, firewall: ms, local: ms }, ...]
const ref = useRef<SVGSVGElement | null>(null);
const width = 640; const height = 160; const pad = 18;


// Normalize
const xs = points.map((p) => new Date(p.t || p.time || p.timestamp || Date.now()).getTime());
const g = points.map((p) => Number(p.gateway ?? p.ping_gateway_ms));
const f = points.map((p) => Number(p.firewall ?? p.ping_firewall_ms));
const l = points.map((p) => Number(p.local ?? p.ping_local_ms));
const all = [...g, ...f, ...l].filter((x) => Number.isFinite(x));
const max = Math.max(100, Math.max(...(all.length ? all : [100])));
const minT = Math.min(...xs); const maxT = Math.max(...xs);
const scaleX = (t: number) => pad + ((t - minT) / Math.max(1, maxT - minT)) * (width - pad * 2);
const scaleY = (v: number) => height - pad - (v / max) * (height - pad * 2);


const pathOf = (arr: number[]) => arr.map((v, i) => `${i === 0 ? "M" : "L"}${scaleX(xs[i])},${scaleY(Number.isFinite(v) ? v : max)}`).join(" ");


return (
<svg ref={ref} viewBox={`0 0 ${width} ${height}`} className="w-full">
<g>
<polyline points={`${pad},${height-pad} ${width-pad},${height-pad}`} fill="none" stroke="currentColor" opacity={0.1} />
<text x={pad} y={12} className="fill-current text-[10px] opacity-60">ms</text>
</g>
{/* gateway */}
<path d={pathOf(g)} fill="none" strokeWidth={2} stroke="currentColor" opacity={0.9} />
{/* firewall */}
<path d={pathOf(f)} fill="none" strokeWidth={2} stroke="currentColor" opacity={0.6} />
{/* local */}
<path d={pathOf(l)} fill="none" strokeWidth={2} stroke="currentColor" opacity={0.4} />
</svg>
);
}