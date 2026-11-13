import { ApolloServer, HeaderMap } from "@apollo/server";
import { unwrapResolverError } from "@apollo/server/errors";
import { GraphQLError, Kind, type ASTNode, type GraphQLSchema, type ValidationContext, type ValidationRule } from "graphql";
import { buildContext, type Ctx } from "@/server/context";
import { getPrisma, type Db } from "@/server/db";
import { AppError } from "@/server/errors";

const MAX_DEPTH = 9;
const MAX_BODY_BYTES = 64 * 1024;
const CLIENT_ERROR_CODES = new Set(["GRAPHQL_PARSE_FAILED", "GRAPHQL_VALIDATION_FAILED", "BAD_USER_INPUT", "BAD_REQUEST", "OPERATION_RESOLUTION_FAILURE"]);

/** Rejects queries nested deeper than MAX_DEPTH before any resolver runs. */
const depthLimit: ValidationRule = (context: ValidationContext) => {
  const depthOf = (node: ASTNode, seen: Set<string>): number => {
    if (node.kind === Kind.FRAGMENT_SPREAD) {
      if (seen.has(node.name.value)) return 0;
      const fragment = context.getFragment(node.name.value);
      return fragment ? depthOf(fragment, new Set(seen).add(node.name.value)) : 0;
    }
    const selections = "selectionSet" in node && node.selectionSet ? node.selectionSet.selections : [];
    const deepest = selections.reduce((max, child) => Math.max(max, depthOf(child, seen)), 0);
    return node.kind === Kind.FIELD ? deepest + 1 : deepest;
  };
  return {
    OperationDefinition(node) {
      if (depthOf(node, new Set()) > MAX_DEPTH) context.reportError(new GraphQLError(`Query is too deep (maximum depth ${MAX_DEPTH}).`, { nodes: [node] }));
    },
  };
};

/**
 * One Apollo Server per schema. Known errors (AppError) reach the client with
 * their code; anything unexpected is logged and replaced, so stack traces,
 * SQL and internal messages never leave the server.
 */
export function createServer(schema: GraphQLSchema): ApolloServer<Ctx> {
  const server = new ApolloServer<Ctx>({
    schema,
    csrfPrevention: true,
    introspection: process.env.NODE_ENV !== "production",
    includeStacktraceInErrorResponses: false,
    validationRules: [depthLimit],
    formatError(formatted, error) {
      const original = unwrapResolverError(error);
      if (original instanceof AppError) {
        return { message: original.message, path: formatted.path, extensions: { code: original.code, ...(original.field ? { field: original.field } : {}) } };
      }
      // Syntax, validation and request-shape errors are the caller's to fix and safe to show.
      if (typeof formatted.extensions?.code === "string" && CLIENT_ERROR_CODES.has(formatted.extensions.code)) return formatted;
      console.error("[graphql] unexpected error", original);
      return { message: "Something went wrong. Please try again.", path: formatted.path, extensions: { code: "INTERNAL_SERVER_ERROR" } };
    },
  });
  server.startInBackgroundHandlingStartupErrorsByLoggingAndFailingAllRequests();
  return server;
}

function json(status: number, message: string, code: string): Response {
  return Response.json({ errors: [{ message, extensions: { code } }] }, { status });
}

/** A cross-site page must not be able to drive the API with the visitor's cookies. */
export function originAllowed(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true; // same-origin navigations and server-to-server calls send none
  const allowed = new Set([new URL(request.url).origin]);
  if (process.env.APP_URL) allowed.add(new URL(process.env.APP_URL).origin);
  return allowed.has(origin);
}

/** Fetch-API adapter shared by both endpoints and by the integration tests. */
export async function handleGraphQL(server: ApolloServer<Ctx>, request: Request, db: Db = getPrisma()): Promise<Response> {
  if (request.method !== "POST") return json(405, "Use POST.", "METHOD_NOT_ALLOWED");
  if (!originAllowed(request)) return json(403, "Cross-origin requests are not allowed.", "FORBIDDEN");

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return json(413, "Request is too large.", "BAD_REQUEST");
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return json(400, "Body must be JSON.", "BAD_REQUEST");
  }

  const headers = new HeaderMap();
  request.headers.forEach((value, key) => headers.set(key, value));
  const ctx = await buildContext(db, request);

  const result = await server.executeHTTPGraphQLRequest({
    httpGraphQLRequest: { method: "POST", headers, search: new URL(request.url).search, body },
    context: async () => ctx,
  });

  const responseHeaders = new Headers();
  for (const [key, value] of result.headers) responseHeaders.set(key, value);
  responseHeaders.set("cache-control", "no-store");
  for (const cookie of ctx.setCookies) responseHeaders.append("set-cookie", cookie);

  let payload = "";
  if (result.body.kind === "complete") payload = result.body.string;
  else for await (const chunk of result.body.asyncIterator) payload += chunk;

  return new Response(payload, { status: result.status ?? 200, headers: responseHeaders });
}
