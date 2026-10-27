"use client";

import { useState } from "react";
import ActionForm from "./ActionForm";
import PersonPicker, { type PickerOption } from "./PersonPicker";
import { addSpouse } from "@/app/actions";

export default function SpouseForm({
  personId,
  isMale,
  options,
}: {
  personId: number;
  isMale: boolean;
  options: PickerOption[];
}) {
  const [mode, setMode] = useState<"new" | "existing">("new");
  const word = isMale ? "الزوجة" : "الزوج";

  return (
    <ActionForm action={addSpouse} submitLabel={isMale ? "إضافة زوجة" : "إضافة زوج"}>
      <input type="hidden" name="personId" value={personId} />
      <input type="hidden" name="mode" value={mode} />
      <div className="seg">
        <button type="button" className={mode === "new" ? "on" : ""} onClick={() => setMode("new")}>
          {isMale ? "زوجة جديدة" : "زوج جديد"}
        </button>
        <button type="button" className={mode === "existing" ? "on" : ""} onClick={() => setMode("existing")}>
          {isMale ? "زوجة مسجلة مسبقاً" : "زوج مسجل مسبقاً"}
        </button>
      </div>
      {mode === "new" ? (
        <label className="field">
          <span>اسم {word}</span>
          <input name="spouseName" className="input" required autoComplete="off" />
        </label>
      ) : (
        <label className="field">
          <span>اختر {word}</span>
          <PersonPicker name="spouseId" options={options} emptyLabel="— اختر —" />
        </label>
      )}
    </ActionForm>
  );
}
