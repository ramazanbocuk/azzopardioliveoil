import { adminSchema } from "@/graphql/admin";
import { createServer, handleGraphQL } from "@/graphql/server";

const server = createServer(adminSchema);

/** Administration API. Every field checks the admin session and role itself. */
export async function POST(request: Request) {
  return handleGraphQL(server, request);
}
