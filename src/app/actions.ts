"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { loadFamily } from "@/lib/data";
import { checkPassword, endAdminSession, isAdmin, startAdminSession } from "@/lib/auth";
import type { Family, Gender } from "@/lib/family";

export type ActionState = { error?: string; ok?: string; at?: number } | null;

const fail = (error: string): ActionState => ({ error });
const done = (ok: string): ActionState => ({ ok, at: Date.now() });

async function requireAdmin() {
  if (!(await isAdmin())) throw new Error("غير مصرح: يجب تسجيل الدخول كمشرف");
}

function str(fd: FormData, key: string) {
  const v = fd.get(key);
  return typeof v === "string" ? v.trim() : "";
}
function optId(fd: FormData, key: string): number | null {
  const v = str(fd, key);
  if (!v) return null;
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}
function gender(fd: FormData, key = "gender"): Gender | null {
  const v = str(fd, key);
  return v === "MALE" || v === "FEMALE" ? v : null;
}

function revalidateAll() {
  revalidatePath("/", "layout");
}

/** All descendants of a person (by blood links), used to prevent loops. */
function descendants(f: Family, id: number): Set<number> {
  const out = new Set<number>();
  const q = [id];
  while (q.length) {
    const cur = q.shift()!;
    for (const c of f.childrenOf[cur] ?? []) {
      if (!out.has(c)) {
        out.add(c);
        q.push(c);
      }
    }
  }
  return out;
}

function validateParents(f: Family, personId: number | null, fatherId: number | null, motherId: number | null): string | null {
  if (fatherId != null) {
    const father = f.persons[fatherId];
    if (!father) return "الأب غير موجود";
    if (father.gender !== "MALE") return "الأب يجب أن يكون ذكراً";
  }
  if (motherId != null) {
    const mother = f.persons[motherId];
    if (!mother) return "الأم غير موجودة";
    if (mother.gender !== "FEMALE") return "الأم يجب أن تكون أنثى";
  }
  if (personId != null) {
    if (fatherId === personId || motherId === personId) return "لا يمكن أن يكون الشخص والداً لنفسه";
    const desc = descendants(f, personId);
    if ((fatherId != null && desc.has(fatherId)) || (motherId != null && desc.has(motherId)))
      return "لا يمكن اختيار أحد الأبناء أو الأحفاد والداً";
  }
  return null;
}

/** Find the marriage between father and mother, creating it if needed. */
async function ensureMarriage(husbandId: number, wifeId: number): Promise<number> {
  const existing = await prisma.marriage.findUnique({ where: { husbandId_wifeId: { husbandId, wifeId } } });
  if (existing) return existing.id;
  const count = await prisma.marriage.count({ where: { husbandId } });
  const m = await prisma.marriage.create({ data: { husbandId, wifeId, order: count + 1 } });
  return m.id;
}

// ---------- Session ----------

export async function login(_prev: ActionState, fd: FormData): Promise<ActionState> {
  if (!process.env.ADMIN_PASSWORD) return fail("لم يتم ضبط كلمة مرور المشرف على الخادم");
  if (!checkPassword(str(fd, "password"))) return fail("كلمة المرور غير صحيحة");
  await startAdminSession();
  redirect("/");
}

export async function logout() {
  await endAdminSession();
  redirect("/");
}

// ---------- People ----------

export async function createPerson(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireAdmin();
  const name = str(fd, "name");
  const g = gender(fd);
  const fatherId = optId(fd, "fatherId");
  const motherId = optId(fd, "motherId");
  if (!name) return fail("الاسم مطلوب");
  if (!g) return fail("الجنس مطلوب");

  const f = await loadFamily();
  const err = validateParents(f, null, fatherId, motherId);
  if (err) return fail(err);

  const parentMarriageId = fatherId != null && motherId != null ? await ensureMarriage(fatherId, motherId) : null;
  const p = await prisma.person.create({ data: { name, gender: g, fatherId, motherId, parentMarriageId } });
  revalidateAll();
  redirect(`/person/${p.id}`);
}

export async function updatePerson(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireAdmin();
  const id = optId(fd, "id");
  const name = str(fd, "name");
  const g = gender(fd);
  if (!id) return fail("شخص غير معروف");
  if (!name) return fail("الاسم مطلوب");
  if (!g) return fail("الجنس مطلوب");

  const person = await prisma.person.findUnique({
    where: { id },
    include: {
      _count: { select: { marriagesAsHusband: true, marriagesAsWife: true, childrenAsFather: true, childrenAsMother: true } },
    },
  });
  if (!person) return fail("الشخص غير موجود");
  if (person.gender !== g) {
    const c = person._count;
    if (c.marriagesAsHusband + c.marriagesAsWife + c.childrenAsFather + c.childrenAsMother > 0)
      return fail("لا يمكن تغيير الجنس لشخص له زواج أو أبناء مسجلون");
  }
  await prisma.person.update({ where: { id }, data: { name, gender: g } });
  revalidateAll();
  return done("تم حفظ التعديلات");
}

export async function setParents(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireAdmin();
  const id = optId(fd, "id");
  if (!id) return fail("شخص غير معروف");
  const fatherId = optId(fd, "fatherId");
  const motherId = optId(fd, "motherId");

  const f = await loadFamily();
  if (!f.persons[id]) return fail("الشخص غير موجود");
  const err = validateParents(f, id, fatherId, motherId);
  if (err) return fail(err);

  const parentMarriageId = fatherId != null && motherId != null ? await ensureMarriage(fatherId, motherId) : null;
  await prisma.person.update({ where: { id }, data: { fatherId, motherId, parentMarriageId } });
  revalidateAll();
  return done(fatherId != null && motherId != null ? "تم تحديد الوالدين وربط الزواج" : "تم تحديث الوالدين");
}

