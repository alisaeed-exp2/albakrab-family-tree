import Link from "next/link";
import { loadFamily } from "@/lib/data";
import { isAdmin } from "@/lib/auth";
import { nasab, pickerOptions } from "@/lib/family";
import TreeView from "@/components/TreeView";
import ActionForm from "@/components/ActionForm";
import PersonPicker from "@/components/PersonPicker";
import { createPerson } from "./actions";

export const dynamic = "force-dynamic";

export default async function HomePage({ searchParams }: { searchParams: Promise<{ root?: string }> }) {
  const sp = await searchParams;
  const [f, admin] = await Promise.all([loadFamily(), isAdmin()]);

  const focus = Number(sp.root);
  const focusId = Number.isInteger(focus) && f.persons[focus] ? focus : null;
  const rootIds = focusId != null ? [focusId] : f.roots;

  const total = Object.keys(f.persons).length;
  const bloodCount = Object.keys(f.blood).length;
  const gens = Object.values(f.gen).reduce((m, g) => Math.max(m, g), 0);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>شجرة عائلة الباكراب</h1>
          <p className="muted" style={{ margin: 0 }}>اضغط على أي اسم لعرض تفاصيله ونسبه الكامل</p>
        </div>
        <div className="stats">
          <div className="stat"><b>{bloodCount}</b><small>من أفراد العائلة</small></div>
          <div className="stat"><b>{gens}</b><small>أجيال</small></div>
          <div className="stat"><b>{total}</b><small>إجمالي المسجلين</small></div>
        </div>
      </div>

      {focusId != null && (
        <div className="focus-bar">
          <span>عرض فرع: <strong>{nasab(f, focusId, 6)}</strong></span>
          <Link href="/" className="btn small">عرض الشجرة كاملة</Link>
        </div>
      )}

      {total === 0 ? (
        <div className="panel empty">
          <h2>لا توجد بيانات بعد</h2>
          <p className="muted">
            {admin ? "ابدأ بإضافة الجد الأكبر للعائلة من النموذج أدناه." : "لم يقم المشرف بإضافة أفراد العائلة بعد."}
          </p>
        </div>
      ) : (
        <TreeView family={f} rootIds={rootIds} focusId={focusId} admin={admin} />
      )}

      {admin && (
        <details className="panel admin" style={{ marginTop: "1rem" }} open={total === 0}>
          <summary>{total === 0 ? "إضافة الجد الأكبر" : "إضافة شخص جديد (جد أكبر أو فرد بوالدين محددين)"}</summary>
          <ActionForm action={createPerson} submitLabel="إضافة">
            <div className="grid2">
              <label className="field">
                <span>الاسم</span>
                <input name="name" className="input" required autoComplete="off" />
              </label>
              <label className="field">
                <span>الجنس</span>
                <select name="gender" className="input" defaultValue="MALE">
                  <option value="MALE">ذكر</option>
                  <option value="FEMALE">أنثى</option>
                </select>
              </label>
            </div>
            {total > 0 && (
              <div className="grid2">
                <label className="field">
                  <span>الأب (اختياري)</span>
                  <PersonPicker name="fatherId" options={pickerOptions(f, "MALE")} />
                </label>
                <label className="field">
                  <span>الأم (اختياري)</span>
                  <PersonPicker name="motherId" options={pickerOptions(f, "FEMALE")} />
                </label>
              </div>
            )}
          </ActionForm>
        </details>
      )}
    </>
  );
}
