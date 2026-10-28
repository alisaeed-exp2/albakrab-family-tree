// The tools «حاج خبرة» uses to look things up in the family tree on demand,
// instead of receiving the whole tree with every question.
import { nasab, normalizeArabic, type Family } from "./family";
import { describeRelation, findMentions } from "./askEngine";

type Json = Record<string, unknown>;

const MAX_LIST = 150;

function brief(f: Family, id: number) {
  const p = f.persons[id];
  if (!p) return null;
  return {
    id,
    name: p.name,
    gender: p.gender === "MALE" ? "ذكر" : "أنثى",
    generation: f.gen[id] ?? "من خارج العائلة (بالزواج)",
    nasab: nasab(f, id, 6),
  };
}

function spouseList(f: Family, id: number) {
  return (f.marriagesOf[id] ?? []).map((mid, i) => {
    const m = f.marriages[mid];
    const s = m.husbandId === id ? m.wifeId : m.husbandId;
    const kids = (f.childrenOf[id] ?? []).filter((c) => {
      const cp = f.persons[c];
      return cp.parentMarriageId === m.id || (cp.fatherId === m.husbandId && cp.motherId === m.wifeId);
    });
    return {
      order: i + 1,
      spouse: brief(f, s),
      children: kids.map((k) => ({ id: k, name: f.persons[k].name, gender: f.persons[k].gender === "MALE" ? "ابن" : "ابنة" })),
    };
  });
}

// ---------------------------------------------------------------------------
// Tool definitions sent to the model (static, so they are cached)
// ---------------------------------------------------------------------------

export const HAAJ_TOOLS = [
  {
    name: "search_people",
    description:
      "ابحث عن أشخاص في الشجرة بالاسم أو بجزء من النسب (مثل «محمد بن أحمد»). يتجاهل الهمزات والتشكيل والتاء المربوطة. استخدمها أولاً لمعرفة رقم أي شخص يذكره السائل. تعيد حتى 25 نتيجة مع النسب والجيل.",
    input_schema: {
      type: "object",
      properties: { query: { type: "string", description: "الاسم أو جزء من النسب" } },
      required: ["query"],
    },
  },
  {
    name: "get_person",
    description:
      "تفاصيل شخص برقمه: الاسم، الجنس، الجيل، النسب الكامل، الأب والأم، الزوجات/الأزواج بالترتيب مع أبناء كل زواج، والإخوة (الأشقاء وغير الأشقاء).",
    input_schema: {
      type: "object",
      properties: { id: { type: "integer" } },
      required: ["id"],
    },
  },
  {
    name: "get_relationship",
    description:
      "يحسب بدقة أقرب صلة قرابة بين شخصين برقميهما: يبحث في الاتجاهين، من جهة الأب ومن جهة الأم كلٌّ على حدة، حتى أقرب جد مشترك، ويعيد المصطلح العربي (عم، خال، ابن عم...) والمسار كاملاً، وكذلك الصلة عبر الزواج. النتيجة تصف صلة الشخص الثاني بالأول. اعتمد عليها دائماً لأسئلة القرابة ولا تحسبها بنفسك.",
    input_schema: {
      type: "object",
      properties: {
        person_a: { type: "integer", description: "رقم الشخص الأول (المنسوب إليه)" },
        person_b: { type: "integer", description: "رقم الشخص الثاني" },
      },
      required: ["person_a", "person_b"],
    },
  },
  {
    name: "get_descendants",
    description: "ذرية شخص (أبناؤه وأحفاده...) حتى عمق معين، مع عدد الأجيال من الشخص.",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "integer" },
        max_depth: { type: "integer", description: "عدد الأجيال للأسفل، الافتراضي 3" },
      },
      required: ["id"],
    },
  },
  {
    name: "get_ancestors",
    description: "أسلاف شخص من جهة الأب ومن جهة الأم (الآباء والأجداد) مع المسافة بالأجيال.",
    input_schema: {
      type: "object",
      properties: { id: { type: "integer" } },
      required: ["id"],
    },
  },
  {
    name: "tree_overview",
    description:
      "نظرة عامة على الشجرة كلها: عدد الأفراد، عدد الأجيال وعدد الأفراد في كل جيل، الأجداد الكبار، والأكثر أبناءً.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "list_generation",
    description: "قائمة أفراد العائلة في جيل معين (الجيل 1 = الجد الأكبر).",
    input_schema: {
      type: "object",
      properties: { generation: { type: "integer" } },
      required: ["generation"],
    },
  },
] as const;

// ---------------------------------------------------------------------------
// Tool execution
// ---------------------------------------------------------------------------

