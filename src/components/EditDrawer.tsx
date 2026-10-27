"use client";

import Link from "next/link";
import { useMemo } from "react";
import { genderLabel, nasab, ordinalAr, pickerOptions, type Family } from "@/lib/family";
import ActionForm from "./ActionForm";
import PersonPicker from "./PersonPicker";
import SpouseForm from "./SpouseForm";
import AddChildForm from "./AddChildForm";
import {
  addParent,
  deleteMarriage,
  deletePerson,
  linkChild,
  setParents,
  updatePerson,
} from "@/app/actions";

type Props = {
  family: Family;
  personId: number;
  onClose: () => void;
  onSelect: (id: number) => void;
};

export default function EditDrawer({ family: f, personId, onClose, onSelect }: Props) {
  const p = f.persons[personId];

  const data = useMemo(() => {
    if (!p) return null;
    const marriages = (f.marriagesOf[personId] ?? []).map((mid) => {
      const m = f.marriages[mid];
      const spouseId = m.husbandId === personId ? m.wifeId : m.husbandId;
      const kids = (f.childrenOf[personId] ?? []).filter((c) => {
        const cp = f.persons[c];
        return cp.parentMarriageId === m.id || (cp.fatherId === m.husbandId && cp.motherId === m.wifeId);
      });
      return { m, spouseId, kids };
    });
    const placed = new Set(marriages.flatMap((x) => x.kids));
    const otherKids = (f.childrenOf[personId] ?? []).filter((c) => !placed.has(c));
    return {
      marriages,
      otherKids,
      spouseOptions: pickerOptions(f, p.gender === "MALE" ? "FEMALE" : "MALE", [personId, ...marriages.map((x) => x.spouseId)]),
      fatherOptions: pickerOptions(f, "MALE", [personId]),
      motherOptions: pickerOptions(f, "FEMALE", [personId]),
      allOptions: pickerOptions(f),
    };
  }, [f, personId, p]);

  if (!p || !data) {
    return (
      <aside className="drawer">
        <div className="drawer-head">
          <strong>تم حذف هذا الشخص</strong>
          <button type="button" className="btn small" onClick={onClose}>إغلاق</button>
        </div>
      </aside>
    );
  }

  const isMale = p.gender === "MALE";
  const father = p.fatherId != null ? f.persons[p.fatherId] : null;
  const mother = p.motherId != null ? f.persons[p.motherId] : null;
  const multi = data.marriages.length > 1;
  const keepWithFather = (h: number, w: number) => !!f.blood[h] || !f.blood[w];

  const PersonBtn = ({ id }: { id: number }) => {
    const x = f.persons[id];
    if (!x) return null;
    return (
      <button type="button" className={`chip ${x.gender === "MALE" ? "m" : "f"}`} onClick={() => onSelect(id)}>
        {x.name}
      </button>
    );
  };

  return (
    <aside className="drawer" aria-label={`تعديل ${p.name}`}>
      <div className="drawer-head">
        <div style={{ minWidth: 0 }}>
          <div className="drawer-title">{p.name}</div>
          <div className="drawer-sub">{nasab(f, personId, 6)}</div>
          <div className="badges" style={{ marginTop: ".3rem" }}>
            <span className={`badge ${isMale ? "m" : "f"}`}>{genderLabel(p.gender)}</span>
            {f.gen[personId] != null ? (
              <span className="badge">الجيل {f.gen[personId]}</span>
            ) : (
              <span className="badge out">بالزواج</span>
            )}
          </div>
        </div>
        <button type="button" className="btn small" onClick={onClose} aria-label="إغلاق">✕</button>
      </div>

      <div className="drawer-body" key={personId}>
        <div className="drawer-links">
          <Link href={`/person/${personId}`} className="btn small">فتح الصفحة</Link>
          <Link href={`/?root=${personId}`} className="btn small">عرض فرعه فقط</Link>
        </div>

        {/* Name */}
        <details className="dsec" open>
          <summary>الاسم والجنس</summary>
          <ActionForm action={updatePerson} submitLabel="حفظ" className="form inline">
            <input type="hidden" name="id" value={personId} />
            <input name="name" className="input" defaultValue={p.name} required autoComplete="off" />
            <select name="gender" className="input" defaultValue={p.gender} style={{ flex: "0 0 auto", width: "6rem" }}>
              <option value="MALE">ذكر</option>
              <option value="FEMALE">أنثى</option>
            </select>
          </ActionForm>
        </details>

        {/* Marriages */}
        <details className="dsec" open>
          <summary>{isMale ? "الزوجات والأبناء" : "الأزواج والأبناء"} ({data.marriages.length})</summary>
          {data.marriages.length === 0 && (
            <p className="muted small">{isMale ? "لا توجد زوجات مسجلة بعد." : "لا يوجد أزواج مسجلون بعد."}</p>
          )}
          {data.marriages.map(({ m, spouseId, kids }, i) => (
            <div className="marriage" key={m.id}>
              <div className="marriage-head">
                <div>
                  <span className="muted small">
                    {isMale ? (multi ? `الزوجة ${ordinalAr(i + 1, true)}` : "الزوجة") : multi ? `الزوج ${ordinalAr(i + 1, false)}` : "الزوج"}:{" "}
                  </span>
                  <PersonBtn id={spouseId} />
                </div>
                <ActionForm
                  action={deleteMarriage}
                  submitLabel="حذف الزواج"
                  pendingLabel="…"
                  confirmText={
                    kids.length === 0
                      ? "هل تريد حذف هذا الزواج؟ (لن يُحذف الزوجان)"
                      : `هذا الزواج له ${kids.length} من الأبناء. يبقون في الشجرة مع ${keepWithFather(m.husbandId, m.wifeId) ? "الأب" : "الأم"} فقط. متابعة؟`
                  }
                  className="form inline"
                  buttonClassName="btn small danger"
                >
                  <input type="hidden" name="marriageId" value={m.id} />
                </ActionForm>
              </div>
              <div className="chips">
                {kids.length ? kids.map((k) => <PersonBtn key={k} id={k} />) : <span className="muted small">لا يوجد أبناء</span>}
              </div>
              <div className="add-child">
                <div className="mini-label">إضافة ابن / ابنة جديد</div>
                <AddChildForm marriageId={m.id} />
              </div>
              <div className="add-child">
                <div className="mini-label">ربط شخص مسجل كابن / ابنة لهذا الزواج</div>
                <ActionForm action={linkChild} submitLabel="ربط" className="form">
                  <input type="hidden" name="marriageId" value={m.id} />
                  <PersonPicker
                    name="childId"
                    options={data.allOptions.filter((o) => o.id !== m.husbandId && o.id !== m.wifeId && !kids.includes(o.id))}
                    emptyLabel="— اختر —"
                  />
                </ActionForm>
              </div>
            </div>
          ))}
          <div className="dsub">
            <div className="mini-label">{isMale ? "إضافة زوجة" : "إضافة زوج"}</div>
            <SpouseForm personId={personId} isMale={isMale} options={data.spouseOptions} />
          </div>
        </details>

        {data.otherKids.length > 0 && (
          <details className="dsec" open>
            <summary>{isMale ? "أبناء لم تُسجل أمهم" : "أبناء لم يُسجل أبوهم"}</summary>
            <div className="chips">
              {data.otherKids.map((k) => <PersonBtn key={k} id={k} />)}
            </div>
          </details>
        )}

        {/* Parents */}
        <details className="dsec">
          <summary>الأب والأم</summary>
          <dl className="kv">
            <dt>الأب</dt>
            <dd>{father ? <PersonBtn id={father.id} /> : <span className="muted">غير مسجل</span>}</dd>
            <dt>الأم</dt>
            <dd>{mother ? <PersonBtn id={mother.id} /> : <span className="muted">غير مسجلة</span>}</dd>
          </dl>
          {(!father || !mother) && (
            <div className="dsub">
              <div className="mini-label">إضافة والد جديد</div>
              <ActionForm action={addParent} submitLabel="إضافة" className="form inline">
                <input type="hidden" name="personId" value={personId} />
                <select name="role" className="input" style={{ flex: "0 0 auto", width: "5.5rem" }} defaultValue={!father ? "father" : "mother"}>
                  {!father && <option value="father">أب</option>}
                  {!mother && <option value="mother">أم</option>}
                </select>
                <input name="name" className="input" placeholder="الاسم" required autoComplete="off" />
              </ActionForm>
            </div>
          )}
          <div className="dsub">
            <div className="mini-label">ربط بأب وأم مسجلين</div>
            <ActionForm action={setParents} submitLabel="حفظ الوالدين">
              <input type="hidden" name="id" value={personId} />
              <PersonPicker name="fatherId" options={data.fatherOptions} defaultId={p.fatherId} emptyLabel="— بدون أب —" searchPlaceholder="ابحث عن الأب…" />
              <PersonPicker name="motherId" options={data.motherOptions} defaultId={p.motherId} emptyLabel="— بدون أم —" searchPlaceholder="ابحث عن الأم…" />
            </ActionForm>
          </div>
        </details>

        <details className="dsec">
          <summary>{isMale ? "ابن / ابنة بدون تحديد الأم" : "ابن / ابنة بدون تحديد الأب"}</summary>
          <AddChildForm parentId={personId} />
        </details>

        <details className="dsec">
          <summary className="danger-text">حذف {p.name}</summary>
          <p className="muted small">لا يمكن حذف شخص له أبناء مسجلون. تُحذف زيجاته معه.</p>
          <ActionForm
            action={deletePerson}
            submitLabel={`حذف ${p.name}`}
            confirmText={`هل أنت متأكد من حذف ${p.name}؟ لا يمكن التراجع.`}
            buttonClassName="btn danger"
          >
            <input type="hidden" name="id" value={personId} />
            <input type="hidden" name="stay" value="1" />
          </ActionForm>
        </details>
      </div>
    </aside>
  );
}
