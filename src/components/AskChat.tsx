"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";

type Msg = { role: "user" | "assistant"; content: string };

const SUGGESTIONS = [
  "من هو الجد الأكبر للعائلة وكم عدد أبنائه؟",
  "كم عدد الأجيال في الشجرة؟ ومن هم أفراد آخر جيل؟",
  "من لديه أكبر عدد من الأبناء؟",
  "ما صلة القرابة بين شخصين؟ (اكتب الاسمين)",
];

/** Turns [[12]] into links and **text** into bold. */
function renderInline(text: string, names: Record<number, string>, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\[\[(\d+)\]\]|\*\*([^*]+)\*\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1]) {
      const id = Number(m[1]);
      out.push(
        names[id] ? (
          <Link key={`${keyBase}-${i++}`} href={`/person/${id}`} className="ask-person">
            {names[id]}
          </Link>
        ) : (
          <span key={`${keyBase}-${i++}`}>(شخص غير معروف)</span>
        ),
      );
    } else if (m[2]) {
      out.push(<strong key={`${keyBase}-${i++}`}>{m[2]}</strong>);
    }
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function Answer({ text, names }: { text: string; names: Record<number, string> }) {
  const lines = text.split("\n");
  return (
    <div className="ask-answer">
      {lines.map((line, i) => {
        const t = line.trim();
        if (!t) return <div key={i} className="ask-gap" />;
        if (/^#{1,4}\s/.test(t)) return <h3 key={i}>{renderInline(t.replace(/^#{1,4}\s/, ""), names, `h${i}`)}</h3>;
        const bullet = /^([-*•]|\d+[.)])\s+/.exec(t);
        if (bullet) {
          return (
            <div key={i} className="ask-li">
              <span className="ask-dot">{/^\d/.test(bullet[1]) ? bullet[1] : "•"}</span>
              <span>{renderInline(t.slice(bullet[0].length), names, `l${i}`)}</span>
            </div>
          );
        }
        return <p key={i}>{renderInline(t, names, `p${i}`)}</p>;
      })}
    </div>
  );
}

export default function AskChat({ names }: { names: Record<number, string> }) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  async function ask(question: string) {
    const q = question.trim();
    if (!q || busy) return;
    const history: Msg[] = [...messages, { role: "user", content: q }];
    setMessages([...history, { role: "assistant", content: "" }]);
    setInput("");
    setBusy(true);
    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history }),
      });
      if (!res.body) throw new Error("no body");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let acc = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        const snapshot = acc;
        setMessages([...history, { role: "assistant", content: snapshot }]);
      }
      if (!acc.trim()) setMessages([...history, { role: "assistant", content: "لم تصل إجابة، حاول مرة أخرى." }]);
    } catch {
      setMessages([...history, { role: "assistant", content: "تعذر الاتصال بالخدمة، حاول مرة أخرى." }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ask">
      <div className="ask-log">
        {messages.length === 0 && (
          <div className="ask-empty">
            <p className="muted">اسأل عن أي فرد في العائلة أو عن صلة القرابة بين شخصين. أمثلة:</p>
            <div className="ask-suggest">
              {SUGGESTIONS.map((s) => (
                <button key={s} type="button" className="btn" onClick={() => (s.includes("(") ? setInput("ما صلة القرابة بين  و ؟") : ask(s))}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) =>
          m.role === "user" ? (
            <div key={i} className="ask-msg user">{m.content}</div>
          ) : (
            <div key={i} className="ask-msg bot">
              {m.content ? <Answer text={m.content} names={names} /> : <span className="ask-typing">يفكر…</span>}
            </div>
          ),
        )}
        <div ref={endRef} />
      </div>

      <form
        className="ask-form"
        onSubmit={(e) => {
          e.preventDefault();
          ask(input);
        }}
      >
        <textarea
          className="input"
          rows={2}
          maxLength={600}
          placeholder="اكتب سؤالك هنا…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              ask(input);
            }
          }}
        />
        <div className="ask-actions">
          <button type="submit" className="btn primary" disabled={busy || !input.trim()}>
            {busy ? "…" : "اسأل"}
          </button>
          {messages.length > 0 && (
            <button type="button" className="btn" disabled={busy} onClick={() => setMessages([])}>
              محادثة جديدة
            </button>
          )}
        </div>
      </form>
      <p className="muted small" style={{ marginTop: ".5rem" }}>
        الإجابات يولدها الذكاء الاصطناعي من بيانات الشجرة وقد تحتوي أخطاء. تحقّق من الأسماء بالضغط عليها.
      </p>
    </div>
  );
}