function searchPeople(f: Family, query: string): Json {
  const q = normalizeArabic(query);
  if (!q) return { error: "اكتب اسماً للبحث" };

  // 1) the smart matcher understands «محمد بن أحمد بن علي»: these are the people named
  const named = new Set<number>();
  for (const m of findMentions(f, query)) m.candidates.forEach((c) => named.add(c));
  // 2) people whose own name is exactly the query
  for (const p of Object.values(f.persons)) if (normalizeArabic(p.name) === q) named.add(p.id);

  // 3) wider: every word appears somewhere in the nasab (e.g. children/grandchildren of that name)
  const qWords = q.split(" ");
  const inNasab: number[] = [];
  for (const p of Object.values(f.persons)) {
    if (named.has(p.id) || inNasab.length >= 40) continue;
    const key = normalizeArabic(nasab(f, p.id, 6));
    if (qWords.every((w) => key.includes(w))) inNasab.push(p.id);
  }

  const results = [
    ...[...named].slice(0, 25).map((id) => ({ match: "الاسم مطابق", ...brief(f, id) })),
    ...inNasab.slice(0, Math.max(0, 25 - named.size)).map((id) => ({ match: "الاسم ورد في النسب فقط", ...brief(f, id) })),
  ];
  return {
    query,
    exact_matches: named.size,
    other_matches: inNasab.length,
    results,
    note: named.size > 1 ? "أكثر من شخص بهذا الاسم؛ وضّح للسائل أو اطلب اسم الأب" : named.size === 0 && inNasab.length === 0 ? "لا يوجد شخص بهذا الاسم" : undefined,
  };
}

function getPerson(f: Family, id: number): Json {
  const p = f.persons[id];
  if (!p) return { error: `لا يوجد شخص بالرقم ${id}` };
  const sibs = new Set<number>();
  if (p.fatherId != null) (f.childrenOf[p.fatherId] ?? []).forEach((c) => sibs.add(c));
  if (p.motherId != null) (f.childrenOf[p.motherId] ?? []).forEach((c) => sibs.add(c));
  sibs.delete(id);
  const full: number[] = [];
  const half: number[] = [];
  sibs.forEach((s) => {
    const sp = f.persons[s];
    if (p.fatherId != null && p.motherId != null && sp.fatherId === p.fatherId && sp.motherId === p.motherId) full.push(s);
    else half.push(s);
  });
  const placed = new Set(spouseList(f, id).flatMap((m) => m.children.map((c) => c.id)));
  return {
    ...brief(f, id),
    nasab: nasab(f, id),
    father: p.fatherId != null ? brief(f, p.fatherId) : "غير مسجل",
    mother: p.motherId != null ? brief(f, p.motherId) : "غير مسجلة",
    marriages: spouseList(f, id),
    children_without_recorded_other_parent: (f.childrenOf[id] ?? [])
      .filter((c) => !placed.has(c))
      .map((c) => ({ id: c, name: f.persons[c].name })),
    full_siblings: full.map((s) => ({ id: s, name: f.persons[s].name })),
    half_siblings: half.map((s) => ({
      id: s,
      name: f.persons[s].name,
      shared: f.persons[s].fatherId === p.fatherId && p.fatherId != null ? "من الأب" : "من الأم",
    })),
    total_children: (f.childrenOf[id] ?? []).length,
  };
}

function getDescendants(f: Family, id: number, maxDepth: number): Json {
  if (!f.persons[id]) return { error: `لا يوجد شخص بالرقم ${id}` };
  const depth = Math.min(Math.max(maxDepth || 3, 1), 10);
  const out: { id: number; name: string; depth: number; father: number | null; mother: number | null }[] = [];
  const seen = new Set([id]);
  let level = [id];
  let total = 0;
  for (let d = 1; d <= depth && level.length; d++) {
    const next: number[] = [];
    for (const pid of level) {
      for (const c of f.childrenOf[pid] ?? []) {
        if (seen.has(c)) continue;
        seen.add(c);
        next.push(c);
        total++;
        if (out.length < MAX_LIST) {
          const cp = f.persons[c];
          out.push({ id: c, name: cp.name, depth: d, father: cp.fatherId, mother: cp.motherId });
        }
      }
    }
    level = next;
  }
  return {
    person: brief(f, id),
    total_found: total,
    shown: out.length,
    note: total > out.length ? "القائمة مختصرة؛ قلّل max_depth للتفاصيل" : undefined,
    descendants: out,
  };
}

