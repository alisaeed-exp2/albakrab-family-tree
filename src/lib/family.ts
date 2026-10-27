// Pure helpers shared by server and client components (no database access here).

export type Gender = "MALE" | "FEMALE";

export type PersonRow = {
  id: number;
  name: string;
  gender: Gender;
  fatherId: number | null;
  motherId: number | null;
  parentMarriageId: number | null;
};

export type MarriageRow = {
  id: number;
  husbandId: number;
  wifeId: number;
  order: number;
};

export type Family = {
  persons: Record<number, PersonRow>;
  marriages: Record<number, MarriageRow>;
  /** marriage ids for each person, ordered */
  marriagesOf: Record<number, number[]>;
  /** children ids (by father or mother) for each person */
  childrenOf: Record<number, number[]>;
  /** top ancestors of the family */
  roots: number[];
  /** people descended from a root (by blood), including the roots */
  blood: Record<number, true>;
  /** generation number, 1 = root ancestors */
  gen: Record<number, number>;
};

export type ChildGroup = {
  marriageId: number | null;
  spouseId: number | null;
  childIds: number[];
  /** the children of this marriage are shown under the other spouse */
  childrenElsewhere: boolean;
};

export function computeFamily(personRows: PersonRow[], marriageRows: MarriageRow[]): Family {
  const persons: Record<number, PersonRow> = {};
  const marriages: Record<number, MarriageRow> = {};
  const marriagesOf: Record<number, number[]> = {};
  const childrenOf: Record<number, number[]> = {};

  for (const p of personRows) {
    persons[p.id] = p;
    marriagesOf[p.id] = [];
    childrenOf[p.id] = [];
  }
  const sortedMarriages = [...marriageRows].sort((a, b) => a.order - b.order || a.id - b.id);
  for (const m of sortedMarriages) {
    marriages[m.id] = m;
    marriagesOf[m.husbandId]?.push(m.id);
    marriagesOf[m.wifeId]?.push(m.id);
  }
  for (const p of personRows) {
    if (p.fatherId != null && childrenOf[p.fatherId]) childrenOf[p.fatherId].push(p.id);
    if (p.motherId != null && p.motherId !== p.fatherId && childrenOf[p.motherId]) childrenOf[p.motherId].push(p.id);
  }

  const hasParents = (id: number) => {
    const p = persons[id];
    return !!p && (p.fatherId != null || p.motherId != null);
  };
  const spousesOf = (id: number) =>
    (marriagesOf[id] ?? []).map((mid) => {
      const m = marriages[mid];
      return m.husbandId === id ? m.wifeId : m.husbandId;
    });

  // Roots: no parents, not married into a family member, and not the wife of another root.
  const roots: number[] = [];
  for (const p of personRows) {
    if (hasParents(p.id)) continue;
    const spouses = spousesOf(p.id);
    if (spouses.some(hasParents)) continue;
    if (p.gender === "FEMALE" && spouses.length > 0) continue;
    roots.push(p.id);
  }

  // Blood members: everyone reachable from the roots through children.
  const blood: Record<number, true> = {};
  const queue = [...roots];
  for (const r of roots) blood[r] = true;
  while (queue.length) {
    const id = queue.shift()!;
    for (const c of childrenOf[id] ?? []) {
      if (!blood[c]) {
        blood[c] = true;
        queue.push(c);
      }
    }
  }

  // Generations: follow the father if he is a family member, otherwise the mother.
  const gen: Record<number, number> = {};
  const rootSet = new Set(roots);
  const genOf = (id: number, guard: Set<number>): number => {
    if (gen[id] != null) return gen[id];
    if (rootSet.has(id)) return (gen[id] = 1);
    if (guard.has(id)) return 1;
    guard.add(id);
    const parent = bloodParentIn(persons, blood, id);
    const g = parent == null ? 1 : genOf(parent, guard) + 1;
    gen[id] = g;
    return g;
  };
  for (const id of Object.keys(blood)) genOf(Number(id), new Set());

  return { persons, marriages, marriagesOf, childrenOf, roots, blood, gen };
}

