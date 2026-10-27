"use client";

import { useMemo, useState } from "react";
import { normalizeArabic } from "@/lib/family";

export type PickerOption = { id: number; label: string };

type Props = {
  name: string;
  options: PickerOption[];
  defaultId?: number | null;
  emptyLabel?: string;
  searchPlaceholder?: string;
};

export default function PersonPicker({
  name,
  options,
  defaultId = null,
  emptyLabel = "— غير محدد —",
  searchPlaceholder = "ابحث بالاسم…",
}: Props) {
  const [query, setQuery] = useState("");
  const [value, setValue] = useState(defaultId != null ? String(defaultId) : "");

  const filtered = useMemo(() => {
    const q = normalizeArabic(query);
    let list = q ? options.filter((o) => normalizeArabic(o.label).includes(q)) : options;
    list = list.slice(0, 300);
    if (value && !list.some((o) => String(o.id) === value)) {
      const sel = options.find((o) => String(o.id) === value);
      if (sel) list = [sel, ...list];
    }
    return list;
  }, [query, options, value]);

  return (
    <div className="picker">
      <input
        type="search"
        className="input"
        placeholder={searchPlaceholder}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <select name={name} className="input" value={value} onChange={(e) => setValue(e.target.value)}>
        <option value="">{emptyLabel}</option>
        {filtered.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}
