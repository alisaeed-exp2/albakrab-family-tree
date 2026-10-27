import { loadFamily } from "@/lib/data";
import { nasab } from "@/lib/family";
import SearchBox, { type SearchItem } from "@/components/SearchBox";

export const dynamic = "force-dynamic";

export default async function SearchPage() {
  const f = await loadFamily();
  const items: SearchItem[] = Object.values(f.persons).map((p) => ({
    id: p.id,
    name: p.name,
    gender: p.gender,
    nasab: nasab(f, p.id, 8),
    gen: f.gen[p.id] ?? null,
  }));

  return (
    <div className="narrow">
      <h1>البحث في العائلة</h1>
      <p className="muted">يمكنك البحث بالاسم أو بجزء من النسب. الهمزات والتاء المربوطة لا تؤثر على النتائج.</p>
      <SearchBox items={items} />
    </div>
  );
}
