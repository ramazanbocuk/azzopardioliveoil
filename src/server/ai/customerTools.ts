import { z } from "zod";
import { LANGUAGE_NAME, languageOf, localizePath, tagOf, toLocale } from "@/i18n/config";
import { countryName, formatMoney } from "@/i18n/format";
import { loadCatalog } from "../catalogView";
import { listOrdersForCustomer, shippingOptions } from "../checkout";
import type { Ctx } from "../context";
import { AppError } from "../errors";
import { openBackorder, outstanding } from "../stock";
import type { ToolSpec } from "./provider";

/**
 * What the customer assistant can do. This list is the whole of it: the
 * model has no other way to read or change anything.
 *
 * Every tool reads through the same services the shop uses, with the
 * visitor's own session, so it can never see more than the visitor could.
 * None of them takes money, places an order, changes an address or adds to
 * the cart: "propose_add_to_cart" only shows the customer a button.
 *
 * Tool results are facts for the model to phrase. Where a fact is missing
 * the result says so in words ("not recorded", "no verified result"), so the
 * model is told not to fill the gap rather than left to guess.
 */

/** What a turn may ask the page to show beside the assistant's words. */
export type Actions = {
  products: { slug: string; name: string; blurb: string; price: string; url: string }[];
  cart: { sku: string; quantity: number; name: string; price: string }[];
  handover: { reference: string } | null;
};
export const noActions = (): Actions => ({ products: [], cart: [], handover: null });

export type ToolContext = { ctx: Ctx; conversationId: string; actions: Actions };
type Outcome = { result: unknown; isError?: boolean };
type Tool = { spec: ToolSpec; run(input: unknown, context: ToolContext): Promise<Outcome> };

const NOT_RECORDED = "not recorded";
const object = (properties: Record<string, unknown>): ToolSpec["input_schema"] => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });
const nullable = (type: string, description: string) => ({ type: [type, "null"], description });
const refusal = (message: string): Outcome => ({ result: { error: message }, isError: true });

const locale = (ctx: Ctx) => toLocale(ctx.locale);
const money = (ctx: Ctx, cents: number) => formatMoney(tagOf(locale(ctx)), cents);
const link = (ctx: Ctx, path: string) => localizePath(locale(ctx), path);

function sizes(ctx: Ctx, product: Awaited<ReturnType<typeof loadCatalog>>["products"][number]) {
  return product.variants.map((variant) => ({
    sku: variant.sku,
    size: variant.label,
    price: money(ctx, variant.priceCents),
    availability: variant.inStock ? "in stock" : variant.backorder ? "not in stock; can be ordered now and is sent when it arrives" : "sold out",
  }));
}

const searchProducts: Tool = {
  spec: {
    name: "search_products",
    description: "Search the shop's catalogue. Returns products with their sizes, prices and live availability. Call this before recommending, comparing or naming any product, and whenever the customer asks what is sold. Pass null to list everything.",
    input_schema: object({ query: nullable("string", "Words to look for in the name, description, country, region, olive variety or category. Null lists the whole catalogue.") }),
  },
  async run(input, { ctx }) {
    const { query } = z.object({ query: z.string().max(200).nullable() }).parse(input);
    const { products, categories } = await loadCatalog(ctx.db, languageOf(locale(ctx)));
    const words = (query ?? "").toLowerCase().split(/\s+/).filter((word) => word.length > 1);
    const tag = tagOf(locale(ctx));
    const scored = products
      .map((product) => {
        const category = categories.find((entry) => entry.slug === product.categorySlug)?.name ?? "";
        const haystack = [product.name, product.blurb, product.description.join(" "), category, product.profile.country ? countryName(tag, product.profile.country) : "", product.profile.country ?? "", product.profile.region ?? "", product.profile.varieties.map((entry) => entry.name).join(" "), product.profile.aroma ?? "", product.profile.taste ?? "", product.profile.pairings ?? "", product.facts.cultivar ?? ""].join(" ").toLowerCase();
        return { product, category, score: words.filter((word) => haystack.includes(word)).length };
      })
      .filter((entry) => words.length === 0 || entry.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8);
    return {
      result: {
        found: scored.length,
        products: scored.map(({ product, category }) => ({
          slug: product.slug,
          name: product.name,
          category,
          summary: product.blurb || NOT_RECORDED,
          country: product.profile.country ? countryName(tag, product.profile.country) : NOT_RECORDED,
          region: product.profile.region ?? NOT_RECORDED,
          varieties: product.profile.varieties.length ? product.profile.varieties.map((entry) => entry.name) : NOT_RECORDED,
          sizes: sizes(ctx, product),
          hasVerifiedLabResults: product.lab.length > 0,
          page: link(ctx, `/products/${product.slug}`),
        })),
        note: scored.length === 0 ? "Nothing in the catalogue matches. Say so; do not describe products that were not returned." : "Only these products exist in the shop. Use get_product for the details of one.",
      },
    };
  },
};

