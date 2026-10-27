import Link from "next/link";
import { notFound } from "next/navigation";
import { loadFamily } from "@/lib/data";
import { isAdmin } from "@/lib/auth";
import { fatherLine, genderLabel, nasab, ordinalAr, pickerOptions, type Family, type PersonRow } from "@/lib/family";
import ActionForm from "@/components/ActionForm";
import PersonPicker from "@/components/PersonPicker";
import SpouseForm from "@/components/SpouseForm";
import AddChildForm from "@/components/AddChildForm";
import { deleteMarriage, deletePerson, moveMarriage, setParents, updatePerson } from "../../actions";

export const dynamic = "force-dynamic";

function PersonLink({ p }: { p?: PersonRow | null }) {
  if (!p) return <span className="muted">غير مسجل</span>;
  return <Link href={`/person/${p.id}`}>{p.name}</Link>;
}

function Chips({ f, ids }: { f: Family; ids: number[] }) {
  if (!ids.length) return <p className="muted" style={{ margin: ".2rem 0" }}>لا يوجد أبناء مسجلون</p>;
  return (
    <ul className="chips">
      {ids.map((id) => {
        const c = f.persons[id];
        return (
          <li key={id}>
            <Link href={`/person/${id}`} className={`chip ${c.gender === "MALE" ? "m" : "f"}`}>
              {c.name}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const f = await loadFamily();
  const p = f.persons[Number(id)];
  return { title: p ? `${nasab(f, p.id, 4)} — شجرة عائلة الباكراب` : "شجرة عائلة الباكراب" };
}

export default async function PersonPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: idStr } = await params;
  const id = Number(idStr);
  const [f, admin] = await Promise.all([loadFamily(), isAdmin()]);
  const p = f.persons[id];
  if (!p) notFound();

  const isMale = p.gender === "MALE";
  const line = fatherLine(f, id);
  const father = p.fatherId != null ? f.persons[p.fatherId] : null;
  const mother = p.motherId != null ? f.persons[p.motherId] : null;
  const isBlood = !!f.blood[id];
  const gen = f.gen[id];

  // Marriages with their children
  const marriages = (f.marriagesOf[id] ?? []).map((mid) => f.marriages[mid]);
  const placed = new Set<number>();
  const marriageBlocks = marriages.map((m) => {
    const spouseId = m.husbandId === id ? m.wifeId : m.husbandId;
    const kids = (f.childrenOf[id] ?? []).filter((c) => {
      const cp = f.persons[c];
      return cp.parentMarriageId === m.id || (cp.fatherId === m.husbandId && cp.motherId === m.wifeId);
    });
    kids.forEach((k) => placed.add(k));
    return { m, spouse: f.persons[spouseId], kids };
  });
  const otherKids = (f.childrenOf[id] ?? []).filter((c) => !placed.has(c));
  const multi = marriageBlocks.length > 1;
  const keepWithFather = (husbandId: number, wifeId: number) => !!f.blood[husbandId] || !f.blood[wifeId];

  // Siblings
  const sibIds = new Set<number>();
  if (p.fatherId != null) (f.childrenOf[p.fatherId] ?? []).forEach((c) => sibIds.add(c));
  if (p.motherId != null) (f.childrenOf[p.motherId] ?? []).forEach((c) => sibIds.add(c));
  sibIds.delete(id);
  const full: number[] = [];
  const half: number[] = [];
  sibIds.forEach((s) => {
    const sp = f.persons[s];
    if (p.fatherId != null && p.motherId != null && sp.fatherId === p.fatherId && sp.motherId === p.motherId) full.push(s);
    else half.push(s);
  });

  const spouseExclude = [id, ...marriageBlocks.map((b) => b.spouse?.id ?? -1)];

  return (
    <div className="narrow">
      {line.length > 0 && (
        <nav className="crumbs" aria-label="سلسلة النسب">
          {line.map((a) => (
            <Link key={a.id} href={`/person/${a.id}`}>{a.name}</Link>
          ))}
          <span>{p.name}</span>
        </nav>
      )}

      <div className="panel">
        <div className="person-head">
          <div>
            <h1 style={{ marginBottom: ".2rem" }}>{p.name}</h1>
            <p className="nasab">{nasab(f, id)}</p>
            <div className="badges">
              <span className={`badge ${isMale ? "m" : "f"}`}>{genderLabel(p.gender)}</span>
              {isBlood && gen != null && <span className="badge">الجيل {gen}</span>}
              {!isBlood && <span className="badge out">من خارج العائلة (بالزواج)</span>}
            </div>
          </div>
          <Link href={`/?root=${id}`} className="btn">عرض فرعه في الشجرة</Link>
        </div>
      </div>

      <div className="panel">
        <h2>الوالدان</h2>
        <dl className="kv">
          <dt>الأب</dt>
          <dd><PersonLink p={father} /></dd>
          <dt>الأم</dt>
          <dd><PersonLink p={mother} /></dd>
        </dl>
      </div>

      <div className="panel">
        <h2>{isMale ? "الزوجات والأبناء" : "الأزواج والأبناء"}</h2>
        {marriageBlocks.length === 0 && otherKids.length === 0 && (
          <p className="muted">{isMale ? "لا توجد زوجات مسجلة" : "لا يوجد أزواج مسجلون"}</p>
        )}
        {marriageBlocks.map(({ m, spouse, kids }, i) => (
          <div className="marriage" key={m.id}>
            <div className="marriage-head">
              <div>
                <span className="muted">
                  {isMale ? (multi ? `الزوجة ${ordinalAr(i + 1, true)}` : "الزوجة") : multi ? `الزوج ${ordinalAr(i + 1, false)}` : "الزوج"}:{" "}
                </span>
                <strong><PersonLink p={spouse} /></strong>
              </div>
              {admin && (
                <div className="marriage-tools">
                  {isMale && multi && i > 0 && (
                    <form action={moveMarriage}>
                      <input type="hidden" name="marriageId" value={m.id} />
                      <input type="hidden" name="dir" value="up" />
                      <button className="btn small" title="تقديم في الترتيب">▲</button>
                    </form>
                  )}
                  {isMale && multi && i < marriageBlocks.length - 1 && (
                    <form action={moveMarriage}>
                      <input type="hidden" name="marriageId" value={m.id} />
                      <input type="hidden" name="dir" value="down" />
                      <button className="btn small" title="تأخير في الترتيب">▼</button>
                    </form>
                  )}
                  <ActionForm
                    action={deleteMarriage}
                    submitLabel="حذف الزواج"
                    pendingLabel="…"
                    confirmText={
                      kids.length === 0
                        ? "هل تريد حذف هذا الزواج؟ (لن يُحذف الزوجان)"
                        : `هذا الزواج له ${kids.length} من الأبناء. عند الحذف يبقى الأبناء في الشجرة مع ${
                            keepWithFather(m.husbandId, m.wifeId) ? "الأب" : "الأم"
                          } فقط، ويُلغى ربطهم بـ${keepWithFather(m.husbandId, m.wifeId) ? "الأم" : "الأب"}. هل تريد المتابعة؟`
                    }
                    className="form inline"
                    buttonClassName="btn small danger"
                  >
                    <input type="hidden" name="marriageId" value={m.id} />
                  </ActionForm>
                </div>
              )}
            </div>
            <Chips f={f} ids={kids} />
            {admin && (
              <div className="add-child">
                <AddChildForm marriageId={m.id} />
              </div>
            )}
          </div>
        ))}

        {otherKids.length > 0 && (
          <div className="marriage">
            <div className="marriage-head">
              <span className="muted">{isMale ? "أبناء لم تُسجل أمهم" : "أبناء لم يُسجل أبوهم"}</span>
            </div>
            <Chips f={f} ids={otherKids} />
          </div>
        )}
      </div>

      {(full.length > 0 || half.length > 0) && (
        <div className="panel">
          <h2>الإخوة والأخوات</h2>
          {full.length > 0 && (
            <>
              <h3 className="muted">أشقاء</h3>
              <Chips f={f} ids={full} />
            </>
          )}
          {half.length > 0 && (
            <>
              <h3 className="muted">{full.length > 0 ? "إخوة من الأب أو الأم" : "إخوة"}</h3>
              <Chips f={f} ids={half} />
            </>
          )}
        </div>
      )}

      {admin && (
        <>
          <details className="panel admin" open={marriageBlocks.length === 0}>
            <summary>{isMale ? "إضافة زوجة" : "إضافة زوج"}</summary>
            <SpouseForm
              personId={id}
              isMale={isMale}
              options={pickerOptions(f, isMale ? "FEMALE" : "MALE", spouseExclude)}
            />
          </details>

          <details className="panel admin">
            <summary>{isMale ? "إضافة ابن/ابنة بدون تحديد الأم" : "إضافة ابن/ابنة بدون تحديد الأب"}</summary>
            <AddChildForm parentId={id} />
          </details>

          <details className="panel admin">
            <summary>تعديل الاسم والجنس</summary>
            <ActionForm action={updatePerson} submitLabel="حفظ">
              <input type="hidden" name="id" value={id} />
              <div className="grid2">
                <label className="field">
                  <span>الاسم</span>
                  <input name="name" className="input" defaultValue={p.name} required />
                </label>
                <label className="field">
                  <span>الجنس</span>
                  <select name="gender" className="input" defaultValue={p.gender}>
                    <option value="MALE">ذكر</option>
                    <option value="FEMALE">أنثى</option>
                  </select>
                </label>
              </div>
            </ActionForm>
          </details>

          <details className="panel admin">
            <summary>تحديد الأب والأم يدوياً</summary>
            <p className="muted" style={{ marginTop: 0 }}>
              عند اختيار الأب والأم معاً يتم ربط الشخص بزواجهما تلقائياً، ويُنشأ الزواج إن لم يكن مسجلاً.
            </p>
            <ActionForm action={setParents} submitLabel="حفظ الوالدين">
              <input type="hidden" name="id" value={id} />
              <div className="grid2">
                <label className="field">
                  <span>الأب</span>
                  <PersonPicker name="fatherId" options={pickerOptions(f, "MALE", [id])} defaultId={p.fatherId} />
                </label>
                <label className="field">
                  <span>الأم</span>
                  <PersonPicker name="motherId" options={pickerOptions(f, "FEMALE", [id])} defaultId={p.motherId} />
                </label>
              </div>
            </ActionForm>
          </details>

          <details className="panel admin">
            <summary>حذف الشخص</summary>
            <p className="muted" style={{ marginTop: 0 }}>
              لا يمكن حذف شخص له أبناء مسجلون. حذف الشخص يحذف زيجاته أيضاً.
            </p>
            <ActionForm
              action={deletePerson}
              submitLabel={`حذف ${p.name}`}
              confirmText={`هل أنت متأكد من حذف ${p.name}؟ لا يمكن التراجع.`}
              buttonClassName="btn danger"
            >
              <input type="hidden" name="id" value={id} />
            </ActionForm>
          </details>
        </>
      )}
    </div>
  );
}
