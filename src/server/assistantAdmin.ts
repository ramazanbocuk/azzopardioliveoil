import { z } from "zod";
import { requireAdmin } from "./auth";
import { assistantSettings, customerAssistantState } from "./ai/assistant";
import { CUSTOMER_TOOLS, supportReference } from "./ai/customerTools";
import { CUSTOMER_INSTRUCTIONS } from "./ai/prompt";
import type { Ctx } from "./context";
import { AppError, parse } from "./errors";

/**
 * Staff's view of the assistant: whether it is running and what it has
 * cost, what it has been told, every conversation and tool call, the
 * articles it may quote, and the questions it passed to a person.
 */

const audit = (ctx: Ctx, action: string, entity: string, entityId: string | null, data?: object) => ctx.db.auditLog.create({ data: { actorType: "admin", actorId: ctx.admin?.id ?? null, action, entity, entityId, data, ip: ctx.ip } });
const monthStart = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

export const STATE_TEXT: Record<string, string> = {
  ok: "Answering customers.",
  not_connected: "Not connected: no ANTHROPIC_API_KEY is set on the server. The chat button is hidden.",
  switched_off: "Switched off. The chat button is hidden.",
  no_budget: "No monthly budget is set, so it does not answer. The chat button is hidden.",
  budget_spent: "This month's budget is used up, so it has stopped answering. The chat button is hidden until next month or a higher budget.",
};

export async function assistantOverview(ctx: Ctx, now = new Date()) {
  requireAdmin(ctx, "VIEW", "assistant");
  const since = monthStart(now);
  const [state, settings, conversations, messages, toolCalls, handovers, up, down, recent, errors, tools] = await Promise.all([
    customerAssistantState(ctx.db, now),
    assistantSettings(ctx.db),
    ctx.db.aiConversation.count({ where: { channel: "customer", createdAt: { gte: since } } }),
    ctx.db.aiMessage.count({ where: { role: "user", createdAt: { gte: since } } }),
    ctx.db.aiToolCall.count({ where: { createdAt: { gte: since } } }),
    ctx.db.supportRequest.count({ where: { source: "assistant", createdAt: { gte: since } } }),
    ctx.db.aiConversation.count({ where: { rating: 1, createdAt: { gte: since } } }),
    ctx.db.aiConversation.count({ where: { rating: -1, createdAt: { gte: since } } }),
    ctx.db.aiConversation.findMany({ where: { channel: "customer" }, orderBy: { updatedAt: "desc" }, take: 40, include: { messages: { where: { role: "user" }, orderBy: { createdAt: "asc" }, take: 1, select: { text: true } }, _count: { select: { messages: true, toolCalls: true } } } }),
    ctx.db.aiMessage.findMany({ where: { role: "error" }, orderBy: { createdAt: "desc" }, take: 15, select: { id: true, conversationId: true, error: true, createdAt: true } }),
    ctx.db.aiToolCall.groupBy({ by: ["name", "ok"], where: { createdAt: { gte: since } }, _count: true }),
  ]);
  const costs = await ctx.db.aiMessage.groupBy({ by: ["conversationId"], where: { conversationId: { in: recent.map((conversation) => conversation.id) } }, _sum: { costMicros: true } });
  const costOf = new Map(costs.map((row) => [row.conversationId, row._sum.costMicros ?? 0]));
  const usage = new Map<string, { name: string; ok: number; failed: number }>();
  for (const row of tools) {
    const entry = usage.get(row.name) ?? { name: row.name, ok: 0, failed: 0 };
    usage.set(row.name, row.ok ? { ...entry, ok: entry.ok + row._count } : { ...entry, failed: entry.failed + row._count });
  }
  return {
    state,
    stateText: STATE_TEXT[state.reason],
    settings,
    month: { conversations, messages, toolCalls, handovers, helpful: up, notHelpful: down },
    recent: recent.map((conversation) => ({ id: conversation.id, startedAt: conversation.createdAt, updatedAt: conversation.updatedAt, locale: conversation.locale, status: conversation.status, rating: conversation.rating, signedIn: !!conversation.customerId, opening: conversation.messages[0]?.text.slice(0, 140) ?? "", turns: conversation._count.messages, toolCalls: conversation._count.toolCalls, costMicros: costOf.get(conversation.id) ?? 0 })),
    errors,
    toolUsage: [...usage.values()].sort((a, b) => b.ok + b.failed - (a.ok + a.failed)),
    // What the assistant has been told and what it is able to do, shown to staff exactly as the model receives it.
    instructions: CUSTOMER_INSTRUCTIONS,
    tools: CUSTOMER_TOOLS.map((tool) => ({ name: tool.spec.name, description: tool.spec.description })),
  };
}

