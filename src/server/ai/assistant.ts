import { z } from "zod";
import type { AiConversation, Prisma } from "@/generated/prisma/client";
import { toLocale } from "@/i18n/config";
import { setCookie, type Ctx } from "../context";
import { hashToken, newToken } from "../crypto";
import type { Db } from "../db";
import { AppError } from "../errors";
import { enforce } from "../rateLimit";
import { customerToolSpecs, findCustomerTool, noActions, type Actions, type ToolContext } from "./customerTools";
import { CUSTOMER_INSTRUCTIONS, customerSituation } from "./prompt";
import { AssistantUnavailable, costMicros, getModelProvider, type ContentBlock, type Message, type ModelProvider, type ToolResult, type ToolUse } from "./provider";

/**
 * The customer assistant: one conversation turn, start to finish.
 *
 * A turn is: store what the customer wrote, ask the model, run the tools it
 * asks for, ask again with their results, and stop when it answers in
 * words. Everything exchanged is stored as it was, every tool call is
 * logged, and every model call is costed against a monthly budget the owner
 * sets. When the budget is used up, the assistant stops answering until the
 * next month or a higher budget; it never overspends quietly.
 *
 * The assistant is off until the owner switches it on and sets a budget.
 */

export const LIMITS = { messageChars: 1500, userTurns: 30, modelCallsPerTurn: 6, perIp: { count: 30, seconds: 600 } } as const;
const CHAT_COOKIE = "azz_chat";
const CHAT_COOKIE_DAYS = 30;

export type AssistantSettings = { customerEnabled: boolean; monthlyBudgetCents: number; extraInstructions: string | null };
export async function assistantSettings(db: Db): Promise<AssistantSettings> {
  const value = ((await db.setting.findUnique({ where: { key: "assistant" } }))?.value ?? {}) as Partial<AssistantSettings>;
  return { customerEnabled: value.customerEnabled === true, monthlyBudgetCents: Number.isFinite(value.monthlyBudgetCents) ? Math.max(0, Math.round(value.monthlyBudgetCents!)) : 0, extraInstructions: typeof value.extraInstructions === "string" && value.extraInstructions.trim() ? value.extraInstructions.trim().slice(0, 2000) : null };
}

const monthStart = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

/** Estimated spend this calendar month, in millionths of a dollar, across both assistants. */
export async function spentThisMonth(db: Db, now = new Date()): Promise<number> {
  const sum = await db.aiMessage.aggregate({ where: { createdAt: { gte: monthStart(now) } }, _sum: { costMicros: true } });
  return sum._sum.costMicros ?? 0;
}

export type AssistantState = { available: boolean; reason: "ok" | "not_connected" | "switched_off" | "no_budget" | "budget_spent"; model: string | null; spentMicros: number; budgetCents: number };

/** Whether the customer assistant may answer right now, and if not, why. */
export async function customerAssistantState(db: Db, now = new Date()): Promise<AssistantState> {
  const provider = getModelProvider();
  const [settings, spentMicros] = await Promise.all([assistantSettings(db), spentThisMonth(db, now)]);
  const base = { model: provider?.model ?? null, spentMicros, budgetCents: settings.monthlyBudgetCents };
  if (!provider) return { ...base, available: false, reason: "not_connected" };
  if (!settings.customerEnabled) return { ...base, available: false, reason: "switched_off" };
  if (settings.monthlyBudgetCents <= 0) return { ...base, available: false, reason: "no_budget" };
  if (spentMicros >= settings.monthlyBudgetCents * 10_000) return { ...base, available: false, reason: "budget_spent" };
  return { ...base, available: true, reason: "ok" };
}

export type Reply = {
  conversationId: string | null;
  /** "ok": `text` is the assistant's answer. Anything else: the page shows its own fixed wording for that case. */
  status: "ok" | "unavailable" | "limit" | "refused";
  text: string;
  actions: Actions;
};

const textOf = (content: ContentBlock[]) =>
  content
    .flatMap((block) => (block.type === "text" ? [block.text] : []))
    .join("\n\n")
    .trim();

/** The conversation as the model must see it: every stored turn, unaltered and in order. */
function history(rows: { role: string; content: Prisma.JsonValue }[]): Message[] {
  const turns = rows.filter((row) => row.role !== "error");
  // A turn that asked for tools but never received their results (the server stopped in between) cannot be sent back.
  const last = turns.at(-1);
  if (last?.role === "assistant" && Array.isArray(last.content) && last.content.some((block) => (block as { type?: string }).type === "tool_use")) turns.pop();
  // Stored blocks are exactly what was exchanged, so they are sent back as they are.
  return turns.map((row) => ({ role: row.role === "assistant" ? "assistant" : "user", content: row.content }) as unknown as Message);
}

