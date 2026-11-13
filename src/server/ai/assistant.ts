import type { AiConversation, Prisma } from "@/generated/prisma/client";
import { toLocale } from "@/i18n/config";
import { setCookie, type Ctx } from "../context";
import { hashToken, newToken } from "../crypto";
import type { Db } from "../db";
import { AppError } from "../errors";
import { enforce } from "../rateLimit";
import { CUSTOMER_TOOLS, noActions, type Actions, type ToolContext } from "./customerTools";
import { converse } from "./engine";
import { CUSTOMER_INSTRUCTIONS, customerSituation } from "./prompt";
import { getModelProvider, type ModelProvider } from "./provider";

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

export type AssistantSettings = { customerEnabled: boolean; staffEnabled: boolean; monthlyBudgetCents: number; extraInstructions: string | null };
export async function assistantSettings(db: Db): Promise<AssistantSettings> {
  const value = ((await db.setting.findUnique({ where: { key: "assistant" } }))?.value ?? {}) as Partial<AssistantSettings>;
  return { customerEnabled: value.customerEnabled === true, staffEnabled: value.staffEnabled === true, monthlyBudgetCents: Number.isFinite(value.monthlyBudgetCents) ? Math.max(0, Math.round(value.monthlyBudgetCents!)) : 0, extraInstructions: typeof value.extraInstructions === "string" && value.extraInstructions.trim() ? value.extraInstructions.trim().slice(0, 2000) : null };
}

const monthStart = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

/** Estimated spend this calendar month, in millionths of a dollar, across both assistants. */
export async function spentThisMonth(db: Db, now = new Date()): Promise<number> {
  const sum = await db.aiMessage.aggregate({ where: { createdAt: { gte: monthStart(now) } }, _sum: { costMicros: true } });
  return sum._sum.costMicros ?? 0;
}

export type AssistantState = { available: boolean; reason: "ok" | "not_connected" | "switched_off" | "no_budget" | "budget_spent"; model: string | null; spentMicros: number; budgetCents: number };

/** Whether an assistant may answer right now, and if not, why. Both draw on the one monthly budget. */
export async function assistantState(db: Db, channel: "customer" | "staff", now = new Date()): Promise<AssistantState> {
  const provider = getModelProvider();
  const [settings, spentMicros] = await Promise.all([assistantSettings(db), spentThisMonth(db, now)]);
  const base = { model: provider?.model ?? null, spentMicros, budgetCents: settings.monthlyBudgetCents };
  if (!provider) return { ...base, available: false, reason: "not_connected" };
  if (!(channel === "customer" ? settings.customerEnabled : settings.staffEnabled)) return { ...base, available: false, reason: "switched_off" };
  if (settings.monthlyBudgetCents <= 0) return { ...base, available: false, reason: "no_budget" };
  if (spentMicros >= settings.monthlyBudgetCents * 10_000) return { ...base, available: false, reason: "budget_spent" };
  return { ...base, available: true, reason: "ok" };
}
export const customerAssistantState = (db: Db, now = new Date()) => assistantState(db, "customer", now);

export type Reply = {
  conversationId: string | null;
  /** "ok": `text` is the assistant's answer. Anything else: the page shows its own fixed wording for that case. */
  status: "ok" | "unavailable" | "limit" | "refused";
  text: string;
  actions: Actions;
};

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
  const context: ToolContext = { ctx, conversationId: conversation.id, actions: noActions() };
  const turn = await converse(provider, context, { instructions: CUSTOMER_INSTRUCTIONS, situation, tools: CUSTOMER_TOOLS, maxModelCalls: LIMITS.modelCallsPerTurn, onToolFailure: "The tool could not be run. Apologise, and offer to pass the question to the team." });
  await warnIfBudgetSpent(ctx.db, now);
  return { conversationId: conversation.id, status: turn.status, text: turn.text, actions: context.actions };
}

/** Tells the shop, once a month, that the assistant has stopped because its budget is used up. */
export async function warnIfBudgetSpent(db: Db, now: Date) {
  const [settings, spent] = await Promise.all([assistantSettings(db), spentThisMonth(db, now)]);
  if (settings.monthlyBudgetCents <= 0 || spent < settings.monthlyBudgetCents * 10_000) return;
  const month = now.toISOString().slice(0, 7);
  await db.outboxJob.createMany({
    data: [{ kind: "notify.owner.notice", dedupeKey: `notify.owner.notice:assistant-budget:${month}`, payload: { subject: "The assistant has used its monthly budget", lines: [`The estimated cost of the AI assistant in ${month} has reached the budget of ${(settings.monthlyBudgetCents / 100).toFixed(2)} US dollars.`, "It has stopped answering customers and staff, and will start again next month or as soon as the budget is raised under Admin → Customer assistant."], path: "/admin/assistant" } }],
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
