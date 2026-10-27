import { loadFamily } from "@/lib/data";
import { familyContext, ASK_SYSTEM_PROMPT } from "@/lib/askContext";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Msg = { role: "user" | "assistant"; content: string };

const MAX_QUESTION = 600;
const MAX_HISTORY = 8;
const RATE_LIMIT = 20; // questions
const RATE_WINDOW_MS = 10 * 60 * 1000; // per 10 minutes per visitor

const hits = new Map<string, number[]>();
function limited(ip: string) {
  const now = Date.now();
  const list = (hits.get(ip) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  if (list.length >= RATE_LIMIT) {
    hits.set(ip, list);
    return true;
  }
  list.push(now);
  hits.set(ip, list);
  if (hits.size > 5000) hits.clear();
  return false;
}

function textError(message: string, status: number) {
  return new Response(message, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });
}

export async function POST(req: Request) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return textError("ميزة الذكاء الاصطناعي غير مفعّلة بعد. يرجى من المشرف إضافة مفتاح الخدمة.", 503);

  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
  if (limited(ip)) return textError("وصلت إلى الحد المسموح من الأسئلة. حاول مرة أخرى بعد قليل.", 429);

  let body: { messages?: Msg[] };
  try {
    body = await req.json();
  } catch {
    return textError("طلب غير صالح", 400);
  }
  const messages = (body.messages ?? [])
    .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
    .slice(-MAX_HISTORY)
    .map((m) => ({ role: m.role, content: m.content.slice(0, m.role === "user" ? MAX_QUESTION : 4000) }));
  while (messages.length && messages[0].role !== "user") messages.shift();
  if (!messages.length || messages[messages.length - 1].role !== "user") return textError("اكتب سؤالك", 400);

  const f = await loadFamily();
  if (Object.keys(f.persons).length === 0) return textError("الشجرة فارغة حالياً، لا توجد بيانات للإجابة عنها.", 200);

  const base = {
    model: process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5",
    // Thinking tokens count against max_tokens, so leave plenty of room for the answer itself.
    max_tokens: 8000,
    stream: true,
    system: [
      { type: "text", text: ASK_SYSTEM_PROMPT },
      { type: "text", text: `# بيانات شجرة العائلة\n\n${familyContext(f)}`, cache_control: { type: "ephemeral" } },
    ],
    messages,
  };
  const call = (body: object) =>
    fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });

  let upstream = await call({
    ...base,
    thinking: { type: "adaptive" },
    output_config: { effort: process.env.ANTHROPIC_EFFORT || "medium" },
  });
  if (upstream.status === 400) {
    // The model may not accept these settings; retry with the API defaults.
    console.warn("Ask: settings rejected, retrying with defaults", (await upstream.text().catch(() => "")).slice(0, 300));
    upstream = await call(base);
  }

  if (!upstream.ok || !upstream.body) {
    const detail = await upstream.text().catch(() => "");
    console.error("Anthropic API error", upstream.status, detail.slice(0, 500));
    return textError("تعذر الحصول على إجابة من خدمة الذكاء الاصطناعي حالياً.", 502);
  }

  // Convert the server-sent events into a plain text stream.
  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let buffer = "";
      let wroteText = false;
      let stopReason: string | null = null;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let idx;
          while ((idx = buffer.indexOf("\n\n")) !== -1) {
            const event = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 2);
            for (const line of event.split("\n")) {
              if (!line.startsWith("data:")) continue;
              const json = line.slice(5).trim();
              if (!json) continue;
              try {
                const data = JSON.parse(json);
                if (data.type === "content_block_delta" && data.delta?.type === "text_delta") {
                  if (data.delta.text) wroteText = true;
                  controller.enqueue(encoder.encode(data.delta.text));
                } else if (data.type === "message_delta" && data.delta?.stop_reason) {
                  stopReason = data.delta.stop_reason;
                } else if (data.type === "error") {
                  wroteText = true;
                  console.error("Anthropic stream error", data.error);
                  controller.enqueue(encoder.encode("\n\n(حدث خطأ أثناء توليد الإجابة)"));
                }
              } catch {
                /* ignore partial lines */
              }
            }
          }
        }
        if (stopReason !== "end_turn") console.warn("Ask finished with stop_reason", stopReason, "text:", wroteText);
        if (!wroteText) {
          const msg =
            stopReason === "max_tokens"
              ? "السؤال احتاج تفكيراً أطول من المسموح. جرّب سؤالاً أبسط أو أكثر تحديداً."
              : stopReason === "refusal"
                ? "لم يتمكن المساعد من الإجابة عن هذا السؤال."
                : "لم تصل إجابة من المساعد، حاول مرة أخرى.";
          controller.enqueue(encoder.encode(msg));
        } else if (stopReason === "max_tokens") {
          controller.enqueue(encoder.encode("\n\n(توقفت الإجابة لأنها طويلة جداً)"));
        }
      } catch (e) {
        console.error("Ask stream failed", e);
        controller.enqueue(encoder.encode("\n\n(انقطع الاتصال أثناء توليد الإجابة، حاول مرة أخرى)"));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}
