import { createServer, handleGraphQL } from "@/graphql/server";
import { storefrontSchema } from "@/graphql/storefront";

const server = createServer(storefrontSchema);

/** Public storefront API. POST only; cookies carry the session and cart. */
export async function POST(request: Request) {
  return handleGraphQL(server, request);
}
