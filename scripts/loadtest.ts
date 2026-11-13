/**
 * A small load test. It sends requests to pages and the API at a fixed
 * number at a time for a fixed duration and reports how long they took.
 *
 *   npx tsx scripts/loadtest.ts http://localhost:3100 --concurrency 20 --seconds 20
 *
 * Point it at a production BUILD (`next start`), never at `next dev`, and
 * never at the live shop without meaning to: it also adds to carts. The
 * numbers describe the machine it ran on; a laptop is not the host.
 */

const args = process.argv.slice(2);
const base = (args.find((arg) => arg.startsWith("http")) ?? "http://localhost:3100").replace(/\/$/, "");
const option = (name: string, fallback: number) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? Number(args[index + 1]) || fallback : fallback;
};
const concurrency = option("concurrency", 20);
const seconds = option("seconds", 20);

type Target = { name: string; weight: number; request: () => Promise<Response> };
const graphql = (query: string, variables: object = {}) => fetch(`${base}/api/graphql`, { method: "POST", headers: { "content-type": "application/json", origin: base, "x-forwarded-for": `10.77.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` }, body: JSON.stringify({ query, variables }) });

async function main() {
  // Find a real product and size to work with, so the test follows whatever the catalogue holds.
  const catalogue = (await (await graphql("{ products { nodes { slug variants { sku inStock } } } }")).json()) as { data?: { products: { nodes: { slug: string; variants: { sku: string; inStock: boolean }[] }[] } } };
  const product = catalogue.data?.products.nodes[0];
  const sku = product?.variants.find((variant) => variant.inStock)?.sku;
  if (!product || !sku) throw new Error(`No product in stock at ${base}: nothing to test with.`);

  const targets: Target[] = [
    { name: "home page", weight: 3, request: () => fetch(`${base}/en`) },
    { name: "shop page", weight: 4, request: () => fetch(`${base}/en/shop`) },
    { name: "product page", weight: 5, request: () => fetch(`${base}/en/products/${product.slug}`) },
    { name: "API: catalogue", weight: 3, request: () => graphql("{ products { nodes { slug name variants { sku priceCents inStock } } } }") },
    { name: "API: read cart", weight: 3, request: () => graphql("{ cart { itemCount subtotalCents } }") },
    { name: "API: add to cart", weight: 2, request: () => graphql("mutation ($sku: String!) { cartAdd(sku: $sku, quantity: 1) { itemCount } }", { sku }) },
    { name: "health check", weight: 1, request: () => fetch(`${base}/api/health`) },
  ];
  const wheel = targets.flatMap((target) => Array.from({ length: target.weight }, () => target));
  const results = new Map<string, { times: number[]; failures: number; statuses: Map<number, number> }>(targets.map((target) => [target.name, { times: [], failures: 0, statuses: new Map() }]));

  const until = Date.now() + seconds * 1000;
  const started = Date.now();
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (Date.now() < until) {
        const target = wheel[Math.floor(Math.random() * wheel.length)];
        const record = results.get(target.name)!;
        const begin = performance.now();
        try {
          const response = await target.request();
          await response.arrayBuffer();
          record.times.push(performance.now() - begin);
          record.statuses.set(response.status, (record.statuses.get(response.status) ?? 0) + 1);
          if (response.status >= 500) record.failures += 1;
        } catch {
          record.failures += 1;
        }
      }
    }),
  );
  const elapsed = (Date.now() - started) / 1000;

  const at = (sorted: number[], fraction: number) => (sorted.length ? Math.round(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))]) : 0);
  let total = 0;
  let failed = 0;
  console.log(`\n${base} · ${concurrency} at a time · ${elapsed.toFixed(0)} s\n`);
  console.log("request".padEnd(20), "count".padStart(7), "median".padStart(8), "95%".padStart(7), "99%".padStart(7), "slowest".padStart(8), "  5xx/failed  statuses");
  for (const [name, record] of results) {
    const sorted = [...record.times].sort((a, b) => a - b);
    total += sorted.length + (record.failures - [...record.statuses].filter(([status]) => status >= 500).reduce((sum, [, count]) => sum + count, 0));
    failed += record.failures;
    console.log(name.padEnd(20), String(sorted.length).padStart(7), `${at(sorted, 0.5)} ms`.padStart(8), `${at(sorted, 0.95)} ms`.padStart(7), `${at(sorted, 0.99)} ms`.padStart(7), `${at(sorted, 1)} ms`.padStart(8), `  ${record.failures}`.padEnd(13), [...record.statuses].map(([status, count]) => `${status}×${count}`).join(" "));
  }
  console.log(`\n${total} requests, ${(total / elapsed).toFixed(0)} per second, ${failed} failed or answered 5xx.\n`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