async function findConversation(ctx: Ctx, id: string | null | undefined): Promise<AiConversation | null> {
  if (!id) return null;
  const guestKey = ctx.cookies[CHAT_COOKIE];
  // A conversation can be continued only by the account, or the browser, that started it.
  const owner: Prisma.AiConversationWhereInput[] = [...(ctx.customer ? [{ customerId: ctx.customer.id }] : []), ...(guestKey ? [{ guestKeyHash: hashToken(guestKey) }] : [])];
  if (owner.length === 0) return null;
  return ctx.db.aiConversation.findFirst({ where: { id, channel: "customer", status: { not: "CLOSED" }, OR: owner } });
}

async function startConversation(ctx: Ctx): Promise<AiConversation> {
  let guestKey = ctx.cookies[CHAT_COOKIE];
  if (!guestKey) {
    guestKey = newToken();
    setCookie(ctx, CHAT_COOKIE, guestKey, CHAT_COOKIE_DAYS * 86_400);
  }
  return ctx.db.aiConversation.create({ data: { channel: "customer", customerId: ctx.customer?.id ?? null, guestKeyHash: hashToken(guestKey), locale: toLocale(ctx.locale) } });
}

async function runTool(use: ToolUse, context: ToolContext): Promise<ToolResult> {
  const started = Date.now();
  const tool = findCustomerTool(use.name);
  let result: unknown;
  let failure: string | null = null;
  try {
    if (!tool) throw new AppError("BAD_INPUT", `There is no tool called ${use.name}.`);
    const outcome = await tool.run(use.input, context);
    result = outcome.result;
    if (outcome.isError) failure = typeof (outcome.result as { error?: unknown })?.error === "string" ? (outcome.result as { error: string }).error : "refused";
  } catch (error) {
    if (error instanceof z.ZodError) failure = "The arguments were not in the expected form.";
    else if (error instanceof AppError) failure = error.message;
    else {
      console.error("[assistant] tool failed", use.name, error);
      failure = "The tool could not be run. Apologise, and offer to pass the question to the team.";
    }
    result = { error: failure };
  }
  await context.ctx.db.aiToolCall.create({ data: { conversationId: context.conversationId, name: use.name.slice(0, 80), input: (use.input ?? {}) as Prisma.InputJsonValue, ok: failure === null, error: failure, durationMs: Date.now() - started } });
  return { type: "tool_result", tool_use_id: use.id, content: JSON.stringify(result), ...(failure === null ? {} : { is_error: true }) };
}

