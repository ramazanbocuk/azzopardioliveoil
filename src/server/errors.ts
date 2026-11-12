/**
 * An error that is safe to show to the caller. Anything else that escapes a
 * resolver is logged and replaced with a generic message by the API layer.
 */
export type ErrorCode =
  | "BAD_INPUT"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "RATE_LIMITED"
  | "INVALID_CREDENTIALS"
  | "EMAIL_TAKEN"
  | "OUT_OF_STOCK"
  | "CART_EMPTY"
  | "DISCOUNT_INVALID"
  | "SHIPPING_UNAVAILABLE"
  | "PAYMENT_UNAVAILABLE";

export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly field?: string,
  ) {
    super(message);
    this.name = "AppError";
  }
}

import type { z } from "zod";

/** Parses input with a zod schema, turning the first issue into a BAD_INPUT error. */
export function parse<S extends z.ZodType>(schema: S, input: unknown): z.infer<S> {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  const issue = result.error.issues[0];
  throw new AppError("BAD_INPUT", issue?.message ?? "Invalid input.", issue?.path.join("."));
}
