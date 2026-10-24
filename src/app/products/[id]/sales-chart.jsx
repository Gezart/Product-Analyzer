"use client";

import { useState } from "react";

const W = 720;
const H = 160;
const PAD = { top: 8, right: 8, bottom: 20, left: 32 };

/** Units sold per day: one series, thin rounded bars on a shared baseline, per-bar hover tooltip. */
export function SalesChart({ days, formatMoney }) {
  const [hover, setHover] = useState(null);
  const peak = Math.max(0, ...days.map((d) => d.units));
  const max = Math.max(1, peak);
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const slot = plotW / days.length;
  const barW = Math.max(1, slot - 2); // 2px surface gap between bars
  const y = (v) => PAD.top + plotH - (v / max) * plotH;
  const ticks = [0, Math.round(max / 2), max].filter((v, i, a) => a.indexOf(v) === i);
  const total = days.reduce((s, d) => s + d.units, 0);
  const active = hover == null ? null : days[hover];
  // Days before order history starts: shaded, not drawn as zero sales.
  const unknown = days.filter((d) => !d.known).length;

  return (
    <figure className="relative m-0">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full"
        role="img"
        aria-label={`Units sold per day, last ${days.length} days: ${total} in total, at most ${peak} on one day${unknown ? `; no order history for the first ${unknown} days` : ""}`}
        onMouseLeave={() => setHover(null)}
      >
        {unknown > 0 && (
          <g>
            <rect x={PAD.left} y={PAD.top} width={unknown * slot} height={plotH} className="fill-zinc-100" />
            <text x={PAD.left + (unknown * slot) / 2} y={PAD.top + plotH / 2} textAnchor="middle" className="fill-zinc-500 text-[10px]">
              No order history yet
            </text>
          </g>
        )}
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} className="stroke-zinc-200" strokeWidth={1} />
            <text x={PAD.left - 6} y={y(t) + 4} textAnchor="end" className="fill-zinc-500 text-[10px]">
              {t}
            </text>
          </g>
        ))}
        {days.map((d, i) => {
          const x = PAD.left + i * slot + 1;
          const h = (d.units / max) * plotH;
          const r = Math.min(4, barW / 2, h);
          const top = y(d.units);
          const base = PAD.top + plotH;
          return (
            <g key={d.date} onMouseEnter={() => setHover(i)}>
              {/* Hit target: the full column, larger than the bar. */}
              <rect x={PAD.left + i * slot} y={PAD.top} width={slot} height={plotH} fill="transparent" />
              {d.units > 0 && (
                <path
                  d={`M${x},${base} V${top + r} Q${x},${top} ${x + r},${top} H${x + barW - r} Q${x + barW},${top} ${x + barW},${top + r} V${base} Z`}
                  className={hover === i ? "fill-[#1d5fae]" : "fill-[#2a78d6]"}
                />
              )}
            </g>
          );
        })}
        <text x={PAD.left} y={H - 4} className="fill-zinc-500 text-[10px]">
          {days[0]?.date}
        </text>
        <text x={W - PAD.right} y={H - 4} textAnchor="end" className="fill-zinc-500 text-[10px]">
          {days[days.length - 1]?.date}
        </text>
      </svg>
      {active && (
        <div
          className="pointer-events-none absolute top-0 rounded border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-900 shadow-sm"
          style={{ left: `${((PAD.left + (hover + 0.5) * slot) / W) * 100}%`, transform: "translateX(-50%)" }}
        >
          <div className="font-medium">{active.date}</div>
          <div>{active.known ? `${active.units} units · ${formatMoney(active.revenue)}` : "No order history"}</div>
        </div>
      )}
    </figure>
  );
}
