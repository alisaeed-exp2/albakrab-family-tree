import { loadFamily } from "@/lib/data";
import { ASK_SYSTEM_PROMPT } from "@/lib/askContext";
import { buildAskContext } from "@/lib/askEngine";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Msg = { role: "user" | "assistant"; content: string };

const MAX_QUESTION = 600;
const MAX_HISTORY = 6;
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
    .map((m) => ({ role: m.role, content: m.content.slice(0, m.role === "user" ? MAX_QUESTION : 1500) }));
  while (messages.length && messages[0].role !== "user") messages.shift();
  if (!messages.length || messages[messages.length - 1].role !== "user") return textError("اكتب سؤالك", 400);

  const f = await loadFamily();
  if (Object.keys(f.persons).length === 0) return textError("الشجرة فارغة حالياً، لا توجد بيانات للإجابة عنها.", 200);

  // Only the people the question is about (or a compact full tree for general questions),
  // with relationships already computed exactly by the app.
  const ctx = buildAskContext(f, messages);
  const dataBlock: Record<string, unknown> = { type: "text", text: `# بيانات شجرة العائلة\n\n${ctx.text}` };
  // The full tree is identical between questions, so caching it pays off; a focused extract is not.
  if (ctx.mode === "full") dataBlock.cache_control = { type: "ephemeral" };
  const effort =
    ctx.mode === "full" ? process.env.ANTHROPIC_EFFORT || "medium" : process.env.ANTHROPIC_EFFORT_FOCUSED || "low";

  const base = {
    model: process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5",
    // Thinking tokens count against max_tokens, so leave plenty of room for the answer itself.
    max_tokens: 8000,
    stream: true,
    system: [{ type: "text", text: ASK_SYSTEM_PROMPT }, dataBlock],
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
    output_config: { effort },
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
      const usage = { input: 0, cacheWrite: 0, cacheRead: 0, output: 0 };
      const started = Date.now();
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
                } else if (data.type === "message_start" && data.message?.usage) {
                  const u = data.message.usage;
                  usage.input = u.input_tokens ?? 0;
                  usage.cacheWrite = u.cache_creation_input_tokens ?? 0;
                  usage.cacheRead = u.cache_read_input_tokens ?? 0;
                  usage.output = u.output_tokens ?? 0;
                } else if (data.type === "message_delta") {
                  if (data.delta?.stop_reason) stopReason = data.delta.stop_reason;
                  if (data.usage?.output_tokens != null) usage.output = data.usage.output_tokens;
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
        // One line per question in the Railway logs: search for "ask_usage".
        console.log(
          "ask_usage " +
            JSON.stringify({
              mode: ctx.mode,
              people_sent: ctx.people,
              names_found: ctx.mentions,
              context_chars: ctx.text.length,
              input_tokens: usage.input,
              cache_write_tokens: usage.cacheWrite,
              cache_read_tokens: usage.cacheRead,
              output_tokens: usage.output,
              total_input_tokens: usage.input + usage.cacheWrite + usage.cacheRead,
              effort,
              stop_reason: stopReason,
              answered: wroteText,
              seconds: Math.round((Date.now() - started) / 100) / 10,
            }),
        );
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