/** One customer message in, one answer out. Never throws for a provider failure: the page gets a status it can explain. */
export async function customerMessage(ctx: Ctx, input: { conversationId?: string | null; message: string }, options: { now?: Date; provider?: ModelProvider } = {}): Promise<Reply> {
  const now = options.now ?? new Date();
  const message = input.message.trim();
  if (message.length === 0) throw new AppError("BAD_INPUT", "Write a message first.", "message");
  if (message.length > LIMITS.messageChars) throw new AppError("BAD_INPUT", `Keep each message under ${LIMITS.messageChars} characters.`, "message");
  await enforce(ctx.db, `assistant:ip:${ctx.ip}`, LIMITS.perIp.count, LIMITS.perIp.seconds);

  const state = await customerAssistantState(ctx.db, now);
  const provider = options.provider ?? getModelProvider();
  if (!state.available || !provider) return { conversationId: input.conversationId ?? null, status: "unavailable", text: "", actions: noActions() };

  const conversation = (await findConversation(ctx, input.conversationId)) ?? (await startConversation(ctx));
  const userTurns = await ctx.db.aiMessage.count({ where: { conversationId: conversation.id, role: "user" } });
  if (userTurns >= LIMITS.userTurns) return { conversationId: conversation.id, status: "limit", text: "", actions: noActions() };

  await ctx.db.aiMessage.create({ data: { conversationId: conversation.id, role: "user", text: message, content: [{ type: "text", text: message }] } });
  const settings = await assistantSettings(ctx.db);
  const situation = customerSituation({ locale: toLocale(ctx.locale), signedIn: !!ctx.customer, firstName: ctx.customer?.firstName ?? null, today: now, extra: settings.extraInstructions });
  const tools = customerToolSpecs();
  const context: ToolContext = { ctx, conversationId: conversation.id, actions: noActions() };

  let answer = "";
  let status: Reply["status"] = "ok";
  try {
    for (let step = 0; step < LIMITS.modelCallsPerTurn; step += 1) {
      const rows = await ctx.db.aiMessage.findMany({ where: { conversationId: conversation.id }, orderBy: { createdAt: "asc" }, select: { role: true, content: true } });
      const turn = await provider.complete({ instructions: CUSTOMER_INSTRUCTIONS, situation, tools, messages: history(rows) });
      const text = textOf(turn.content);
      await ctx.db.aiMessage.create({ data: { conversationId: conversation.id, role: "assistant", text, content: turn.content as unknown as Prisma.InputJsonValue, model: turn.model, stopReason: turn.stopReason, inputTokens: turn.usage.inputTokens, outputTokens: turn.usage.outputTokens, cacheReadTokens: turn.usage.cacheReadTokens, cacheWriteTokens: turn.usage.cacheWriteTokens, costMicros: costMicros(turn.model, turn.usage) } });

      if (turn.stopReason === "refusal") {
        status = "refused";
        break;
      }
      const uses = turn.content.filter((block): block is ToolUse => block.type === "tool_use");
      if (turn.stopReason !== "tool_use" || uses.length === 0) {
        answer = text;
        break;
      }
      // Tools the model asked for together run together, and all their results go back in one message.
      // One after another, in the order asked: two calls in the same turn must not race (two support requests for one conversation), and the record reads in order.
      const results: ToolResult[] = [];
      for (const use of uses) results.push(await runTool(use, context));
      await ctx.db.aiMessage.create({ data: { conversationId: conversation.id, role: "tool", content: results as unknown as Prisma.InputJsonValue } });
      // Words the model wrote before asking for a tool are kept only if nothing better follows.
      if (text) answer = text;
    }
  } catch (error) {
    if (!(error instanceof AssistantUnavailable)) throw error;
    await ctx.db.aiMessage.create({ data: { conversationId: conversation.id, role: "error", content: [], error: error.reason.slice(0, 500) } });
    return { conversationId: conversation.id, status: "unavailable", text: "", actions: context.actions };
  }
  await ctx.db.aiConversation.update({ where: { id: conversation.id }, data: { updatedAt: new Date() } });
  await warnIfBudgetSpent(ctx.db, now);
  // No words at all (the step limit was reached mid-task) is not an answer the customer can use.
  if (status === "ok" && !answer) return { conversationId: conversation.id, status: "unavailable", text: "", actions: context.actions };
  return { conversationId: conversation.id, status, text: answer, actions: context.actions };
}

/** Tells the shop, once a month, that the assistant has stopped because its budget is used up. */
async function warnIfBudgetSpent(db: Db, now: Date) {
  const [settings, spent] = await Promise.all([assistantSettings(db), spentThisMonth(db, now)]);
  if (settings.monthlyBudgetCents <= 0 || spent < settings.monthlyBudgetCents * 10_000) return;
  const month = now.toISOString().slice(0, 7);
  await db.outboxJob.createMany({
    data: [{ kind: "notify.owner.notice", dedupeKey: `notify.owner.notice:assistant-budget:${month}`, payload: { subject: "The assistant has used its monthly budget", lines: [`The estimated cost of the AI assistant in ${month} has reached the budget of ${(settings.monthlyBudgetCents / 100).toFixed(2)} US dollars.`, "It has stopped answering customers and will start again next month, or as soon as the budget is raised under Admin → Customer assistant."], path: "/admin/assistant" } }],
    skipDuplicates: true,
  });
}

/** The customer's verdict on a conversation: helpful or not. Only its owner can give it. */
export async function rateConversation(ctx: Ctx, conversationId: string, helpful: boolean): Promise<void> {
  const conversation = await findConversation(ctx, conversationId);
  if (!conversation) throw new AppError("NOT_FOUND", "Conversation not found.");
  await ctx.db.aiConversation.update({ where: { id: conversation.id }, data: { rating: helpful ? 1 : -1 } });
}

/** Guest conversations are kept for 90 days, then deleted with everything in them. */
export async function purgeOldConversations(db: Db, now = new Date()): Promise<number> {
  const removed = await db.aiConversation.deleteMany({ where: { channel: "customer", customerId: null, updatedAt: { lt: new Date(now.getTime() - 90 * 86_400_000) }, supportRequests: { none: { status: "OPEN" } } } });
  return removed.count;
}
