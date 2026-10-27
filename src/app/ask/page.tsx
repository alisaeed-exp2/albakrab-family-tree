import { loadFamily } from "@/lib/data";
import AskChat from "@/components/AskChat";

export const dynamic = "force-dynamic";

export const metadata = { title: "حاج خبرة — شجرة عائلة الباكراب" };

export default async function AskPage() {
  const f = await loadFamily();
  const names: Record<number, string> = {};
  for (const p of Object.values(f.persons)) names[p.id] = p.name;

  return (
    <div className="narrow">
      <h1>اسأل حاج خبرة</h1>
      <p className="muted">حاج خبرة مساعد ذكي طوّره علي سعيد لمساعدة عائلة الباكراب على معرفة أفرادها وإيجاد أقرب صلة قرابة بين أي شخصين.</p>
      <AskChat names={names} />
    </div>
  );
}
