import { originAllowed } from "@/graphql/server";
import { customerMessage, rateConversation } from "@/server/ai/assistant";
import { buildContext } from "@/server/context";
import { getPrisma } from "@/server/db";
import { AppError } from "@/server/errors";

const MAX_BODY_BYTES = 8_000;
const json = (status: number, body: unknown, cookies: string[] = []) => {
  const headers = new Headers({ "content-type": "application/json", "cache-control": "no-store" });
  for (const cookie of cookies) headers.append("set-cookie", cookie);
  return new Response(JSON.stringify(body), { status, headers });
};

/**
 * The shop assistant's one endpoint. It takes a message (or a verdict on a
 * conversation) and answers with the assistant's words and what to show
 * beside them. It runs with the visitor's own cookies, so the assistant can
 * see exactly what the visitor could and nothing more. A page on another
 * site cannot call it with the visitor's session.
 */
export async function POST(request: Request) {
  if (!originAllowed(request)) return json(403, { error: "Cross-origin requests are not allowed." });
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return json(413, { error: "Request is too large." });
  let body: { conversationId?: unknown; message?: unknown; helpful?: unknown };
  try {
    body = JSON.parse(raw);
  } catch {
    return json(400, { error: "Body must be JSON." });
  }
  const conversationId = typeof body.conversationId === "string" && /^[a-z0-9]{10,40}$/.test(body.conversationId) ? body.conversationId : null;
  const ctx = await buildContext(getPrisma(), request);
  try {
    if (typeof body.helpful === "boolean") {
      if (!conversationId) return json(400, { error: "Which conversation?" });
      await rateConversation(ctx, conversationId, body.helpful);
      return json(200, { ok: true }, ctx.setCookies);
    }
    if (typeof body.message !== "string") return json(400, { error: "Write a message first." });
    return json(200, await customerMessage(ctx, { conversationId, message: body.message }), ctx.setCookies);
  } catch (error) {
    if (error instanceof AppError) return json(error.code === "RATE_LIMITED" ? 429 : error.code === "NOT_FOUND" ? 404 : 400, { error: error.message, code: error.code }, ctx.setCookies);
    console.error(JSON.stringify({ event: "request_error", where: "assistant", message: error instanceof Error ? error.message : String(error) }));
    return json(500, { error: "Something went wrong." });
  }
}