function getAncestors(f: Family, id: number): Json {
  if (!f.persons[id]) return { error: `لا يوجد شخص بالرقم ${id}` };
  const label = (male: boolean, dist: number, side: "الأب" | "الأم") => {
    if (dist === 1) return side;
    if (dist === 2) return `${male ? "جد" : "جدة"} ${side === "الأب" ? "لأب" : "لأم"}`;
    return `${male ? "جد أعلى" : "جدة عليا"} من جهة ${side} (${dist} أجيال للأعلى)`;
  };
  const out: { id: number; name: string; distance: number; relation: string; side: string }[] = [];
  const p = f.persons[id];
  for (const [start, side] of [
    [p.fatherId, "الأب"],
    [p.motherId, "الأم"],
  ] as const) {
    if (start == null || !f.persons[start]) continue;
    // breadth-first through this side
    const seen = new Set<number>([start]);
    let level: number[] = [start];
    for (let dist = 1; level.length && dist <= 30 && out.length < 120; dist++) {
      const next: number[] = [];
      for (const a of level) {
        const ap = f.persons[a];
        out.push({ id: a, name: ap.name, distance: dist, relation: label(ap.gender === "MALE", dist, side), side: `جهة ${side}` });
        for (const par of [ap.fatherId, ap.motherId]) {
          if (par != null && f.persons[par] && !seen.has(par)) {
            seen.add(par);
            next.push(par);
          }
        }
      }
      level = next;
    }
  }
  return {
    person: brief(f, id),
    father_recorded: p.fatherId != null,
    mother_recorded: p.motherId != null,
    ancestors: out,
  };
}

function overview(f: Family): Json {
  const people = Object.values(f.persons);
  const perGen: Record<number, number> = {};
  for (const id of Object.keys(f.gen)) {
    const g = f.gen[Number(id)];
    perGen[g] = (perGen[g] ?? 0) + 1;
  }
  const top = people
    .map((p) => ({ id: p.id, name: nasab(f, p.id, 2), children: (f.childrenOf[p.id] ?? []).length }))
    .filter((x) => x.children > 0)
    .sort((a, b) => b.children - a.children)
    .slice(0, 10);
  return {
    total_people: people.length,
    blood_members: Object.keys(f.blood).length,
    married_in: people.length - Object.keys(f.blood).length,
    generations: Math.max(0, ...Object.keys(perGen).map(Number)),
    people_per_generation: perGen,
    root_ancestors: f.roots.map((r) => brief(f, r)),
    most_children: top,
    marriages: Object.keys(f.marriages).length,
  };
}

function listGeneration(f: Family, gen: number): Json {
  const ids = Object.keys(f.gen)
    .map(Number)
    .filter((id) => f.gen[id] === gen);
  return {
    generation: gen,
    count: ids.length,
    shown: Math.min(ids.length, MAX_LIST),
    people: ids.slice(0, MAX_LIST).map((id) => ({ id, nasab: nasab(f, id, 3) })),
  };
}

/** Run one tool call and return its result as text for the model. */
export function runHaajTool(f: Family, name: string, input: Json): string {
  const num = (k: string) => Number(input?.[k]);
  let result: Json;
  try {
    switch (name) {
      case "search_people":
        result = searchPeople(f, String(input?.query ?? ""));
        break;
      case "get_person":
        result = getPerson(f, num("id"));
        break;
      case "get_relationship": {
        const a = num("person_a");
        const b = num("person_b");
        if (!f.persons[a] || !f.persons[b]) result = { error: "أحد الرقمين غير موجود؛ استخدم search_people أولاً" };
        else
          result = {
            question: `صلة [[${b}]] (${f.persons[b].name}) بـ[[${a}]] (${f.persons[a].name})`,
            computed_exactly: describeRelation(f, a, b),
          };
        break;
      }
      case "get_descendants":
        result = getDescendants(f, num("id"), num("max_depth"));
        break;
      case "get_ancestors":
        result = getAncestors(f, num("id"));
        break;
      case "tree_overview":
        result = overview(f);
        break;
      case "list_generation":
        result = listGeneration(f, num("generation"));
        break;
      default:
        result = { error: `أداة غير معروفة: ${name}` };
    }
  } catch (e) {
    result = { error: `تعذر تنفيذ الأداة: ${(e as Error).message}` };
  }
  return JSON.stringify(result);
}

/** A short Arabic status line shown to the visitor while a tool runs. */
export function toolStatus(f: Family, name: string, input: Json): string {
  const who = (k: string) => f.persons[Number(input?.[k])]?.name ?? "";
  switch (name) {
    case "search_people":
      return `يبحث عن «${String(input?.query ?? "")}»…`;
    case "get_person":
      return `يفتح سجل ${who("id")}…`;
    case "get_relationship":
      return `يتتبع القرابة بين ${who("person_a")} و${who("person_b")}…`;
    case "get_descendants":
      return `يستعرض ذرية ${who("id")}…`;
    case "get_ancestors":
      return `يتتبع أجداد ${who("id")}…`;
    case "tree_overview":
      return "يراجع الشجرة كاملة…";
    case "list_generation":
      return `يستعرض الجيل ${String(input?.generation ?? "")}…`;
    default:
      return "يبحث في الشجرة…";
  }
}