const settingsInput = z.object({
  customerEnabled: z.boolean().default(false),
  /** Typed in US dollars, because that is what the provider bills in. */
  monthlyBudgetDollars: z.string().trim().regex(/^\d{1,5}([.,]\d{1,2})?$/, "Enter the budget in dollars, such as 50 or 49.50.").or(z.literal("")),
  extraInstructions: z.string().trim().max(2000, "Keep the note under 2000 characters.").default(""),
});

/** Switching the assistant on, its budget and the owner's note to it. Administrators only: all three spend money or change what customers are told. */
export async function saveAssistantSettings(ctx: Ctx, input: unknown) {
  requireAdmin(ctx, "ADMINISTRATOR", "assistant");
  const data = parse(settingsInput, input);
  const monthlyBudgetCents = data.monthlyBudgetDollars ? Math.round(Number(data.monthlyBudgetDollars.replace(",", ".")) * 100) : 0;
  if (data.customerEnabled && monthlyBudgetCents <= 0) throw new AppError("BAD_INPUT", "Set a monthly budget before switching the assistant on. Without one it will not answer.", "monthlyBudgetDollars");
  const value = { customerEnabled: data.customerEnabled, monthlyBudgetCents, extraInstructions: data.extraInstructions || null };
  await ctx.db.setting.upsert({ where: { key: "assistant" }, create: { key: "assistant", value }, update: { value } });
  await audit(ctx, "assistant.settings", "Setting", "assistant", { customerEnabled: value.customerEnabled, monthlyBudgetCents, hasNote: !!value.extraInstructions });
}

/** One conversation as it happened: what was said, which tools ran with what, and what each model call cost. */
export async function getConversation(ctx: Ctx, id: string) {
  requireAdmin(ctx, "VIEW", "assistant");
  const conversation = await ctx.db.aiConversation.findUnique({ where: { id }, include: { messages: { orderBy: { createdAt: "asc" } }, toolCalls: { orderBy: { createdAt: "asc" } }, supportRequests: true } });
  if (!conversation) throw new AppError("NOT_FOUND", "Conversation not found.");
  const customer = conversation.customerId ? await ctx.db.customer.findUnique({ where: { id: conversation.customerId }, select: { id: true, email: true, firstName: true, lastName: true } }) : null;
  return {
    ...conversation,
    customer,
    costMicros: conversation.messages.reduce((sum, message) => sum + message.costMicros, 0),
    turns: conversation.messages.filter((message) => (message.role === "user" || message.role === "assistant" || message.role === "error") && (message.text || message.error)).map((message) => ({ id: message.id, role: message.role, text: message.text || message.error || "", at: message.createdAt, model: message.model, stopReason: message.stopReason, costMicros: message.costMicros })),
    supportRequests: conversation.supportRequests.map((request) => ({ ...request, reference: supportReference(request.sequence) })),
  };
}

// ───────────────────────────── Knowledge base ─────────────────────────────

const articleInput = z.object({
  title: z.string().trim().min(3, "Give the article a title.").max(160),
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, numbers and hyphens.").max(120),
  body: z.string().trim().min(20, "Write the article: at least a sentence or two.").max(12000),
  audience: z.enum(["customer", "staff"]).default("customer"),
  isPublished: z.boolean().default(false),
});

