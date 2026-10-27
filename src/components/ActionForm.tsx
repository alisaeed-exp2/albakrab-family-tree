"use client";

import { useActionState, type ReactNode } from "react";
import type { ActionState } from "@/app/actions";

type Props = {
  action: (state: ActionState, fd: FormData) => Promise<ActionState>;
  children?: ReactNode;
  submitLabel: string;
  pendingLabel?: string;
  confirmText?: string;
  className?: string;
  buttonClassName?: string;
};

export default function ActionForm({
  action,
  children,
  submitLabel,
  pendingLabel = "جارٍ الحفظ…",
  confirmText,
  className = "form",
  buttonClassName = "btn primary",
}: Props) {
  const [state, formAction, pending] = useActionState(action, null);

  return (
    <form
      action={formAction}
      className={className}
      onSubmit={(e) => {
        if (confirmText && !window.confirm(confirmText)) e.preventDefault();
      }}
    >
      {children}
      <div className="form-actions">
        <button type="submit" className={buttonClassName} disabled={pending}>
          {pending ? pendingLabel : submitLabel}
        </button>
        {state?.error && <span className="msg error">{state.error}</span>}
        {state?.ok && <span className="msg ok" key={state.at}>{state.ok}</span>}
      </div>
    </form>
  );
}