export async function deletePerson(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireAdmin();
  const id = optId(fd, "id");
  if (!id) return fail("شخص غير معروف");
  const kids = await prisma.person.count({ where: { OR: [{ fatherId: id }, { motherId: id }] } });
  if (kids > 0) return fail("لا يمكن حذف شخص له أبناء. احذف الأبناء أو غيّر والديهم أولاً.");
  await prisma.person.delete({ where: { id } });
  revalidateAll();
  redirect("/");
}

// ---------- Marriages ----------

export async function addSpouse(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireAdmin();
  const personId = optId(fd, "personId");
  if (!personId) return fail("شخص غير معروف");
  const person = await prisma.person.findUnique({ where: { id: personId } });
  if (!person) return fail("الشخص غير موجود");

  const spouseGender: Gender = person.gender === "MALE" ? "FEMALE" : "MALE";
  const mode = str(fd, "mode");
  let spouseId: number;

  if (mode === "existing") {
    const existingId = optId(fd, "spouseId");
    if (!existingId) return fail("اختر الزوج/الزوجة من القائمة");
    const spouse = await prisma.person.findUnique({ where: { id: existingId } });
    if (!spouse) return fail("الشخص المختار غير موجود");
    if (spouse.gender !== spouseGender) return fail("يجب أن يكون الزواج بين ذكر وأنثى");
    spouseId = spouse.id;
  } else {
    const name = str(fd, "spouseName");
    if (!name) return fail("اسم الزوج/الزوجة مطلوب");
    const created = await prisma.person.create({ data: { name, gender: spouseGender } });
    spouseId = created.id;
  }

  const husbandId = person.gender === "MALE" ? person.id : spouseId;
  const wifeId = person.gender === "MALE" ? spouseId : person.id;
  const exists = await prisma.marriage.findUnique({ where: { husbandId_wifeId: { husbandId, wifeId } } });
  if (exists) return fail("هذا الزواج مسجل مسبقاً");

  await ensureMarriage(husbandId, wifeId);
  revalidateAll();
  return done(person.gender === "MALE" ? "تمت إضافة الزوجة" : "تمت إضافة الزوج");
}

export async function deleteMarriage(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireAdmin();
  const id = optId(fd, "marriageId");
  if (!id) return fail("زواج غير معروف");
  const m = await prisma.marriage.findUnique({ where: { id } });
  if (!m) return fail("الزواج غير موجود");
  const kidsWhere = { OR: [{ parentMarriageId: id }, { fatherId: m.husbandId, motherId: m.wifeId }] };
  const kids = await prisma.person.count({ where: kidsWhere });

  if (kids > 0) {
    // Keep the children under the parent who belongs to the family (the father if both do).
    const f = await loadFamily();
    const keepFather = !!f.blood[m.husbandId] || !f.blood[m.wifeId];
    await prisma.$transaction([
      prisma.person.updateMany({
        where: kidsWhere,
        data: keepFather ? { motherId: null, parentMarriageId: null } : { fatherId: null, parentMarriageId: null },
      }),
      prisma.marriage.delete({ where: { id } }),
    ]);
  } else {
    await prisma.marriage.delete({ where: { id } });
  }
  revalidateAll();
  return done("تم حذف الزواج");
}

export async function moveMarriage(fd: FormData) {
  await requireAdmin();
  const id = optId(fd, "marriageId");
  const dir = str(fd, "dir");
  if (!id) return;
  const m = await prisma.marriage.findUnique({ where: { id } });
  if (!m) return;
  const list = await prisma.marriage.findMany({ where: { husbandId: m.husbandId }, orderBy: [{ order: "asc" }, { id: "asc" }] });
  const idx = list.findIndex((x) => x.id === id);
  const swap = dir === "up" ? idx - 1 : idx + 1;
  if (idx < 0 || swap < 0 || swap >= list.length) return;
  [list[idx], list[swap]] = [list[swap], list[idx]];
  await prisma.$transaction(list.map((x, i) => prisma.marriage.update({ where: { id: x.id }, data: { order: i + 1 } })));
  revalidateAll();
}

// ---------- Children ----------

export async function addChild(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireAdmin();
  const name = str(fd, "name");
  const g = gender(fd);
  if (!name) return fail("اسم الابن/الابنة مطلوب");
  if (!g) return fail("اختر ابن أو ابنة");

  const marriageId = optId(fd, "marriageId");
  if (marriageId) {
    const m = await prisma.marriage.findUnique({ where: { id: marriageId } });
    if (!m) return fail("الزواج غير موجود");
    const dup = await prisma.person.findFirst({ where: { parentMarriageId: m.id, name } });
    if (dup) return fail(`يوجد ${g === "MALE" ? "ابن" : "ابنة"} بنفس الاسم من هذا الزواج`);
    await prisma.person.create({
      data: { name, gender: g, fatherId: m.husbandId, motherId: m.wifeId, parentMarriageId: m.id },
    });
  } else {
    // Child with one known parent only.
    const parentId = optId(fd, "parentId");
    if (!parentId) return fail("الوالد غير معروف");
    const parent = await prisma.person.findUnique({ where: { id: parentId } });
    if (!parent) return fail("الوالد غير موجود");
    await prisma.person.create({
      data: {
        name,
        gender: g,
        fatherId: parent.gender === "MALE" ? parent.id : null,
        motherId: parent.gender === "FEMALE" ? parent.id : null,
      },
    });
  }
  revalidateAll();
  return done(g === "MALE" ? `تمت إضافة الابن ${name}` : `تمت إضافة الابنة ${name}`);
}
