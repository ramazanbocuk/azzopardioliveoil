/**
 * Which environment this is, and the rules that follow from it. Pure, with
 * no imports, so the request proxy and the email channel can use it.
 */

type Env = Record<string, string | undefined>;

export type AppEnvironment = "production" | "staging" | "development";

/** Staging is a production build that says so (APP_ENV=staging): same code, test money, no search engines, no email to strangers. */
export function appEnvironment(env: Env = process.env): AppEnvironment {
  if (env.APP_ENV === "staging") return "staging";
  return env.NODE_ENV === "production" ? "production" : "development";
}

/**
 * On staging, email goes only to addresses the owner listed
 * (STAGING_EMAIL_ALLOW: addresses or @domains, comma-separated). A copy of
 * real customer data must never email real customers.
 */
export function emailAllowed(to: string, env: Env = process.env): boolean {
  if (appEnvironment(env) !== "staging") return true;
  const allowed = (env.STAGING_EMAIL_ALLOW ?? "").toLowerCase().split(",").map((entry) => entry.trim()).filter(Boolean);
  const address = to.trim().toLowerCase();
  return allowed.some((entry) => (entry.startsWith("@") ? address.endsWith(entry) : address === entry));
}

/**
 * Where the admin panel may be reached when it has a host of its own
 * (ADMIN_HOST, such as admin.example.com). On that host everything except
 * the panel and the APIs goes to the panel; on every other host the panel
 * does not exist. Without ADMIN_HOST nothing changes.
 */
export function adminHostRule(host: string | null, pathname: string, adminHost: string | undefined): "pass" | "to-admin" | "not-found" {
  const wanted = adminHost?.trim().toLowerCase();
  if (!wanted) return "pass";
  const here = (host ?? "").toLowerCase().split(":")[0];
  const isPanel = pathname === "/admin" || pathname.startsWith("/admin/");
  const shared = pathname.startsWith("/api/") || pathname.startsWith("/_next/") || pathname.startsWith("/media/") || /\.[a-zA-Z0-9]+$/.test(pathname);
  if (here === wanted.split(":")[0]) return isPanel || shared ? "pass" : "to-admin";
  return isPanel || pathname.startsWith("/api/admin/") ? "not-found" : "pass";
}


/**
 * Which database address the running site uses, and how many connections
 * each server process may hold.
 *
 * A host such as Vercel runs many short-lived copies of the site. If each
 * opens its own set of direct connections, a managed database soon refuses
 * with "too many connections". Such databases give a second, pooled address
 * for exactly this: when DATABASE_URL_POOLED is set it is used by the site,
 * and DATABASE_URL (direct) is left to migrations, which need it.
 * DATABASE_POOL_MAX overrides the number of connections per process.
 */
export function databaseConnection(env: Env = process.env): { connectionString: string | undefined; max: number; pooled: boolean } {
  const pooledUrl = env.DATABASE_URL_POOLED?.trim();
  const pooled = !!pooledUrl && /^postgres(ql)?:\/\//.test(pooledUrl);
  const wanted = Number(env.DATABASE_POOL_MAX);
  const hosted = !!env.VERCEL;
  const max = Number.isInteger(wanted) && wanted > 0 ? wanted : hosted ? (pooled ? 5 : 2) : 10;
  return { connectionString: pooled ? pooledUrl : env.DATABASE_URL, max, pooled };
}
