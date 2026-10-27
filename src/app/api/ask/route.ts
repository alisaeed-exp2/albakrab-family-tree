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

  const upstream = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5",
      max_tokens: 1500,
      stream: true,
      system: [
        { type: "text", text: ASK_SYSTEM_PROMPT },
        { type: "text", text: `# بيانات شجرة العائلة\n\n${familyContext(f)}`, cache_control: { type: "ephemeral" } },
      ],
      messages,
    }),
  });

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
                  controller.enqueue(encoder.encode(data.delta.text));
                } else if (data.type === "error") {
                  console.error("Anthropic stream error", data.error);
                  controller.enqueue(encoder.encode("\n\n(حدث خطأ أثناء توليد الإجابة)"));
                }
              } catch {
                /* ignore partial lines */
              }
            }
          }
        }
      } catch (e) {
        console.error("Ask stream failed", e);
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}
