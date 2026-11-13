import Anthropic from "@anthropic-ai/sdk";

/**
 * The language model behind the assistants.
 *
 * Everything else in the application talks to this interface, never to a
 * vendor's SDK: the conversation loop, the tools and the tests. The exchange
 * format is Anthropic's content blocks (text, tool_use, tool_result), stored
 * as received so a conversation can be continued without altering a word of
 * it. Another vendor would be added as a second implementation that
 * translates to and from that format.
 *
 * The model is given no database access and no credentials. It can only ask
 * for one of the tools it is offered, and the application decides whether
 * and how to run it.
 */

export type ContentBlock = Anthropic.Beta.BetaContentBlock;
export type ToolUse = Anthropic.Beta.BetaToolUseBlock;
export type ToolResult = Anthropic.Beta.BetaToolResultBlockParam;
export type Message = Anthropic.Beta.BetaMessageParam;

/** A tool as the model sees it. `strict` makes the model's arguments match the schema exactly. */
export type ToolSpec = { name: string; description: string; input_schema: { type: "object"; properties: Record<string, unknown>; required: string[]; additionalProperties: false } };

export type ModelRequest = {
  /** Instructions that never change between requests; cached by the provider. */
  instructions: string;
  /** What is true for this conversation only: language, whether the customer is signed in, today's date. */
  situation: string;
  tools: ToolSpec[];
  messages: Message[];
};

export type ModelTurn = {
  content: ContentBlock[];
  /** "end_turn", "tool_use", "max_tokens", "refusal", … as the provider reports it. */
  stopReason: string | null;
  /** The model that actually answered, which differs from the one asked when a fallback ran. */
  model: string;
  usage: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number };
};

export interface ModelProvider {
  readonly name: string;
  readonly model: string;
  complete(request: ModelRequest): Promise<ModelTurn>;
}

/** The provider could not answer. `reason` is for staff; customers get a fixed apology. */
export class AssistantUnavailable extends Error {
  constructor(
    public readonly reason: string,
    /** True when trying again in a moment may work (rate limit, network, overload). */
    public readonly temporary: boolean,
  ) {
    super(reason);
    this.name = "AssistantUnavailable";
  }
}

// ───────────────────────────── Cost ─────────────────────────────

/**
 * Published prices in US dollars per million tokens, as of 2026-11-03.
 * Cache writes cost 1.25× input. Used to ESTIMATE spend for the budget and
 * the admin screen; the invoice from the provider is the real figure.
 */
const PRICES: Record<string, { input: number; output: number; cacheRead: number }> = {
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2 },
  "claude-opus-5": { input: 5, output: 25, cacheRead: 0.5 },
  "claude-opus-4-8": { input: 5, output: 25, cacheRead: 0.5 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.1 },
  "claude-sonnet-5": { input: 2, output: 10, cacheRead: 0.2 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01 },
  "claude-fable-5-2": { input: 8, output: 40, cacheRead: 0.2 },
};
/** A model missing from the table is costed at the dearest listed rate, so the budget errs towards stopping early. */
const DEAREST = { input: 8, output: 40, cacheRead: 0.8 };

/** Estimated cost of one model call, in millionths of a dollar. */
export function costMicros(model: string, usage: ModelTurn["usage"]): number {
  const price = PRICES[model] ?? DEAREST;
  return Math.round(usage.inputTokens * price.input + usage.cacheWriteTokens * price.input * 1.25 + usage.cacheReadTokens * price.cacheRead + usage.outputTokens * price.output);
}

// ───────────────────────────── Anthropic ─────────────────────────────

export const DEFAULT_MODEL = "claude-opus-5-5";
const EFFORTS = ["low", "medium", "high"] as const;

/**
 * Claude through the official SDK. One request per call: the loop that runs
 * tools lives in assistant.ts, so it is the same loop whichever model answers.
 *
 * - Thinking is adaptive and cannot be switched off on this model; `effort`
 *   sets how much. "low" suits a shop conversation and is the default.
 * - The instructions and the tool list are marked for caching, so a long
 *   conversation pays for them once.
 * - If the model declines a request for policy reasons, the provider's own
 *   default fallback model is tried in the same call.
 */
export function createAnthropicProvider(env: Record<string, string | undefined>): ModelProvider | null {
  if (!env.ANTHROPIC_API_KEY) return null;
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, timeout: 60_000, maxRetries: 1 });
  const model = env.ASSISTANT_MODEL || DEFAULT_MODEL;
  const effort = EFFORTS.find((level) => level === env.ASSISTANT_EFFORT) ?? "low";

  return {
    name: "anthropic",
    model,
    async complete(request) {
      try {
        const response = await client.beta.messages.create({
          model,
          max_tokens: 8000,
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
          thinking: { type: "adaptive" },
          output_config: { effort },
          // Everything up to the end of the conversation so far is reusable on the next turn.
          cache_control: { type: "ephemeral" },
          system: [
            { type: "text", text: request.instructions, cache_control: { type: "ephemeral" } },
            { type: "text", text: request.situation },
          ],
          tools: request.tools.map((tool) => ({ ...tool, strict: true })),
          messages: request.messages,
        });
        return {
          content: response.content,
          stopReason: response.stop_reason,
          model: response.model,
          usage: { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens, cacheReadTokens: response.usage.cache_read_input_tokens ?? 0, cacheWriteTokens: response.usage.cache_creation_input_tokens ?? 0 },
        };
      } catch (error) {
        // Most specific first: what staff must do differs for each.
        if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) throw new AssistantUnavailable("The API key was refused. Check ANTHROPIC_API_KEY.", false);
        if (error instanceof Anthropic.RateLimitError) throw new AssistantUnavailable("The provider's rate limit was reached.", true);
        if (error instanceof Anthropic.BadRequestError) throw new AssistantUnavailable(`The provider rejected the request: ${error.message.slice(0, 300)}`, false);
        if (error instanceof Anthropic.APIConnectionError) throw new AssistantUnavailable("The provider could not be reached.", true);
        if (error instanceof Anthropic.APIError) throw new AssistantUnavailable(`The provider answered with an error (${error.status ?? "no status"}).`, (error.status ?? 500) >= 500);
        throw error;
      }
    },
  };
}

let override: ModelProvider | null | undefined;
let cached: ModelProvider | null | undefined;

/** Tests substitute a scripted provider; production reads the environment. */
export function setModelProvider(provider: ModelProvider | null | undefined) {
  override = provider;
}

export function getModelProvider(): ModelProvider | null {
  if (override !== undefined) return override;
  if (cached === undefined) cached = createAnthropicProvider(process.env);
  return cached;
}
