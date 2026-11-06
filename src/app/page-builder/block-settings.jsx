"use client";

import { BTN } from "@/app/ui/kit";
import { BADGE_ICONS, LIMITS } from "@/lib/page-builder";

export const INPUT = "w-full min-w-0 rounded-lg border border-line-strong bg-white px-2.5 py-2 font-[inherit] text-[13px]";
const LABEL = "text-[13px] font-semibold";
const REMOVE = "cursor-pointer border-0 bg-transparent p-0 font-[inherit] text-[13px] font-semibold text-muted hover:text-ink";

export const ICON_LABELS = { shipping: "Shipping", returns: "Returns", secure: "Secure checkout", guarantee: "Guarantee", support: "Support" };

function TextField({ label, value, max, onChange, hint }) {
  return (
    <label className="flex flex-col gap-1">
      <span className={LABEL}>{label}</span>
      <input type="text" value={value} maxLength={max} onChange={(e) => onChange(e.target.value)} className={INPUT} />
      {hint && <span className="text-xs text-muted">{hint}</span>}
    </label>
  );
}

function NumberField({ label, value, min, max, onChange, suffix }) {
  return (
    <label className="flex flex-col gap-1">
      <span className={LABEL}>{label}</span>
      <span className="flex max-w-[180px] items-center gap-1.5">
        <input type="number" value={value} min={min} max={max} step={1} onChange={(e) => onChange(Number(e.target.value))} className={INPUT} />
        {suffix && <span className="flex-none text-[13px] text-muted">{suffix}</span>}
      </span>
    </label>
  );
}

function LowStock({ settings, onChange }) {
  const { threshold } = LIMITS;
  return (
    <div className="grid gap-3 sm:grid-cols-[180px_1fr]">
      <NumberField label="Show at" value={settings.threshold} min={threshold.min} max={threshold.max} suffix="or fewer left" onChange={(v) => onChange({ ...settings, threshold: v })} />
      <TextField label="Text" value={settings.text} max={LIMITS.lowStockText} hint="{count} is replaced with the number left." onChange={(v) => onChange({ ...settings, text: v })} />
    </div>
  );
}

function TrustBadges({ settings, onChange }) {
  const setItem = (index, change) => onChange({ ...settings, items: settings.items.map((item, i) => (i === index ? { ...item, ...change } : item)) });
  const remove = (index) => onChange({ ...settings, items: settings.items.filter((_, i) => i !== index) });
  const add = () => onChange({ ...settings, items: [...settings.items, { icon: "guarantee", text: "" }] });
  return (
    <div className="flex flex-col gap-2">
      {settings.items.map((item, index) => (
        <div key={index} className="flex flex-wrap items-center gap-2">
          <select aria-label={`Badge ${index + 1} icon`} value={item.icon} onChange={(e) => setItem(index, { icon: e.target.value })} className={`${INPUT} w-auto`}>
            {BADGE_ICONS.map((icon) => (
              <option key={icon} value={icon}>
                {ICON_LABELS[icon]}
              </option>
            ))}
          </select>
          <input
            type="text"
            aria-label={`Badge ${index + 1} text`}
            value={item.text}
            maxLength={LIMITS.badgeText}
            onChange={(e) => setItem(index, { text: e.target.value })}
            className={`${INPUT} flex-[1_1_180px]`}
          />
          {settings.items.length > 1 && (
            <button type="button" onClick={() => remove(index)} className={REMOVE}>
              Remove
            </button>
          )}
        </div>
      ))}
      {settings.items.length < LIMITS.badges && (
        <button type="button" onClick={add} className={`${BTN.tiny} cursor-pointer self-start`}>
          + Add badge
        </button>
      )}
    </div>
  );
}

function SizeChart({ settings, onChange }) {
  const { rows } = settings;
  const width = rows[0].length;
  const setRows = (next) => onChange({ ...settings, rows: next });
  const setCell = (r, c, value) => setRows(rows.map((row, i) => (i === r ? row.map((cell, j) => (j === c ? value : cell)) : row)));
  const canAddRow = rows.length < LIMITS.chartRows.max;
  const canAddColumn = width < LIMITS.chartColumns.max;
  const canRemoveRow = rows.length > LIMITS.chartRows.min;
  const canRemoveColumn = width > LIMITS.chartColumns.min;

  return (
    <div className="flex flex-col gap-3">
      <TextField label="Link text" value={settings.label} max={LIMITS.title} onChange={(v) => onChange({ ...settings, label: v })} />
      <div className="overflow-x-auto">
        <table className="border-collapse text-[13px]">
          <tbody>
            {rows.map((row, r) => (
              <tr key={r}>
                {row.map((cell, c) => (
                  <td key={c} className="p-0.5">
                    <input
                      type="text"
                      aria-label={r === 0 ? `Heading ${c + 1}` : `Row ${r} column ${c + 1}`}
                      value={cell}
                      maxLength={LIMITS.cell}
                      onChange={(e) => setCell(r, c, e.target.value)}
                      className={`${INPUT} w-[104px] ${r === 0 ? "font-semibold" : ""}`}
                    />
                  </td>
                ))}
                <td className="pl-1.5">
                  {r > 0 && canRemoveRow && (
                    <button type="button" onClick={() => setRows(rows.filter((_, i) => i !== r))} aria-label={`Remove row ${r}`} className={REMOVE}>
                      ×
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap gap-2">
        {canAddRow && (
          <button type="button" onClick={() => setRows([...rows, Array(width).fill("")])} className={`${BTN.tiny} cursor-pointer`}>
            + Row
          </button>
        )}
        {canAddColumn && (
          <button type="button" onClick={() => setRows(rows.map((row) => [...row, ""]))} className={`${BTN.tiny} cursor-pointer`}>
            + Column
          </button>
        )}
        {canRemoveColumn && (
          <button type="button" onClick={() => setRows(rows.map((row) => row.slice(0, -1)))} className={`${BTN.tiny} cursor-pointer`}>
            − Last column
          </button>
        )}
      </div>
      <TextField label="Note (optional)" value={settings.note} max={LIMITS.note} hint="E.g. how to measure, or that the fit runs small." onChange={(v) => onChange({ ...settings, note: v })} />
    </div>
  );
}

function BoughtTogether({ settings, onChange }) {
  const { boughtTogether } = LIMITS;
  return (
    <div className="grid gap-3 sm:grid-cols-[1fr_180px]">
      <TextField label="Title" value={settings.title} max={LIMITS.title} onChange={(v) => onChange({ ...settings, title: v })} />
      <NumberField label="Products shown" value={settings.max} min={boughtTogether.min} max={boughtTogether.max} onChange={(v) => onChange({ ...settings, max: v })} />
    </div>
  );
}

const EDITORS = { low_stock: LowStock, trust_badges: TrustBadges, size_chart: SizeChart, bought_together: BoughtTogether };

/** The settings of one block type. */
export function BlockSettings({ type, settings, onChange }) {
  const Editor = EDITORS[type];
  return <Editor settings={settings} onChange={onChange} />;
}
