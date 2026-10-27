"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { normalizeArabic } from "@/lib/family";

export type SearchItem = { id: number; name: string; nasab: string; gen: number | null; gender: "MALE" | "FEMALE" };

export default function SearchBox({ items }: { items: SearchItem[] }) {
  const [q, setQ] = useState("");
  const indexed = useMemo(() => items.map((it) => ({ ...it, key: normalizeArabic(it.nasab) })), [items]);
  const results = useMemo(() => {
    const nq = normalizeArabic(q);
    if (!nq) return [];
    const words = nq.split(" ");
    return indexed.filter((it) => words.every((w) => it.key.includes(w))).slice(0, 200);
  }, [q, indexed]);

  return (
    <div className="search">
      <input
        autoFocus
        type="search"
        className="input big"
        placeholder="اكتب الاسم، مثال: محمد بن أحمد"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      {q && <p className="muted">{results.length === 0 ? "لا توجد نتائج" : `${results.length} نتيجة`}</p>}
      <ul className="results">
        {results.map((r) => (
          <li key={r.id}>
            <Link href={`/person/${r.id}`} className={`result ${r.gender === "MALE" ? "m" : "f"}`}>
              <span className="rname">{r.nasab}</span>
              <span className="rgen">{r.gen != null ? `الجيل ${r.gen}` : "بالزواج"}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