const getProduct: Tool = {
  spec: {
    name: "get_product",
    description: "Everything the shop has recorded about one product: origin, producer, olive varieties, harvest, tasting notes, storage, sizes with prices and live availability, and the laboratory results of the current lot. Call this before stating ANY fact about a product, and always before mentioning a polyphenol, acidity or other measured value.",
    input_schema: object({ slug: { type: "string", description: "The product's slug, from search_products." } }),
  },
  async run(input, { ctx }) {
    const { slug } = z.object({ slug: z.string().max(140) }).parse(input);
    const { products } = await loadCatalog(ctx.db, languageOf(locale(ctx)));
    const product = products.find((entry) => entry.slug === slug.trim().toLowerCase());
    if (!product) return refusal("No product with that slug is sold. Use search_products to find what exists.");
    const tag = tagOf(locale(ctx));
    const { profile, facts } = product;
    const number = (value: number, decimals: number) => new Intl.NumberFormat(tag, { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(value);
    return {
      result: {
        slug: product.slug,
        name: product.name,
        summary: product.blurb || NOT_RECORDED,
        description: product.description.length ? product.description.join("\n\n") : NOT_RECORDED,
        descriptionLanguage: product.translated ? LANGUAGE_NAME[languageOf(locale(ctx))] : "English (not yet translated)",
        origin: {
          country: profile.country ? countryName(tag, profile.country) : NOT_RECORDED,
          region: profile.region ?? NOT_RECORDED,
          producer: profile.producer ? [profile.producer.name, profile.producer.place].filter(Boolean).join(", ") : NOT_RECORDED,
          oliveVarieties: profile.varieties.length ? profile.varieties.map((entry) => (entry.percent === null ? entry.name : `${entry.name} ${entry.percent}%`)) : (facts.cultivar ?? NOT_RECORDED),
          type: profile.composition === "SINGLE_VARIETY" ? "single variety" : profile.composition === "BLEND" ? "blend" : NOT_RECORDED,
          harvesting: profile.harvesting ?? NOT_RECORDED,
          extraction: profile.extraction ?? NOT_RECORDED,
        },
        currentLot: {
          lotNumber: product.lot ?? NOT_RECORDED,
          harvestYear: profile.harvestYear ?? NOT_RECORDED,
          harvestDate: facts.harvest ?? NOT_RECORDED,
          bottled: facts.bottled ?? NOT_RECORDED,
          bestBefore: facts.bestBefore ?? NOT_RECORDED,
        },
        // Only results staff verified against the laboratory's report, for a published lot, are ever here.
        laboratoryResults: product.lab.map((result) => ({ measure: result.label, value: `${number(result.value, result.decimals)}${result.unit ? ` ${result.unit}` : ""}`, method: result.method ?? NOT_RECORDED, laboratory: result.laboratory ?? NOT_RECORDED, tested: result.tested ?? NOT_RECORDED, report: result.certificateUrl ?? NOT_RECORDED })),
        laboratoryNote:
          product.lab.length === 0
            ? "NO verified laboratory result is published for the current lot. Tell the customer plainly that no verified figure is available for this lot. Do NOT give a polyphenol, acidity or any other value, a typical range, or an expectation based on the variety or origin."
            : `These values were measured on lot ${product.lot}. Quote them exactly, with the lot number, and add nothing: a measure that is not listed has not been verified.`,
        tasting: {
          aroma: profile.aroma ?? NOT_RECORDED,
          taste: profile.taste ?? NOT_RECORDED,
          bitterness: profile.bitterness === null ? NOT_RECORDED : `${profile.bitterness} of 5 (the shop's own tasting judgement, not a laboratory value)`,
          pungency: profile.pungency === null ? NOT_RECORDED : `${profile.pungency} of 5 (the shop's own tasting judgement, not a laboratory value)`,
          pairings: profile.pairings ?? NOT_RECORDED,
        },
        ingredients: facts.ingredients ?? NOT_RECORDED,
        storage: facts.storage ?? NOT_RECORDED,
        packaging: profile.packaging ?? NOT_RECORDED,
        sizes: sizes(ctx, product),
        waitWhenOutOfStock: product.backorderNote ?? NOT_RECORDED,
        page: link(ctx, `/products/${product.slug}`),
        rule: `Where a field says "${NOT_RECORDED}", tell the customer the shop has not recorded it. Never supply it from general knowledge.`,
      },
    };
  },
};

const showProducts: Tool = {
  spec: {
    name: "show_products",
    description: "Show the customer cards for up to four products, each linking to its page. Use it when you recommend or compare products, so they can open them. It changes nothing.",
    input_schema: object({ slugs: { type: "array", items: { type: "string" }, description: "Slugs from search_products, most relevant first." } }),
  },
  async run(input, { ctx, actions }) {
    const { slugs } = z.object({ slugs: z.array(z.string().max(140)).min(1).max(8) }).parse(input);
    const { products } = await loadCatalog(ctx.db, languageOf(locale(ctx)));
    const found = [...new Set(slugs)].flatMap((slug) => products.filter((product) => product.slug === slug)).slice(0, 4);
    if (found.length === 0) return refusal("None of those slugs is a product in the shop.");
    for (const product of found) {
      if (actions.products.some((entry) => entry.slug === product.slug)) continue;
      const lowest = Math.min(...product.variants.map((variant) => variant.priceCents));
      actions.products.push({ slug: product.slug, name: product.name, blurb: product.blurb, price: Number.isFinite(lowest) ? money(ctx, lowest) : "", url: link(ctx, `/products/${product.slug}`) });
    }
    return { result: { shown: found.map((product) => product.name) } };
  },
};

const proposeAddToCart: Tool = {
  spec: {
    name: "propose_add_to_cart",
    description: "Offer to put a product in the customer's cart. This does NOT add anything: it shows the customer a button, and the item is added only if they press it. Use it only after the customer has said they want that product and size. You cannot check out or pay for them.",
    input_schema: object({ sku: { type: "string", description: "The size's SKU, from get_product or search_products." }, quantity: { type: "integer", description: "How many, 1 to 12." } }),
  },
  async run(input, { ctx, actions }) {
    const { sku, quantity } = z.object({ sku: z.string().max(80), quantity: z.number().int().min(1).max(12) }).parse(input);
    const { products } = await loadCatalog(ctx.db, languageOf(locale(ctx)));
    const product = products.find((entry) => entry.variants.some((variant) => variant.sku === sku));
    const variant = product?.variants.find((entry) => entry.sku === sku);
    if (!product || !variant) return refusal("That SKU is not sold. Use get_product to see the sizes that exist.");
    if (!variant.inStock && !variant.backorder) return refusal(`${product.name} ${variant.label} is sold out and cannot be ordered. Tell the customer, and suggest another size or product only if one is in stock.`);
    actions.cart.push({ sku, quantity, name: `${product.name} ${variant.label}`, price: money(ctx, variant.priceCents) });
    return { result: { buttonShown: true, item: `${quantity} × ${product.name} ${variant.label}`, note: `A button has been shown. Nothing is in the cart until the customer presses it; say so.${variant.inStock ? "" : " This size is not in stock: it would be sent when it arrives."}` } };
  },
};

const getShippingOptions: Tool = {
  spec: {
    name: "get_shipping_options",
    description: "Shipping methods and prices to one country for what is in the customer's cart now (or the base rates if the cart is empty). Returns only what the shop has configured. It gives no delivery date: never promise one.",
    input_schema: object({ countryCode: { type: "string", description: "Two-letter country code, such as BE, DE, FR, US." } }),
  },
  async run(input, { ctx }) {
    const { countryCode } = z.object({ countryCode: z.string().length(2) }).parse(input);
    try {
      const options = await shippingOptions(ctx, countryCode);
      const name = countryName(tagOf(locale(ctx)), countryCode.toUpperCase());
      if (options.length === 0) return { result: { country: name, delivers: false, note: "The shop does not deliver to this country at the moment. Say so; do not suggest a workaround." } };
      return {
        result: {
          country: name,
          delivers: true,
          methods: options.map((option) => ({ name: option.name, carrier: option.carrier ?? NOT_RECORDED, price: option.priceCents === 0 ? "free" : money(ctx, option.priceCents), deliveryTimeAsStatedByTheShop: option.estimate ?? NOT_RECORDED })),
          note: "Prices are for the current cart and are confirmed at checkout. Delivery times are only what the shop has stated above; if none is stated, say the shop gives no estimate. Policies on returns are on the shipping and returns page.",
          page: link(ctx, "/shipping-returns"),
        },
      };
    } catch (error) {
      if (error instanceof AppError) return refusal(error.message);
      throw error;
    }
  },
};

const searchKnowledge: Tool = {
  spec: {
    name: "search_knowledge",
    description: "Search the shop's approved articles: how to store and use olive oil, what terms such as polyphenols, free acidity or harvest year mean, how ordering, shipping and returns work. Use it for any general question. It holds no facts about a specific product or lot: those come from get_product.",
    input_schema: object({ query: { type: "string", description: "What the customer wants to know, in a few words. English works best." } }),
  },
  async run(input, { ctx }) {
    const { query } = z.object({ query: z.string().min(2).max(200) }).parse(input);
    const rows = await ctx.db.$queryRaw<{ title: string; body: string }[]>`
      SELECT "title", "body" FROM "KnowledgeArticle"
      WHERE "isPublished" AND "audience" = 'customer'
        AND to_tsvector('simple', "title" || ' ' || "body") @@ websearch_to_tsquery('simple', ${query.split(/\s+/).join(" OR ")})
      ORDER BY ts_rank(to_tsvector('simple', "title" || ' ' || "body"), websearch_to_tsquery('simple', ${query.split(/\s+/).join(" OR ")})) DESC
      LIMIT 3`;
    if (rows.length === 0) return { result: { found: 0, note: "No approved article covers this. Say you do not have that information, and offer to pass the question to the team with request_human_help. Do not answer from general knowledge where it concerns health, food safety, the law or this shop's policies." } };
    return { result: { found: rows.length, articles: rows.map((row) => ({ title: row.title, text: row.body.slice(0, 2500) })), note: "Answer from these articles. They are the shop's approved wording; do not add health claims to them." } };
  },
};

const getMyOrders: Tool = {
  spec: {
    name: "get_my_orders",
    description: "The signed-in customer's recent orders with every shipment: what was in it, the carrier, the tracking number and link, its status, and what is still to come. Use it for 'where is my order?'. Works only for a signed-in customer.",
    input_schema: object({ orderNumber: nullable("string", "An order number such as AZZ-1042 to look at one order, or null for the most recent orders.") }),
  },
  async run(input, { ctx }) {
    const { orderNumber } = z.object({ orderNumber: z.string().max(20).nullable() }).parse(input);
    if (!ctx.customer) {
      return { result: { signedIn: false, note: "The customer is not signed in, so you cannot see any order, and you must not ask for an order number to look one up. Tell them to sign in to their account, or to use the order tracking page with their order number and email address.", account: link(ctx, "/account"), tracking: link(ctx, "/order-tracking") } };
    }
    const tag = tagOf(locale(ctx));
    const day = (date: Date | null) => (date ? new Intl.DateTimeFormat(tag, { dateStyle: "long" }).format(date) : null);
    const wanted = orderNumber?.trim().toUpperCase().replace(/^#/, "") ?? null;
    // Only this customer's own orders are ever loaded; a number belonging to someone else finds nothing.
    const orders = (await listOrdersForCustomer(ctx.db, ctx.customer.id)).filter((order) => !wanted || order.number === wanted).slice(0, wanted ? 1 : 3);
    if (orders.length === 0) return { result: { signedIn: true, found: 0, note: wanted ? "This customer has no order with that number. Do not guess at its status." : "This customer has no orders yet." } };
    return {
      result: {
        signedIn: true,
        found: orders.length,
        orders: orders.map((order) => {
          const toCome = order.items.filter((item) => outstanding(item) > 0);
          return {
            number: order.number,
            placed: day(order.placedAt),
            status: order.status,
            payment: order.paymentStatus,
            total: money(ctx, order.totalCents),
            shipments: order.shipments.map((shipment, index) => ({
              shipment: `${index + 1} of ${order.shipments.length + (toCome.length ? 1 : 0)}`,
              contains: shipment.items.map((line) => `${line.quantity} × ${line.orderItem.productName} ${line.orderItem.variantLabel}`),
              carrier: shipment.carrier,
              trackingNumber: shipment.trackingNumber ?? "none recorded",
              trackingLink: shipment.trackingUrl ?? "none recorded",
              status: shipment.status,
              sent: day(shipment.shippedAt),
              delivered: day(shipment.deliveredAt),
              carrierEstimate: shipment.status === "DELIVERED" ? null : (day(shipment.estimatedDeliveryAt) ?? "the carrier has given no estimate"),
              carrierReportsAProblem: !!shipment.exceptionAt || shipment.status === "FAILED" || shipment.status === "RETURNED",
              latestUpdate: shipment.events[0] ? `${day(shipment.events[0].occurredAt)}: ${shipment.events[0].description}` : "no tracking update recorded",
            })),
            stillToCome: toCome.map((item) => {
              const waiting = openBackorder(item.backorder);
              return `${outstanding(item)} × ${item.productName} ${item.variantLabel}${waiting > 0 ? ` (${waiting} waiting for stock)` : " (being prepared)"}`;
            }),
          };
        }),
        note: "Explain each shipment separately. Give tracking numbers and links exactly as shown. Give a delivery date only where 'carrierEstimate' has one, and call it the carrier's estimate. If the carrier reports a problem, say the team is looking into it and offer request_human_help.",
      },
    };
  },
};

const requestHumanHelp: Tool = {
  spec: {
    name: "request_human_help",
    description: "Pass the conversation to a person at the shop, who will reply by email. Use it when the customer asks for a person, is upset, has a problem with an order, payment, refund, damaged or missing parcel, wants something only staff can do, or asks something you cannot answer from your tools. You need an email address: for a signed-in customer pass null and theirs is used; otherwise ask for it first.",
    input_schema: object({
      subject: { type: "string", description: "What it is about, in a few words." },
      summary: { type: "string", description: "What the customer needs and what has been said so far, in English, so staff need not read the whole chat." },
      email: nullable("string", "The customer's email address, or null for a signed-in customer."),
      name: nullable("string", "The customer's name if they gave it."),
      orderNumber: nullable("string", "The order number if they gave one."),
      urgent: { type: "boolean", description: "True for a complaint, a payment or refund problem, a damaged, missing or wrongly delivered parcel, or a safety concern about a product." },
    }),
  },
  async run(input, { ctx, conversationId, actions }) {
    const data = z.object({ subject: z.string().min(3).max(160), summary: z.string().min(10).max(4000), email: z.string().max(200).nullable(), name: z.string().max(120).nullable(), orderNumber: z.string().max(20).nullable(), urgent: z.boolean() }).parse(input);
    const email = (ctx.customer?.email ?? data.email ?? "").trim().toLowerCase();
    if (!z.string().email().safeParse(email).success) return refusal("An email address is needed so the team can reply. Ask the customer for it, then call this tool again.");
    const already = await ctx.db.supportRequest.findFirst({ where: { conversationId, status: "OPEN" }, select: { sequence: true } });
    if (already) {
      actions.handover = { reference: supportReference(already.sequence) };
      return { result: { reference: supportReference(already.sequence), note: "This conversation has already been passed to the team under this reference. Tell the customer it is in hand; do not create another." } };
    }
    const request = await ctx.db.$transaction(async (tx) => {
      const created = await tx.supportRequest.create({ data: { conversationId, customerId: ctx.customer?.id ?? null, email, name: data.name ?? (ctx.customer ? `${ctx.customer.firstName} ${ctx.customer.lastName}` : null), subject: data.subject, body: data.summary, orderNumber: data.orderNumber?.toUpperCase() ?? null, locale: locale(ctx), source: "assistant", urgent: data.urgent } });
      await tx.aiConversation.update({ where: { id: conversationId }, data: { status: "HANDED_OVER" } });
      await tx.outboxJob.createMany({ data: [{ kind: "notify.owner.support", dedupeKey: `notify.owner.support:${created.id}`, payload: { supportRequestId: created.id } }], skipDuplicates: true });
      return created;
    });
    actions.handover = { reference: supportReference(request.sequence) };
    return { result: { reference: supportReference(request.sequence), repliesTo: email, note: "The team has been told and will reply by email. Give the customer the reference. Do not promise how quickly they will answer." } };
  },
};

export const supportReference = (sequence: number) => `S-${String(sequence).padStart(5, "0")}`;

export const CUSTOMER_TOOLS: Tool[] = [searchProducts, getProduct, showProducts, proposeAddToCart, getShippingOptions, searchKnowledge, getMyOrders, requestHumanHelp];
