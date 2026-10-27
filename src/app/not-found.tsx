import Link from "next/link";

export default function NotFound() {
  return (
    <div className="panel empty narrow">
      <h2>الصفحة غير موجودة</h2>
      <p className="muted">ربما تم حذف هذا الشخص أو أن الرابط غير صحيح.</p>
      <Link href="/" className="btn primary">العودة إلى الشجرة</Link>
    </div>
  );
}