function bloodParentIn(persons: Record<number, PersonRow>, blood: Record<number, true>, id: number) {
  const p = persons[id];
  if (!p) return null;
  if (p.fatherId != null && blood[p.fatherId]) return p.fatherId;
  if (p.motherId != null && blood[p.motherId]) return p.motherId;
  return null;
}

/** The parent under whom this person is drawn in the tree. */
export function displayParent(f: Family, id: number): number | null {
  return bloodParentIn(f.persons, f.blood, id);
}

/** Children of a person grouped by marriage, as drawn under that person. */
export function childGroups(f: Family, id: number): ChildGroup[] {
  const p = f.persons[id];
  if (!p) return [];
  const groups: ChildGroup[] = [];
  const placed = new Set<number>();

  for (const mid of f.marriagesOf[id] ?? []) {
    const m = f.marriages[mid];
    const spouseId = m.husbandId === id ? m.wifeId : m.husbandId;
    const kids = (f.childrenOf[id] ?? []).filter((c) => {
      const cp = f.persons[c];
      return cp.parentMarriageId === m.id || (cp.fatherId === m.husbandId && cp.motherId === m.wifeId);
    });
    kids.forEach((k) => placed.add(k));
    const elsewhere = kids.length > 0 && kids.every((k) => displayParent(f, k) !== id);
    groups.push({
      marriageId: m.id,
      spouseId,
      childIds: elsewhere ? [] : kids.filter((k) => displayParent(f, k) === id),
      childrenElsewhere: elsewhere,
    });
  }

  const others = (f.childrenOf[id] ?? []).filter((c) => !placed.has(c) && displayParent(f, c) === id);
  if (others.length) groups.push({ marriageId: null, spouseId: null, childIds: others, childrenElsewhere: false });
  return groups;
}

/** Full patrilineal name: محمد بن أحمد بن علي */
export function nasab(f: Family, id: number, maxDepth = 40): string {
  const p = f.persons[id];
  if (!p) return "";
  const parts = [p.name];
  let cur = p;
  const seen = new Set<number>([id]);
  for (let i = 0; i < maxDepth; i++) {
    if (cur.fatherId == null || seen.has(cur.fatherId)) break;
    const father = f.persons[cur.fatherId];
    if (!father) break;
    parts.push((i === 0 && p.gender === "FEMALE" ? "بنت " : "بن ") + father.name);
    seen.add(father.id);
    cur = father;
  }
  return parts.join(" ");
}

/** Chain of ancestors through the father, oldest first (not including the person). */
export function fatherLine(f: Family, id: number): PersonRow[] {
  const line: PersonRow[] = [];
  const seen = new Set<number>([id]);
  let cur = f.persons[id];
  while (cur && cur.fatherId != null && !seen.has(cur.fatherId)) {
    const father = f.persons[cur.fatherId];
    if (!father) break;
    line.unshift(father);
    seen.add(father.id);
    cur = father;
  }
  return line;
}

/** Normalize Arabic text for searching: drop diacritics and unify letter forms. */
export function normalizeArabic(s: string): string {
  return s
    .normalize("NFKC")
    .replace(/[ً-ٰٟۖ-ۭ]/g, "")
    .replace(/ـ/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function genderLabel(g: Gender) {
  return g === "MALE" ? "ذكر" : "أنثى";
}

export function ordinalAr(n: number, feminine: boolean): string {
  const m = ["الأول", "الثاني", "الثالث", "الرابع", "الخامس", "السادس", "السابع", "الثامن", "التاسع", "العاشر"];
  const fem = ["الأولى", "الثانية", "الثالثة", "الرابعة", "الخامسة", "السادسة", "السابعة", "الثامنة", "التاسعة", "العاشرة"];
  const list = feminine ? fem : m;
  return list[n - 1] ?? String(n);
}

/** Short labels used in pickers to tell people with the same name apart. */
export function pickerOptions(f: Family, gender?: Gender, excludeIds: number[] = []) {
  const ex = new Set(excludeIds);
  return Object.values(f.persons)
    .filter((p) => (!gender || p.gender === gender) && !ex.has(p.id))
    .map((p) => ({ id: p.id, label: nasab(f, p.id, 3) }))
    .sort((a, b) => a.label.localeCompare(b.label, "ar"));
}
