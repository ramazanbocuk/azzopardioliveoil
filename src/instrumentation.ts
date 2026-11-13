import type { Instrumentation } from "next";

/** Runs once when the server process starts. */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { assertEnvironment } = await import("@/server/env");
    assertEnvironment();
  }
}

/**
 * Every unhandled server error, as one line of JSON, so the host's log
 * search and alerts can pick it up. Request bodies, cookies and headers are
 * deliberately not logged: they contain personal data and session tokens.
 */
export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  const failure = error as { message?: string; digest?: string; stack?: string };
  console.error(
    JSON.stringify({
      level: "error",
      event: "request_error",
      message: failure.message,
      digest: failure.digest,
      path: request.path.split("?")[0],
      method: request.method,
      route: context.routePath,
      kind: context.routeType,
      stack: failure.stack?.split("\n").slice(0, 6).join("\n"),
    }),
  );
  // Also kept in the database and emailed to the shop once a day per distinct error (see src/server/system.ts).
  if (process.env.NEXT_RUNTIME === "nodejs") {
    try {
      const [{ recordError }, { getPrisma }] = await Promise.all([import("@/server/system"), import("@/server/db")]);
      await recordError(getPrisma(), { message: failure.message, code: (error as { code?: string }).code, digest: failure.digest, stack: failure.stack, path: request.path, method: request.method, route: context.routePath, kind: context.routeType });
    } catch {
      // Recording is best effort; the log line above is the record of last resort.
    }
  }
};
