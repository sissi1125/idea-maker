"use client";

import { ParamDef } from "@/lib/stageRegistry";

interface Props {
  params: ParamDef[];
  values: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
  errors: Record<string, string>;
}

export default function ParamForm({ params, values, onChange, errors }: Props) {
  if (params.length === 0) {
    return <p className="text-xs text-zinc-400 py-2">该 method 无配置参数。</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      {params.map((param) => (
        <div key={param.key} className="flex flex-col gap-1">
          <label className="text-xs font-medium text-zinc-700 flex items-center gap-1">
            {param.label}
            {param.required && <span className="text-red-500">*</span>}
          </label>
          <ParamField param={param} value={values[param.key]} onChange={(v) => onChange(param.key, v)} />
          {param.hint && <p className="text-[10px] text-zinc-400">{param.hint}</p>}
          {errors[param.key] && (
            <p className="text-[10px] text-red-500">{errors[param.key]}</p>
          )}
        </div>
      ))}
    </div>
  );
}

function ParamField({
  param,
  value,
  onChange,
}: {
  param: ParamDef;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const base =
    "w-full rounded border border-zinc-200 bg-white px-2.5 py-1.5 text-sm text-zinc-800 outline-none focus:border-zinc-400 focus:ring-1 focus:ring-zinc-300 transition-colors";

  if (param.type === "boolean") {
    return (
      <label className="flex items-center gap-2 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(e) => onChange(e.target.checked)}
          className="h-3.5 w-3.5 rounded border-zinc-300 accent-zinc-800"
        />
        <span className="text-xs text-zinc-600">{value ? "是" : "否"}</span>
      </label>
    );
  }

  if (param.type === "select" && param.options) {
    return (
      <select
        value={String(value ?? param.default)}
        onChange={(e) => onChange(e.target.value)}
        className={base}
      >
        {param.options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    );
  }

  if (param.type === "number") {
    return (
      <input
        type="number"
        value={String(value ?? param.default)}
        min={param.min}
        max={param.max}
        step={Number.isInteger(param.default) ? 1 : 0.01}
        onChange={(e) => onChange(e.target.valueAsNumber)}
        className={base}
      />
    );
  }

  if (param.type === "textarea") {
    return (
      <textarea
        value={String(value ?? param.default ?? "")}
        placeholder={param.placeholder}
        rows={3}
        onChange={(e) => onChange(e.target.value)}
        className={`${base} resize-y`}
      />
    );
  }

  if (param.type === "json") {
    const raw = typeof value === "string" ? value : JSON.stringify(value ?? param.default, null, 2);
    return (
      <textarea
        value={raw}
        rows={3}
        onChange={(e) => onChange(e.target.value)}
        className={`${base} font-mono text-xs resize-y`}
        spellCheck={false}
      />
    );
  }

  // text fallback
  return (
    <input
      type="text"
      value={String(value ?? param.default ?? "")}
      placeholder={param.placeholder}
      onChange={(e) => onChange(e.target.value)}
      className={base}
    />
  );
}
