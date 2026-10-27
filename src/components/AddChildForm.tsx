"use client";

import ActionForm from "./ActionForm";
import { addChild } from "@/app/actions";

export default function AddChildForm({ marriageId, parentId }: { marriageId?: number; parentId?: number }) {
  return (
    <ActionForm action={addChild} submitLabel="إضافة" className="form inline">
      {marriageId != null && <input type="hidden" name="marriageId" value={marriageId} />}
      {parentId != null && <input type="hidden" name="parentId" value={parentId} />}
      <input name="name" className="input" placeholder="اسم الابن / الابنة" required autoComplete="off" />
      <div className="seg radios">
        <label>
          <input type="radio" name="gender" value="MALE" defaultChecked /> ابن
        </label>
        <label>
          <input type="radio" name="gender" value="FEMALE" /> ابنة
        </label>
      </div>
    </ActionForm>
  );
}
