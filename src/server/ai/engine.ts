import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import type { Ctx } from "../context";
import { AppError } from "../errors";
import { AssistantUnavailable, costMicros, type ContentBlock, type Message, type ModelProvider, type ToolResult, type ToolSpec, type ToolUse } from "./provider";

/**
 * One turn of a conversation with the model, for either assistant.
 *
 * A turn is: ask the model, run the tools it asks for, ask again with their
 * results, and stop when it answers in words. Everything exchanged is stored
 * as it was, every tool call is logged with its input and outcome, and every
 * model call is costed. The model can do nothing except call the tools it
 * was given for this turn.
 */

export type Outcome = { result: unknown; isError?: boolean };
export type AnyTool<C> = { spec: ToolSpec; run(input: unknown, context: C): Promise<Outcome> };
type Base = { ctx: Ctx; conversationId: string };

export const textOf = (content: ContentBlock[]) =>
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

async function runTool<C extends Base>(use: ToolUse, context: C, tools: AnyTool<C>[], onFailure: string): Promise<ToolResult> {
  const started = Date.now();
  const tool = tools.find((candidate) => candidate.spec.name === use.name);
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
      failure = onFailure;
    }
    result = { error: failure };
  }
  await context.ctx.db.aiToolCall.create({ data: { conversationId: context.conversationId, name: use.name.slice(0, 80), input: (use.input ?? {}) as Prisma.InputJsonValue, ok: failure === null, error: failure, durationMs: Date.now() - started } });
  return { type: "tool_result", tool_use_id: use.id, content: JSON.stringify(result), ...(failure === null ? {} : { is_error: true }) };
}

export type TurnResult = { status: "ok" | "unavailable" | "refused"; text: string };

/**
 * Runs the model until it answers in words. The latest user message must
 * already be stored. Never throws for a provider failure: that is stored as
 * an error row and reported as "unavailable".
 */
export async function converse<C extends Base>(provider: ModelProvider, context: C, options: { instructions: string; situation: string; tools: AnyTool<C>[]; maxModelCalls: number; onToolFailure: string }): Promise<TurnResult> {
  const { ctx, conversationId } = context;
  const specs = options.tools.map((tool) => tool.spec);
  let answer = "";
  try {
    for (let step = 0; step < options.maxModelCalls; step += 1) {
      const rows = await ctx.db.aiMessage.findMany({ where: { conversationId }, orderBy: { createdAt: "asc" }, select: { role: true, content: true } });
      const turn = await provider.complete({ instructions: options.instructions, situation: options.situation, tools: specs, messages: history(rows) });
      const text = textOf(turn.content);
      await ctx.db.aiMessage.create({ data: { conversationId, role: "assistant", text, content: turn.content as unknown as Prisma.InputJsonValue, model: turn.model, stopReason: turn.stopReason, inputTokens: turn.usage.inputTokens, outputTokens: turn.usage.outputTokens, cacheReadTokens: turn.usage.cacheReadTokens, cacheWriteTokens: turn.usage.cacheWriteTokens, costMicros: costMicros(turn.model, turn.usage) } });

      if (turn.stopReason === "refusal") return { status: "refused", text: "" };
      const uses = turn.content.filter((block): block is ToolUse => block.type === "tool_use");
      if (turn.stopReason !== "tool_use" || uses.length === 0) {
        answer = text;
        break;
      }
      // One after another, in the order asked: two calls in the same turn must not race (two support requests for one conversation), and the record reads in order.
      // All their results go back to the model in one message.
      const results: ToolResult[] = [];
      for (const use of uses) results.push(await runTool(use, context, options.tools, options.onToolFailure));
      await ctx.db.aiMessage.create({ data: { conversationId, role: "tool", content: results as unknown as Prisma.InputJsonValue } });
      // Words the model wrote before asking for a tool are kept only if nothing better follows.
      if (text) answer = text;
    }
  } catch (error) {
    if (!(error instanceof AssistantUnavailable)) throw error;
    await ctx.db.aiMessage.create({ data: { conversationId, role: "error", content: [], error: error.reason.slice(0, 500) } });
    return { status: "unavailable", text: "" };
  }
  await ctx.db.aiConversation.update({ where: { id: conversationId }, data: { updatedAt: new Date() } });
  // No words at all (the step limit was reached mid-task) is not an answer anyone can use.
  return answer ? { status: "ok", text: answer } : { status: "unavailable", text: "" };
}
