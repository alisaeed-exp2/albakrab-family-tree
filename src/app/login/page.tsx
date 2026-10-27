import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/auth";
import ActionForm from "@/components/ActionForm";
import { login } from "../actions";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if (await isAdmin()) redirect("/");
  return (
    <div className="login-box panel">
      <h2>دخول المشرف</h2>
      <p className="muted">التعديل على الشجرة متاح للمشرف فقط.</p>
      <ActionForm action={login} submitLabel="دخول" pendingLabel="جارٍ التحقق…">
        <label className="field">
          <span>كلمة المرور</span>
          <input name="password" type="password" className="input" required autoFocus />
        </label>
      </ActionForm>
    </div>
  );
}
