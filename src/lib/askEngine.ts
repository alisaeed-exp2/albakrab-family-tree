// Server-side helpers for "حاج خبرة": find who a question is about, compute exact
// relationships, and build a small context so the AI does not need the whole tree.
import { nasab, type Family, type PersonRow } from "./family";

// ---------------------------------------------------------------------------
// Text matching
// ---------------------------------------------------------------------------

/** Like normalizeArabic, but keeps ى distinct so the word «على» never matches the name «علي». */
function norm(s: string): string {
  return s
    .normalize("NFKC")
    .replace(/[ً-ٰٟۖ-ۭ]/g, "")
    .replace(/ـ/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

const CONNECTORS = new Set(["بن", "ابن", "بنت", "ابنه"]);

function words(s: string): string[] {
  return norm(s).split(" ").filter(Boolean);
}

export type Mention = { pos: number; text: string; candidates: number[] };

/**
 * Find the people named in a text. Handles multi-word names, a leading «و»,
 * and chains such as «محمد بن أحمد بن علي» to pick the right person.
 */
export function findMentions(f: Family, text: string): Mention[] {
  const W = words(text);
  if (!W.length) return [];

  // index persons by the first word of their normalized name
  const byFirst = new Map<string, { id: number; w: string[] }[]>();
  for (const p of Object.values(f.persons)) {
    const w = words(p.name);
    if (!w.length) continue;
    const list = byFirst.get(w[0]) ?? [];
    list.push({ id: p.id, w });
    byFirst.set(w[0], list);
  }

  // a word with Arabic prefixes removed: «وبمحمد» → «بمحمد», «محمد»
  const variants = (w: string) => {
    const out = [w];
    let cur = w;
    for (let k = 0; k < 2; k++) {
      if (cur.length > 3 && /^[وبلف]/.test(cur)) {
        cur = cur.slice(1);
        out.push(cur);
      }
    }
    return out;
  };

  const matchAt = (i: number, nameWords: string[]) => {
    for (let k = 0; k < nameWords.length; k++) {
      const wk = W[i + k];
      if (wk == null) return false;
      if (k === 0 ? !variants(wk).includes(nameWords[0]) : wk !== nameWords[k]) return false;
    }
    return true;
  };

  type Hit = { id: number; end: number; score: number };
  const raw: { pos: number; hits: Hit[] }[] = [];
  for (let i = 0; i < W.length; i++) {
    const first = W[i];
    const pool = variants(first).flatMap((v) => byFirst.get(v) ?? []);
    const hits: Hit[] = [];
    for (const { id, w } of pool) {
      if (!matchAt(i, w)) continue;
      // follow «بن X بن Y» to score how well the chain fits this person's ancestry
      let end = i + w.length;
      let score = 0;
      let cur: PersonRow | undefined = f.persons[id];
      while (cur && CONNECTORS.has(W[end] ?? "")) {
        const parentId: number | null = cur.fatherId ?? null;
        const parent: PersonRow | undefined = parentId != null ? f.persons[parentId] : undefined;
        if (!parent) break;
        const pw = words(parent.name);
        if (!matchAt(end + 1, pw)) break;
        score++;
        end = end + 1 + pw.length;
        cur = parent;
      }
      hits.push({ id, end, score });
    }
    if (hits.length) raw.push({ pos: i, hits });
  }

  // keep the best-scoring candidates at each position, and skip names that are
  // only part of an earlier chain (the «أحمد» in «محمد بن أحمد»)
  const mentions: Mention[] = [];
  let coveredUntil = -1;
  for (const { pos, hits } of raw) {
    if (pos < coveredUntil) continue;
    const best = Math.max(...hits.map((h) => h.score));
    const top = hits.filter((h) => h.score === best);
    const end = Math.max(...top.map((h) => h.end));
    coveredUntil = end;
    mentions.push({ pos, text: W.slice(pos, end).join(" "), candidates: [...new Set(top.map((h) => h.id))] });
  }
  return mentions;
}

/** Ids referenced as [[12]] in a text (the assistant's previous answers). */
export function referencedIds(f: Family, text: string): number[] {
  const out = new Set<number>();
  for (const m of text.matchAll(/\[\[(\d+)\]\]/g)) {
    const id = Number(m[1]);
    if (f.persons[id]) out.add(id);
  }
  return [...out];
}

// ---------------------------------------------------------------------------
// Relationships
// ---------------------------------------------------------------------------

type Anc = Map<number, { dist: number; via: number | null }>;

/** Ancestors (including the person) with distance, father explored before mother. */
function ancestors(f: Family, id: number): Anc {
  const out: Anc = new Map([[id, { dist: 0, via: null }]]);
  const q = [id];
  while (q.length) {
    const cur = q.shift()!;
    const p = f.persons[cur];
    const d = out.get(cur)!.dist;
    for (const par of [p?.fatherId, p?.motherId]) {
      if (par != null && f.persons[par] && !out.has(par)) {
        out.set(par, { dist: d + 1, via: cur });
        q.push(par);
      }
    }
  }
  return out;
}

/** Chain from the person up to the ancestor: [person, parent, ..., ancestor]. */
function upChain(anc: Anc, ancestor: number): number[] {
  const chain = [ancestor];
  let cur = anc.get(ancestor)?.via ?? null;
  while (cur != null) {
    chain.unshift(cur);
    cur = anc.get(cur)?.via ?? null;
  }
  return chain;
}

export type Blood = { a: number; b: number; ca: number; dA: number; dB: number; up: number[]; down: number[] };

/** Closest common ancestor between two ancestor maps. */
function closest(ancA: Anc, ancB: Anc) {
  let best: { ca: number; total: number; spread: number } | null = null;
  for (const [id, { dist }] of ancA) {
    const other = ancB.get(id);
    if (!other) continue;
    const total = dist + other.dist;
    const spread = Math.abs(dist - other.dist);
    if (!best || total < best.total || (total === best.total && spread < best.spread)) best = { ca: id, total, spread };
  }
  return best;
}

/**
 * Blood relationships of b to a, searched in both directions: up from a through
 * the FATHER's side and through the MOTHER's side separately, and up from b
 * through both of b's parents. Returns the closest link on each of a's sides
 * (shortest first), so a relative through the mother is never hidden by one
 * through the father.
 */
export function bloodRelations(f: Family, a: number, b: number): Blood[] {
  if (a === b) return [];
  const ancB = ancestors(f, b);

  // a is an ancestor of b (b is a child/grandchild of a)
  if (ancB.has(a)) {
    return [{ a, b, ca: a, dA: 0, dB: ancB.get(a)!.dist, up: [a], down: upChain(ancB, a).reverse() }];
  }

  const p = f.persons[a];
  const out: Blood[] = [];
  for (const parent of [p?.fatherId, p?.motherId]) {
    if (parent == null || !f.persons[parent]) continue;
    // ancestors of a reached through this parent only
    const sub = ancestors(f, parent);
    const ancA: Anc = new Map([[a, { dist: 0, via: null }]]);
    for (const [id, v] of sub) ancA.set(id, { dist: v.dist + 1, via: v.via ?? a });
    const best = closest(ancA, ancB);
    if (!best) continue;
    out.push({
      a,
      b,
      ca: best.ca,
      dA: ancA.get(best.ca)!.dist,
      dB: ancB.get(best.ca)!.dist,
      up: upChain(ancA, best.ca), // a ... ca
      down: upChain(ancB, best.ca).reverse(), // ca ... b
    });
  }
  out.sort((x, y) => x.dA + x.dB - (y.dA + y.dB) || Math.abs(x.dA - x.dB) - Math.abs(y.dA - y.dB));
  return out;
}

/** The single shortest blood relationship (either side). */
export function bloodRelation(f: Family, a: number, b: number): Blood | null {
  return bloodRelations(f, a, b)[0] ?? null;
}

const g = (f: Family, id: number) => f.persons[id]?.gender ?? "MALE";
const isM = (f: Family, id: number) => g(f, id) === "MALE";

function sameParents(f: Family, x: number, y: number) {
  const px = f.persons[x];
  const py = f.persons[y];
  return !!px && !!py && px.fatherId != null && px.motherId != null && px.fatherId === py.fatherId && px.motherId === py.motherId;
}

function cousinTerm(f: Family, aParent: number, bParent: number, b: number) {
  const prefix = isM(f, b) ? "ابن" : "ابنة";
  const side = isM(f, aParent) ? (isM(f, bParent) ? "عم" : "عمة") : isM(f, bParent) ? "خال" : "خالة";
  return `${prefix} ${side}`;
}

/** What b is to a, in Arabic, when the shape is common enough to name. */
export function bloodTerm(f: Family, r: Blood): string | null {
  const { dA, dB, up, down, a, b } = r;
  const bm = isM(f, b);
  if (dA === 0) {
    if (dB === 1) return bm ? "ابن" : "ابنة";
    if (dB === 2) return bm ? "حفيد" : "حفيدة";
    return bm ? `حفيد من الجيل ${dB}` : `حفيدة من الجيل ${dB}`;
  }
  if (dB === 0) {
    if (dA === 1) return bm ? "أب" : "أم";
    const side = isM(f, up[1]) ? "لأب" : "لأم";
    if (dA === 2) return `${bm ? "جد" : "جدة"} ${side}`;
    return `${bm ? "جد أعلى" : "جدة عليا"} (${dA} أجيال للأعلى)`;
  }
  if (dA === 1 && dB === 1) {
    if (sameParents(f, a, b)) return bm ? "أخ شقيق" : "أخت شقيقة";
    const half = isM(f, r.ca) ? "لأب" : "لأم";
    return `${bm ? "أخ" : "أخت"} ${half}`;
  }
  if (dA === 2 && dB === 1) {
    const p = up[1];
    const t = isM(f, p) ? (bm ? "عم" : "عمة") : bm ? "خال" : "خالة";
    return sameParents(f, p, b) ? t : `${t} (أخ غير شقيق للوالد)`;
  }
  if (dA === 1 && dB === 2) {
    const s = down[1];
    return `${bm ? "ابن" : "ابنة"} ${isM(f, s) ? "أخ" : "أخت"}`;
  }
  if (dA === 2 && dB === 2) return cousinTerm(f, up[1], down[1], b);
  if (dA === 3 && dB === 1) {
    const p = up[1];
    const gp = up[2];
    const t = isM(f, gp) ? (bm ? "عم" : "عمة") : bm ? "خال" : "خالة";
    return `${t} ${isM(f, p) ? "الأب" : "الأم"}`;
  }
  if (dA === 1 && dB === 3) {
    const s = down[1];
    return `${bm ? "حفيد" : "حفيدة"} ${isM(f, s) ? "الأخ" : "الأخت"}`;
  }
  if (dA === 3 && dB === 2) return `${cousinTerm(f, up[2], down[1], b)} ${isM(f, up[1]) ? "الأب" : "الأم"}`;
  if (dA === 2 && dB === 3) {
    const c = down[2]; // b's parent, a cousin of a
    return `${bm ? "ابن" : "ابنة"} ${cousinTerm(f, up[1], down[1], c)}`;
  }
  return null;
}

function nameRef(id: number) {
  return `[[${id}]]`;
}

/** The path written out, e.g. [[1]] ← أبوه [[2]] (الجد المشترك) → ابنه [[3]] */
export function pathText(f: Family, r: Blood): string {
  const parts: string[] = [nameRef(r.up[0])];
  for (let i = 1; i < r.up.length; i++) {
    const child = r.up[i - 1];
    const parent = r.up[i];
    const rel = isM(f, parent) ? (isM(f, child) ? "أبوه" : "أبوها") : isM(f, child) ? "أمه" : "أمها";
    parts.push(`← ${rel} ${nameRef(parent)}`);
  }
  if (r.dA > 0 && r.dB > 0) parts[parts.length - 1] += " (الجد المشترك)";
  for (let i = 1; i < r.down.length; i++) {
    const parent = r.down[i - 1];
    const child = r.down[i];
    const rel = isM(f, child) ? (isM(f, parent) ? "ابنه" : "ابنها") : isM(f, parent) ? "ابنته" : "ابنتها";
    parts.push(`→ ${rel} ${nameRef(child)}`);
  }
  return parts.join(" ");
}

function spousesOf(f: Family, id: number): number[] {
  return (f.marriagesOf[id] ?? []).map((mid) => {
    const m = f.marriages[mid];
    return m.husbandId === id ? m.wifeId : m.husbandId;
  });
}

/** A full written description of how b is related to a (blood first, then marriage). */
export function describeRelation(f: Family, a: number, b: number): string {
  if (a === b) return `${nameRef(a)} و${nameRef(b)} هما الشخص نفسه.`;
  const lines: string[] = [];

  if (spousesOf(f, a).includes(b)) lines.push(`- ${nameRef(b)} ${isM(f, b) ? "زوج" : "زوجة"} ${nameRef(a)} مباشرة.`);

  const bloods = bloodRelations(f, a, b);
  const blood = bloods[0] ?? null;
  bloods.forEach((r, i) => {
    const term = bloodTerm(f, r);
    // which side of a the link goes through (a's father or a's mother)
    const side = r.dA === 0 ? "" : isM(f, r.up[1]) ? " من جهة الأب" : " من جهة الأم";
    const label = i === 0 ? (bloods.length > 1 ? "أقرب صلة بالدم" : "قرابة بالدم") : "وأيضاً قرابة بالدم";
    lines.push(
      `- ${label}${side} (لـ${nameRef(a)}): ${nameRef(b)} هو/هي ${term ? `«${term}»` : "قريب/قريبة"} لـ${nameRef(a)}.` +
        (r.dA > 0 && r.dB > 0
          ? ` الجد المشترك الأقرب ${nameRef(r.ca)}: ${nameRef(a)} يبعد عنه ${r.dA} جيل/أجيال، و${nameRef(b)} يبعد ${r.dB}.`
          : ""),
    );
    lines.push(`  المسار: ${pathText(f, r)}`);
  });
  if (blood && blood.dA > 0) {
    const p = f.persons[a];
    const missing: string[] = [];
    if (p.fatherId == null) missing.push("الأب");
    if (p.motherId == null) missing.push("الأم");
    const sides = new Set<string>(bloods.map((r) => (isM(f, r.up[1]) ? "الأب" : "الأم")));
    const noLink = ["الأب", "الأم"].filter((s) => !sides.has(s) && !missing.includes(s));
    const missingText = missing.length === 2 ? "الأب والأم غير مسجلين" : missing[0] === "الأم" ? "الأم غير مسجلة" : "الأب غير مسجل";
    if (noLink.length) lines.push(`  (لا توجد صلة من جهة ${noLink.join(" ولا ")} لـ${nameRef(a)}${missing.length ? `؛ و${missingText} في الشجرة` : ""})`);
    else if (missing.length) lines.push(`  (${missingText} لـ${nameRef(a)} في الشجرة، فلم يُبحث من ${missing.length === 2 ? "جهتهما" : missing[0] === "الأم" ? "جهتها" : "جهته"})`);
  }

  // Shortest link through one marriage, used when there is no blood link or it is shorter.
  const bloodLen = blood ? blood.dA + blood.dB : Infinity;
  let inlaw: { len: number; text: string } | null = null;
  for (const s of spousesOf(f, a)) {
    if (s === b) continue;
    const r = bloodRelation(f, s, b);
    if (!r) continue;
    const len = r.dA + r.dB + 1;
    if (!inlaw || len < inlaw.len) {
      const term = bloodTerm(f, r);
      inlaw = {
        len,
        text: `${nameRef(b)} هو/هي ${term ? `«${term}»` : "قريب/قريبة"} لـ${nameRef(s)} ${isM(f, s) ? "زوج" : "زوجة"} ${nameRef(a)}. المسار: ${pathText(f, r)}`,
      };
    }
  }
  for (const s of spousesOf(f, b)) {
    if (s === a) continue;
    const r = bloodRelation(f, a, s);
    if (!r) continue;
    const len = r.dA + r.dB + 1;
    if (!inlaw || len < inlaw.len) {
      const term = bloodTerm(f, r);
      inlaw = {
        len,
        text: `${nameRef(b)} ${isM(f, b) ? "زوج" : "زوجة"} ${nameRef(s)}، و${nameRef(s)} هو/هي ${term ? `«${term}»` : "قريب/قريبة"} لـ${nameRef(a)}. المسار: ${pathText(f, r)}`,
      };
    }
  }
  if (inlaw && inlaw.len < bloodLen) lines.push(`- ${blood ? "صلة أقصر " : "صلة "}بالمصاهرة (عبر زواج): ${inlaw.text}`);

  if (!lines.length) lines.push(`- لا توجد صلة قرابة مسجلة بين ${nameRef(a)} و${nameRef(b)} في الشجرة (لا بالدم ولا عبر زواج واحد).`);
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Context building
// ---------------------------------------------------------------------------

function line(f: Family, id: number): string {
  const p = f.persons[id];
  const gen = f.gen[id];
  return [
    `[${id}] ${p.name}`,
    p.gender === "MALE" ? "ذ" : "ث",
    gen != null ? `ج${gen}` : "ز",
    p.fatherId != null ? `أب${p.fatherId}` : "",
    p.motherId != null ? `أم${p.motherId}` : "",
  ]
    .filter(Boolean)
    .join("|");
}

const LEGEND =
  "صيغة السطر: [الرقم] الاسم|ذ=ذكر أو ث=أنثى|جN=الجيل N أو ز=من خارج العائلة بالزواج|أبN=رقم الأب|أمN=رقم الأم";

function stats(f: Family): string {
  const people = Object.values(f.persons);
  const perGen = new Map<number, number>();
  for (const id of Object.keys(f.gen)) {
    const gnum = f.gen[Number(id)];
    perGen.set(gnum, (perGen.get(gnum) ?? 0) + 1);
  }
  const gens = [...perGen.keys()].sort((x, y) => x - y);
  const top = people
    .map((p) => ({ id: p.id, n: (f.childrenOf[p.id] ?? []).length }))
    .filter((x) => x.n > 0)
    .sort((x, y) => y.n - x.n)
    .slice(0, 5);
  return [
    "## إحصاءات الشجرة كاملة",
    `- عدد المسجلين: ${people.length}، منهم ${Object.keys(f.blood).length} من أفراد العائلة بالدم، و${people.length - Object.keys(f.blood).length} بالزواج.`,
    `- عدد الأجيال: ${gens.length ? gens[gens.length - 1] : 0}. عدد الأفراد في كل جيل: ${gens.map((x) => `ج${x}=${perGen.get(x)}`).join("، ")}.`,
    `- الجد/الأجداد الكبار: ${f.roots.map((r) => `[${r}] ${f.persons[r].name}`).join("، ") || "لا يوجد"}.`,
    `- الأكثر أبناءً: ${top.map((x) => `[${x.id}] ${nasab(f, x.id, 2)} (${x.n})`).join("، ") || "لا يوجد"}.`,
  ].join("\n");
}

type Msg = { role: "user" | "assistant"; content: string };

export type AskContext = { text: string; mode: "focused" | "full"; people: number; mentions: number };

const MAX_FOCUSED = 250;

export function buildAskContext(f: Family, messages: Msg[]): AskContext {
  const last = messages[messages.length - 1]?.content ?? "";
  const mentions = findMentions(f, last).slice(0, 6);

  // people carried over from the conversation (follow-up questions such as «وما صلته بأخيه؟»)
  const carried = new Set<number>();
  for (const m of messages.slice(-4, -1)) {
    if (m.role === "assistant") referencedIds(f, m.content).slice(0, 12).forEach((id) => carried.add(id));
    else findMentions(f, m.content).forEach((x) => x.candidates.slice(0, 4).forEach((id) => carried.add(id)));
  }

  if (!mentions.length && !carried.size) {
    // General question: compact full tree.
    const ids = Object.values(f.persons)
      .map((p) => p.id)
      .sort((x, y) => (f.gen[x] ?? 99) - (f.gen[y] ?? 99) || x - y);
    const marriages = Object.values(f.marriages).map((m) => `${m.husbandId}⚭${m.wifeId}`);
    return {
      mode: "full",
      people: ids.length,
      mentions: 0,
      text: [
        stats(f),
        "",
        "## جميع الأشخاص",
        LEGEND,
        ...ids.map((id) => line(f, id)),
        "",
        "## الزيجات (رقم الزوج⚭رقم الزوجة، بترتيب الزوجات)",
        marriages.join(" "),
      ].join("\n"),
    };
  }

  const sections: string[] = [stats(f), ""];
  const include = new Set<number>();
  const add = (id: number | null | undefined) => {
    if (id != null && f.persons[id] && include.size < MAX_FOCUSED) include.add(id);
  };

  // who the question is about
  sections.push("## الأشخاص المذكورون في السؤال");
  for (const m of mentions) {
    if (m.candidates.length === 1) {
      sections.push(`- «${m.text}» = [[${m.candidates[0]}]] (${nasab(f, m.candidates[0], 6)})`);
    } else {
      sections.push(`- «${m.text}» يطابق ${m.candidates.length} أشخاص:`);
      m.candidates.slice(0, 8).forEach((c) => sections.push(`  - [[${c}]] ${nasab(f, c, 6)}`));
    }
  }
  if (carried.size) sections.push(`- أشخاص من المحادثة السابقة: ${[...carried].map((c) => `[[${c}]]`).join(" ")}`);

  // exact relationships between consecutive people named in the question
  const relLines: string[] = [];
  for (let i = 0; i + 1 < mentions.length && i < 3; i++) {
    const as = mentions[i].candidates.slice(0, 3);
    const bs = mentions[i + 1].candidates.slice(0, 3);
    for (const a of as) {
      for (const b of bs) {
        if (a === b) continue;
        relLines.push(`### صلة [[${b}]] بـ[[${a}]]`);
        relLines.push(describeRelation(f, a, b));
        for (const r of bloodRelations(f, a, b)) {
          r.up.forEach(add);
          r.down.forEach(add);
        }
      }
    }
  }
  // a single person named in a follow-up: relate them to the previous focus
  if (mentions.length === 1 && carried.size && mentions[0].candidates.length <= 3) {
    const prev = [...carried].filter((c) => !mentions[0].candidates.includes(c)).slice(0, 2);
    for (const a of prev) {
      for (const b of mentions[0].candidates) {
        relLines.push(`### صلة [[${b}]] بـ[[${a}]]`);
        relLines.push(describeRelation(f, a, b));
      }
    }
  }
  if (relLines.length) {
    sections.push("", "## صلات القرابة المحسوبة (دقيقة ومحسوبة آلياً من الشجرة — اعتمد عليها كما هي)", ...relLines);
  }

  // close family of everyone involved
  const focus = [...mentions.flatMap((m) => m.candidates.slice(0, 8)), ...carried];
  for (const id of focus) {
    add(id);
    const p = f.persons[id];
    if (!p) continue;
    // all ancestors, through both the father's and the mother's side
    let n = 0;
    for (const anc of ancestors(f, id).keys()) {
      if (n++ > 40) break;
      add(anc);
    }
    spousesOf(f, id).forEach(add);
    for (const c of f.childrenOf[id] ?? []) {
      add(c);
      (f.childrenOf[c] ?? []).forEach(add); // grandchildren
    }
    for (const par of [p.fatherId, p.motherId]) if (par != null) (f.childrenOf[par] ?? []).forEach(add); // siblings
  }

  const ids = [...include].sort((x, y) => (f.gen[x] ?? 99) - (f.gen[y] ?? 99) || x - y);
  const marriages = Object.values(f.marriages)
    .filter((m) => include.has(m.husbandId) && include.has(m.wifeId))
    .map((m) => `${m.husbandId}⚭${m.wifeId}`);
  sections.push(
    "",
    `## جزء الشجرة المتعلق بالسؤال (${ids.length} من ${Object.keys(f.persons).length} شخصاً — وليس الشجرة كاملة)`,
    LEGEND,
    ...ids.map((id) => line(f, id)),
    "",
    "## الزيجات بين هؤلاء (رقم الزوج⚭رقم الزوجة)",
    marriages.join(" ") || "لا يوجد",
  );

  return { mode: "focused", people: ids.length, mentions: mentions.length, text: sections.join("\n") };
}