export async function listArticles(ctx: Ctx) {
  requireAdmin(ctx, "VIEW", "assistant");
  return ctx.db.knowledgeArticle.findMany({ orderBy: [{ isPublished: "desc" }, { title: "asc" }] });
}

/**
 * Saves an article the assistant may quote. Publishing is what makes it
 * quotable, and is for managers: an article is the shop speaking, so it is
 * held to the same standard as a product page. No health claims.
 */
export async function saveArticle(ctx: Ctx, id: string | null, input: unknown) {
  const admin = requireAdmin(ctx, "MANAGER", "assistant");
  const data = parse(articleInput, input);
  const clash = await ctx.db.knowledgeArticle.findFirst({ where: { slug: data.slug, NOT: id ? { id } : undefined }, select: { id: true } });
  if (clash) throw new AppError("BAD_INPUT", "Another article already uses this address name.", "slug");
  const article = id ? await ctx.db.knowledgeArticle.update({ where: { id }, data: { ...data, updatedById: admin.id } }) : await ctx.db.knowledgeArticle.create({ data: { ...data, updatedById: admin.id } });
  await audit(ctx, id ? "knowledge.update" : "knowledge.create", "KnowledgeArticle", article.id, { slug: data.slug, isPublished: data.isPublished, audience: data.audience });
  return article;
}

export async function deleteArticle(ctx: Ctx, id: string) {
  requireAdmin(ctx, "MANAGER", "assistant");
  const article = await ctx.db.knowledgeArticle.delete({ where: { id } }).catch(() => null);
  if (!article) throw new AppError("NOT_FOUND", "Article not found.");
  await audit(ctx, "knowledge.delete", "KnowledgeArticle", id, { slug: article.slug });
}

// ───────────────────────────── Support requests ─────────────────────────────

export const SUPPORT_STATES = ["OPEN", "ANSWERED", "CLOSED"] as const;

export async function listSupportRequests(ctx: Ctx, status?: string) {
  requireAdmin(ctx, "VIEW", "support");
  const wanted = SUPPORT_STATES.find((value) => value === status);
  const [rows, open, urgent] = await Promise.all([
    ctx.db.supportRequest.findMany({ where: wanted ? { status: wanted } : {}, orderBy: [{ status: "asc" }, { urgent: "desc" }, { createdAt: "desc" }], take: 100 }),
    ctx.db.supportRequest.count({ where: { status: "OPEN" } }),
    ctx.db.supportRequest.count({ where: { status: "OPEN", urgent: true } }),
  ]);
  const staff = new Map((await ctx.db.adminUser.findMany({ where: { id: { in: rows.map((row) => row.handledById).filter((id): id is string => !!id) } }, select: { id: true, name: true } })).map((user) => [user.id, user.name]));
  return { rows: rows.map((row) => ({ ...row, reference: supportReference(row.sequence), handledBy: row.handledById ? (staff.get(row.handledById) ?? "Former staff") : null })), open, urgent };
}

/** Records that a person has dealt with a request. The reply itself is sent from the shop's own mailbox, not from here. */
export async function setSupportStatus(ctx: Ctx, id: string, input: unknown) {
  const admin = requireAdmin(ctx, "STAFF", "support");
  const data = parse(z.object({ status: z.enum(SUPPORT_STATES), staffNote: z.string().trim().max(2000).default("") }), input);
  const request = await ctx.db.supportRequest.update({ where: { id }, data: { status: data.status, staffNote: data.staffNote || null, handledById: data.status === "OPEN" ? null : admin.id, handledAt: data.status === "OPEN" ? null : new Date() } }).catch(() => null);
  if (!request) throw new AppError("NOT_FOUND", "Request not found.");
  await audit(ctx, "support.status", "SupportRequest", id, { status: data.status });
}
