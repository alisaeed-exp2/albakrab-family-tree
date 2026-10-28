import { loadFamily } from "@/lib/data";
import { ASK_SYSTEM_PROMPT } from "@/lib/askContext";
import { HAAJ_TOOLS, runHaajTool, toolStatus } from "@/lib/haajTools";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

type Msg = { role: "user" | "assistant"; content: string };
type Block = Record<string, unknown> & { type: string };

const MAX_QUESTION = 600;
const MAX_HISTORY = 6;
const MAX_ROUNDS = 8; // tool-use rounds per question
const RATE_LIMIT = 20; // questions
const RATE_WINDOW_MS = 10 * 60 * 1000; // per 10 minutes per visitor

/** Lines starting with this character are progress notes, not part of the answer. */
const STATUS = "\u0001";

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
  const history = (body.messages ?? [])
    .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
    .slice(-MAX_HISTORY)
    .map((m) => ({
      role: m.role,
      content: m.content
        .split("\n")
        .filter((l) => !l.startsWith(STATUS))
        .join("\n")
        .trim()
        .slice(0, m.role === "user" ? MAX_QUESTION : 1500),
    }))
    .filter((m) => m.content);
  while (history.length && history[0].role !== "user") history.shift();
  if (!history.length || history[history.length - 1].role !== "user") return textError("اكتب سؤالك", 400);

  const f = await loadFamily();
  if (Object.keys(f.persons).length === 0) return textError("الشجرة فارغة حالياً، لا توجد بيانات للإجابة عنها.", 200);

  const model = process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5";
  const effort = process.env.ANTHROPIC_EFFORT || "low";

  // Prompt caching, in two layers:
  // 1. Tools + instructions never change, so they are cached for 1 hour (one breakpoint at the
  //    end of the system prompt covers both, since the cache prefix is tools → system → messages).
  //    Visitors ask occasionally, and a 5-minute cache would usually have expired between questions.
  // 2. Automatic caching (top-level cache_control below) moves a 5-minute breakpoint to the end of
  //    the conversation on every round, so each lookup round reads the earlier rounds from cache
  //    instead of paying for them again.
  const tools = HAAJ_TOOLS;
  const system = [
    { type: "text", text: ASK_SYSTEM_PROMPT, cache_control: { type: "ephemeral", ttl: process.env.ANTHROPIC_CACHE_TTL || "1h" } },
  ];

  const call = (messages: unknown[], withThinking: boolean) =>
    fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model,
        max_tokens: 8000,
        stream: true,
        system: withThinking ? system : [{ type: "text", text: ASK_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
        tools,
        messages,
        // "full" settings; the fallback (after a 400) uses the API defaults with no extras.
        ...(withThinking
          ? { cache_control: { type: "ephemeral" }, thinking: { type: "adaptive" }, output_config: { effort } }
          : {}),
      }),
    });

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (s: string) => controller.enqueue(encoder.encode(s));
      const status = (s: string) => send(`${STATUS}${s}\n`);

      const usage = { input: 0, cacheWrite: 0, cacheRead: 0, output: 0 };
      const toolsUsed: string[] = [];
      const started = Date.now();
      let wroteText = false;
      let stopReason: string | null = null;
      let rounds = 0;
      let withThinking = true;
      const messages: unknown[] = history.map((m) => ({ role: m.role, content: m.content }));

      try {
        for (rounds = 1; rounds <= MAX_ROUNDS; rounds++) {
          let upstream = await call(messages, withThinking);
          if (upstream.status === 400 && withThinking && rounds === 1) {
            console.warn("Ask: settings rejected, retrying with defaults", (await upstream.text().catch(() => "")).slice(0, 300));
            withThinking = false;
            upstream = await call(messages, withThinking);
          }
          if (!upstream.ok || !upstream.body) {
            const detail = await upstream.text().catch(() => "");
            console.error("Anthropic API error", upstream.status, detail.slice(0, 500));
            send(wroteText ? "\n\n(تعذر إكمال الإجابة)" : "تعذر الحصول على إجابة من حاج خبرة حالياً، حاول بعد قليل.");
            wroteText = true;
            break;
          }

          // Read one streamed response, keeping every content block exactly as received.
          const blocks: Block[] = [];
          const jsonParts: Record<number, string> = {};
          stopReason = null;
          const reader = upstream.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
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
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                let data: any;
                try {
                  data = JSON.parse(line.slice(5).trim());
                } catch {
                  continue;
                }
                switch (data.type) {
                  case "message_start": {
                    const u = data.message?.usage ?? {};
                    usage.input += u.input_tokens ?? 0;
                    usage.cacheWrite += u.cache_creation_input_tokens ?? 0;
                    usage.cacheRead += u.cache_read_input_tokens ?? 0;
                    break;
                  }
                  case "content_block_start":
                    blocks[data.index] = { ...data.content_block };
                    break;
                  case "content_block_delta": {
                    const b = blocks[data.index];
                    const d = data.delta ?? {};
                    if (!b) break;
                    if (d.type === "text_delta") {
                      b.text = ((b.text as string) ?? "") + d.text;
                      if (d.text) {
                        wroteText = true;
                        send(d.text);
                      }
                    } else if (d.type === "thinking_delta") {
                      b.thinking = ((b.thinking as string) ?? "") + d.thinking;
                    } else if (d.type === "signature_delta") {
                      b.signature = ((b.signature as string) ?? "") + d.signature;
                    } else if (d.type === "input_json_delta") {
                      jsonParts[data.index] = (jsonParts[data.index] ?? "") + d.partial_json;
                    }
                    break;
                  }
                  case "content_block_stop": {
                    const b = blocks[data.index];
                    if (b?.type === "tool_use") {
                      try {
                        b.input = jsonParts[data.index] ? JSON.parse(jsonParts[data.index]) : {};
                      } catch {
                        b.input = {};
                      }
                    }
                    break;
                  }
                  case "message_delta":
                    if (data.delta?.stop_reason) stopReason = data.delta.stop_reason;
                    if (data.usage?.output_tokens != null) usage.output += data.usage.output_tokens;
                    break;
                  case "error":
                    console.error("Anthropic stream error", data.error);
                    break;
                }
              }
            }
          }

          const toolCalls = blocks.filter((b) => b?.type === "tool_use");
          if (stopReason !== "tool_use" || !toolCalls.length) break;

          // Run the requested lookups against the database, then hand the results back.
          if (wroteText) send("\n\n");
          const results = toolCalls.map((b) => {
            const name = String(b.name);
            const input = (b.input ?? {}) as Record<string, unknown>;
            toolsUsed.push(name);
            status(toolStatus(f, name, input));
            return { type: "tool_result", tool_use_id: b.id, content: runHaajTool(f, name, input) };
          });
          // The assistant turn goes back exactly as received (thinking blocks included).
          messages.push({ role: "assistant", content: blocks.filter(Boolean) });
          messages.push({ role: "user", content: results });
        }

        if (rounds > MAX_ROUNDS && !wroteText) stopReason = "too_many_rounds";
        if (!wroteText) {
          send(
            stopReason === "max_tokens"
              ? "السؤال احتاج تفكيراً أطول من المسموح. جرّب سؤالاً أبسط أو أكثر تحديداً."
              : stopReason === "refusal"
                ? "لم يتمكن حاج خبرة من الإجابة عن هذا السؤال."
                : stopReason === "too_many_rounds"
                  ? "السؤال احتاج بحثاً طويلاً جداً. جرّب سؤالاً أكثر تحديداً."
                  : "لم تصل إجابة من حاج خبرة، حاول مرة أخرى.",
          );
        } else if (stopReason === "max_tokens") {
          send("\n\n(توقفت الإجابة لأنها طويلة جداً)");
        }
      } catch (e) {
        console.error("Ask failed", e);
        send("\n\n(انقطع الاتصال أثناء توليد الإجابة، حاول مرة أخرى)");
      } finally {
        // One line per question in the Railway logs: search for "ask_usage".
        console.log(
          "ask_usage " +
            JSON.stringify({
              mode: "agent",
              rounds: Math.min(rounds, MAX_ROUNDS),
              tools_used: toolsUsed,
              input_tokens: usage.input,
              cache_write_tokens: usage.cacheWrite,
              cache_read_tokens: usage.cacheRead,
              output_tokens: usage.output,
              total_input_tokens: usage.input + usage.cacheWrite + usage.cacheRead,
              cached_share:
                usage.input + usage.cacheWrite + usage.cacheRead
                  ? `${Math.round((100 * usage.cacheRead) / (usage.input + usage.cacheWrite + usage.cacheRead))}%`
                  : "0%",
              effort: withThinking ? effort : "default (fallback)",
              stop_reason: stopReason,
              answered: wroteText,
              seconds: Math.round((Date.now() - started) / 100) / 10,
            }),
        );
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}
