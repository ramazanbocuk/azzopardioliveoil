import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { buildContext, type Ctx } from "./context";
import { getPrisma } from "./db";
import { AppError } from "./errors";

/** Request context for admin pages and server actions, built from the incoming cookies. */
export async function adminCtx(): Promise<Ctx> {
  await connection(); // admin pages are always rendered per request, never prerendered
  return buildContext(getPrisma(), { headers: (await headers()) as unknown as Headers });
}

/** Applies cookies a service queued (sign-in, sign-out) to the response. */
async function flushCookies(ctx: Ctx) {
  if (ctx.setCookies.length === 0) return;
  const jar = await cookies();
  for (const header of ctx.setCookies) {
    const [pair, ...attributes] = header.split("; ");
    const index = pair.indexOf("=");
    const maxAge = Number(attributes.find((a) => a.startsWith("Max-Age="))?.slice(8) ?? 0);
    jar.set({
      name: pair.slice(0, index),
      value: decodeURIComponent(pair.slice(index + 1)),
      httpOnly: true,
      path: "/",
      maxAge,
      sameSite: attributes.includes("SameSite=Strict") ? "strict" : "lax",
      secure: attributes.includes("Secure"),
    });
  }
}

function withNotice(path: string, kind: "ok" | "error", message: string): string {
  const url = new URL(path, "http://admin.local");
  url.searchParams.delete("ok");
  url.searchParams.delete("error");
  url.searchParams.set(kind, message);
  return `${url.pathname}${url.search}`;
}

/**
 * Runs an admin mutation from a server action and redirects with the result.
 * Known errors (wrong role, bad input) come back as a message on the page the
 * form was on; anything else is logged and shown as a generic failure.
 */
export async function run(backTo: string, action: (ctx: Ctx) => Promise<string | void>, success = "Saved."): Promise<never> {
  let target: string;
  try {
    const ctx = await adminCtx();
    const next = await action(ctx);
    await flushCookies(ctx);
    target = next?.includes("ok=") ? next : withNotice(next ?? backTo, "ok", success);
  } catch (error) {
    if (!(error instanceof AppError)) console.error("[admin] unexpected error", error);
    target = withNotice(backTo, "error", error instanceof AppError ? error.message : "Something went wrong. Nothing was changed.");
  }
  redirect(target);
}

/** Reads a submitted form into a plain object: named checkboxes become booleans, named euro fields become cents. */
export function formData(form: FormData, options: { booleans?: string[]; euros?: string[]; lists?: string[] } = {}): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of form.entries()) if (typeof value === "string" && !key.startsWith("$")) out[key] = value;
  for (const key of options.booleans ?? []) out[key] = form.get(key) === "on";
  for (const key of options.euros ?? []) {
    const raw = String(form.get(key) ?? "").trim();
    out[key] = raw === "" ? null : Math.round(Number(raw.replace(",", ".")) * 100);
    if (raw !== "" && !/^\d{1,7}([.,]\d{1,2})?$/.test(raw)) throw new AppError("BAD_INPUT", "Enter amounts like 18.50.", key);
  }
  for (const key of options.lists ?? []) out[key] = String(form.get(key) ?? "").toUpperCase().split(/[\s,;]+/).filter(Boolean);
  return out;
}
