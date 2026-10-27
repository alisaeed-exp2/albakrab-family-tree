import { nasab, type Family } from "./family";

/** A compact Arabic text description of the whole tree, given to the AI as its only source of truth. */
export function familyContext(f: Family): string {
  const people = Object.values(f.persons).sort((a, b) => (f.gen[a.id] ?? 99) - (f.gen[b.id] ?? 99) || a.id - b.id);
  const lines: string[] = [];
  lines.push(`عدد الأشخاص المسجلين: ${people.length}`);
  lines.push(`الأجداد الكبار (الجذور): ${f.roots.map((r) => `[${r}]`).join(" ") || "لا يوجد"}`);
  lines.push("");
  lines.push("## الأشخاص");
  lines.push("الصيغة: [الرقم] الاسم | الجنس | الجيل أو (بالزواج) | الأب | الأم | النسب");
  for (const p of people) {
    const g = f.gen[p.id];
    lines.push(
      [
        `[${p.id}] ${p.name}`,
        p.gender === "MALE" ? "ذكر" : "أنثى",
        g != null ? `الجيل ${g}` : "من خارج العائلة (بالزواج)",
        p.fatherId != null ? `الأب [${p.fatherId}]` : "الأب غير مسجل",
        p.motherId != null ? `الأم [${p.motherId}]` : "الأم غير مسجلة",
        nasab(f, p.id),
      ].join(" | "),
    );
  }
  lines.push("");
  lines.push("## الزيجات");
  lines.push("الصيغة: الزوج [رقم] ⚭ الزوجة [رقم] (ترتيبها بين زوجاته)");
  const marriages = Object.values(f.marriages).sort((a, b) => a.husbandId - b.husbandId || a.order - b.order);
  const orderOf: Record<number, number> = {};
  for (const m of marriages) {
    orderOf[m.husbandId] = (orderOf[m.husbandId] ?? 0) + 1;
    lines.push(`[${m.husbandId}] ⚭ [${m.wifeId}] (الزوجة رقم ${orderOf[m.husbandId]})`);
  }
  return lines.join("\n");
}

export const ASK_SYSTEM_PROMPT = `أنت مساعد لشجرة عائلة الباكراب. تجيب على أسئلة الزوار حول أفراد العائلة وصلات القرابة بينهم.

القواعد:
- اعتمد فقط على بيانات الشجرة المرفقة. لا تخترع أشخاصاً أو علاقات أو معلومات غير موجودة (مثل التواريخ أو الأماكن أو المهن).
- إذا لم تكن المعلومة موجودة في البيانات فقل ذلك بوضوح.
- عند ذكر أي شخص من الشجرة اكتب رقمه بين قوسين مزدوجين بهذه الصيغة: [[12]] — سيظهر للزائر كاسم قابل للنقر. لا تكتب الاسم بجانب الرقم لأنه سيُعرض تلقائياً.
- إذا كان الاسم في السؤال يطابق أكثر من شخص، اذكر الاحتمالات مع نسب كل واحد واطلب التوضيح، أو أجب عن كل احتمال باختصار.
- عند تحديد صلة القرابة، تتبّع الأب والأم خطوة بخطوة من البيانات، ثم اذكر الصلة باللغة العربية الدقيقة (عم، خال، ابن عم، ابن خالة، جد لأب، أخ غير شقيق، إلخ) مع شرح قصير للمسار.
- الجيل 1 هو جيل الجد الأكبر، وكل جيل بعده يزيد واحداً.
- أجب بالعربية دائماً، باختصار ووضوح. استخدم القوائم عند سرد عدة أشخاص.`;
