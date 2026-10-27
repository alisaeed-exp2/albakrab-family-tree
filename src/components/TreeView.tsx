"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { childGroups, ordinalAr, type Family } from "@/lib/family";

type Props = {
  family: Family;
  rootIds: number[];
  focusId?: number | null;
};

const DEFAULT_DEPTH = 4;

export default function TreeView({ family: f, rootIds, focusId }: Props) {
  const [depth, setDepth] = useState(DEFAULT_DEPTH);
  const [overrides, setOverrides] = useState<Record<number, boolean>>({});
  const [zoom, setZoom] = useState(1);

  const groupsCache = useMemo(() => new Map<number, ReturnType<typeof childGroups>>(), [f]);
  const groups = (id: number) => {
    let g = groupsCache.get(id);
    if (!g) {
      g = childGroups(f, id);
      groupsCache.set(id, g);
    }
    return g;
  };

  const isOpen = (id: number, level: number) => overrides[id] ?? level < depth;
  const toggle = (id: number, level: number) => setOverrides((o) => ({ ...o, [id]: !isOpen(id, level) }));

  const countDesc = (id: number) => groups(id).reduce((n, g) => n + g.childIds.length, 0);

  function Card({ id, spouse, note }: { id: number; spouse?: boolean; note?: string }) {
    const p = f.persons[id];
    if (!p) return null;
    const g = f.gen[id];
    return (
      <Link
        href={`/person/${id}`}
        className={`pcard ${p.gender === "MALE" ? "m" : "f"}${spouse ? " spouse" : ""}${id === focusId ? " focus" : ""}`}
        title={note}
      >
        {note && <span className="pnote">{note}</span>}
        <span className="pname">{p.name}</span>
        {!spouse && g != null && <span className="pgen">الجيل {g}</span>}
      </Link>
    );
  }

  function Node({ id, level, path }: { id: number; level: number; path: number[] }) {
    if (path.includes(id)) return null;
    const p = f.persons[id];
    if (!p) return null;
    const gs = groups(id);
    const kids = countDesc(id);
    const withKids = gs.filter((g) => g.childIds.length > 0);
    // Spouses are drawn next to the person unless children need to be grouped by marriage.
    const inline = withKids.length <= 1 && gs.filter((g) => g.spouseId != null).length <= 1;
    const open = isOpen(id, level);
    const nextPath = [...path, id];
    const multi = gs.filter((g) => g.spouseId != null).length > 1;
    const spouseNote = (i: number) =>
      multi ? (p.gender === "MALE" ? `الزوجة ${ordinalAr(i + 1, true)}` : `الزوج ${ordinalAr(i + 1, false)}`) : undefined;

    const elsewhere = gs.find((g) => g.childrenElsewhere && g.spouseId != null);

    return (
      <>
        <div className="node">
          <div className={`couple${inline && gs.some((g) => g.spouseId != null) ? " has-spouse" : ""}`}>
            <Card id={id} />
            {inline &&
              gs
                .filter((g) => g.spouseId != null)
                .map((g) => (
                  <span key={g.marriageId} className="couple-pair">
                    <span className="ring" aria-hidden>
                      ⚭
                    </span>
                    <Card id={g.spouseId!} spouse />
                  </span>
                ))}
          </div>
          {inline && elsewhere && (
            <Link className="elsewhere" href={`/?root=${elsewhere.spouseId}`}>
              الأبناء في فرع الأب
            </Link>
          )}
          {kids > 0 && (
            <button type="button" className="toggle" onClick={() => toggle(id, level)} aria-expanded={open}>
              {open ? "−" : "+"} {kids}
            </button>
          )}
        </div>

        {open && kids > 0 && inline && (
          <ul>
            {withKids[0].childIds.map((c) => (
              <li key={c}>
                <Node id={c} level={level + 1} path={nextPath} />
              </li>
            ))}
          </ul>
        )}

        {open && !inline && (
          <ul>
            {gs.map((g, i) => (
              <li key={g.marriageId ?? `none-${i}`}>
                <div className="node">
                  {g.spouseId != null ? (
                    <Card id={g.spouseId} spouse note={spouseNote(gs.filter((x) => x.spouseId != null).indexOf(g))} />
                  ) : (
                    <span className="pcard unknown">{p.gender === "MALE" ? "الأم غير مسجلة" : "الأب غير مسجل"}</span>
                  )}
                  {g.childrenElsewhere && (
                    <Link className="elsewhere" href={`/?root=${g.spouseId}`}>
                      الأبناء في فرع الأب
                    </Link>
                  )}
                </div>
                {g.childIds.length > 0 && (
                  <ul>
                    {g.childIds.map((c) => (
                      <li key={c}>
                        <Node id={c} level={level + 1} path={nextPath} />
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
      </>
    );
  }

  return (
    <div className="tree-wrap">
      <div className="tree-tools">
        <button type="button" className="btn" onClick={() => { setOverrides({}); setDepth(999); }}>
          توسيع الكل
        </button>
        <button type="button" className="btn" onClick={() => { setOverrides({}); setDepth(1); }}>
          طي الكل
        </button>
        <span className="spacer" />
        <button type="button" className="btn icon" onClick={() => setZoom((z) => Math.max(0.3, +(z - 0.1).toFixed(2)))} aria-label="تصغير">
          −
        </button>
        <span className="zoom">{Math.round(zoom * 100)}٪</span>
        <button type="button" className="btn icon" onClick={() => setZoom((z) => Math.min(1.6, +(z + 0.1).toFixed(2)))} aria-label="تكبير">
          +
        </button>
      </div>
      <div className="tree-scroll">
        <div className="tree" style={{ zoom }}>
          <ul>
            {rootIds.map((r) => (
              <li key={r}>
                <Node id={r} level={0} path={[]} />
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
