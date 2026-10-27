import { loadFamily } from "@/lib/data";
import AskChat from "@/components/AskChat";

export const dynamic = "force-dynamic";

export const metadata = { title: "اسأل عن العائلة — شجرة عائلة الباكراب" };

export default async function AskPage() {
  const f = await loadFamily();
  const names: Record<number, string> = {};
  for (const p of Object.values(f.persons)) names[p.id] = p.name;

  return (
    <div className="narrow">
      <h1>اسأل عن العائلة</h1>
      <p className="muted">مساعد ذكي يجيب عن أسئلتك حول أفراد عائلة الباكراب وصلات القرابة بينهم.</p>
      <AskChat names={names} />
    </div>
  );
}
