import { publicLabResults, type PublicLabResult } from "@/server/provenance";
import { toLocale } from "@/i18n/config";
import { textOf } from "@/server/translations";
import SchemaBuilder from "@pothos/core";
import type { Batch, BatchDocument, Category, Customer, Order, OrderEvent, OrderItem, Product, Review, Shipment, Variant } from "@/generated/prisma/client";
import { chooseLanguage, deleteOwnAccount, login, logout, register, requestPasswordReset, requireCustomer, resetPassword } from "@/server/auth";
import { exportCustomerData } from "@/server/privacy";
import { addItem, applyDiscount, findCart, removeDiscount, removeItem, setQuantity, summarise, type CartSummary } from "@/server/cart";
import { getProduct, listCategories, listProducts, lookupLot } from "@/server/catalog";
import { findOrderByToken, findOrderForGuest, listOrdersForCustomer, placeOrder, shippingOptions } from "@/server/checkout";
import { getPaymentProvider, startPayment } from "@/server/payments";
import type { Ctx } from "@/server/context";
import { hashToken, newToken } from "@/server/crypto";
import { AppError } from "@/server/errors";
import { enforce } from "@/server/rateLimit";
import { loaders } from "./loaders";

/**
 * Storefront API — everything a visitor or signed-in customer may do.
 * Nothing administrative lives in this schema: internal notes, stock counts,
 * other customers and unpublished lots are not reachable from here at all.
 */

// Fields are non-null unless marked `nullable: true`, so generated client types are precise.
const builder = new SchemaBuilder<{ Context: Ctx; DefaultFieldNullability: false }>({ defaultFieldNullability: false });

const iso = (date: Date) => date.toISOString();
const day = (date: Date | null) => (date ? date.toISOString().slice(0, 10) : null);

type FullOrder = Order & { items: OrderItem[]; events: OrderEvent[]; shipments?: Shipment[]; accessToken?: string };
type LotDocument = Omit<BatchDocument, "data">;
type FullLot = Batch & { product: Product; documents: LotDocument[] };
type CartLine = CartSummary["lines"][number];
type ShippingOption = { id: string; name: string; carrier: string | null; estimate: string | null; priceCents: number };
type ProductPage = { nodes: Product[]; hasNextPage: boolean; endCursor: string | null; totalCount: number };

// ── Catalogue ──

const CategoryType = builder.objectRef<Category>("Category").implement({
  fields: (t) => ({
    id: t.exposeID("id"),
    slug: t.exposeString("slug"),
    name: t.string({ resolve: async (category, _args, ctx) => (await textOf(ctx, "category", category.id)).name ?? category.name }),
    intro: t.string({ resolve: async (category, _args, ctx) => (await textOf(ctx, "category", category.id)).intro ?? category.intro }),
  }),
});

const VariantType = builder.objectRef<Variant>("Variant").implement({
  description: "A purchasable size of a product.",
  fields: (t) => ({
    id: t.exposeID("id"),
    sku: t.exposeString("sku"),
    label: t.exposeString("label"),
    volumeMl: t.exposeInt("volumeMl"),
    priceCents: t.exposeInt("priceCents", { description: "Price in euro cents, VAT included." }),
    compareAtCents: t.exposeInt("compareAtCents", { nullable: true }),
    // Exact stock is commercial information; the storefront only learns these two facts.
    inStock: t.boolean({ resolve: (v) => v.stock - v.reserved > 0 }),
    lowStock: t.boolean({ resolve: (v) => v.stock - v.reserved > 0 && v.stock - v.reserved <= v.lowStockThreshold }),
  }),
});

const NutritionRow = builder.objectRef<{ label: string; value: string | null }>("NutritionRow").implement({
  fields: (t) => ({ label: t.exposeString("label"), value: t.exposeString("value", { nullable: true }) }),
});

const LotType = builder.objectRef<Batch>("Lot").implement({
  description: "One bottling. Fields are null until an administrator records them.",
  fields: (t) => ({
    lotNumber: t.exposeString("lotNumber"),
    harvestYear: t.exposeInt("harvestYear", { nullable: true }),
    harvestDate: t.string({ nullable: true, resolve: (b) => day(b.harvestDate) }),
    grove: t.exposeString("grove", { nullable: true }),
    mill: t.exposeString("mill", { nullable: true }),
    milledAt: t.string({ nullable: true, resolve: (b) => day(b.milledAt) }),
    bottledAt: t.string({ nullable: true, resolve: (b) => day(b.bottledAt) }),
    bestBefore: t.string({ nullable: true, resolve: (b) => day(b.bestBefore) }),
  }),
});

const LotDocumentType = builder.objectRef<LotDocument>("LotDocument").implement({
  description: "A verified document backing a claim about a lot.",
  fields: (t) => ({ kind: t.exposeString("kind"), title: t.exposeString("title"), url: t.exposeString("url") }),
});

const LabResultType = builder.objectRef<PublicLabResult>("LabResult").implement({
  description: "One value a laboratory measured in a lot. Only results staff have verified against the laboratory's report are ever returned.",
  fields: (t) => ({
    measure: t.exposeString("measure", { description: "Key of the measure, e.g. polyphenols, free_acidity, peroxide; or other." }),
    label: t.exposeString("label"),
    value: t.exposeFloat("value"),
    unit: t.exposeString("unit"),
    decimals: t.exposeInt("decimals"),
    method: t.exposeString("method", { nullable: true }),
    laboratory: t.exposeString("laboratory", { nullable: true }),
    testedAt: t.string({ nullable: true, resolve: (result) => day(result.testedAt) }),
    certificateUrl: t.exposeString("certificateUrl", { nullable: true }),
  }),
});

const LotRecordType = builder.objectRef<FullLot>("LotRecord").implement({
  fields: (t) => ({
    lot: t.field({ type: LotType, resolve: (record) => record }),
    productName: t.string({ resolve: (record) => record.product.name }),
    productSlug: t.string({ resolve: (record) => record.product.slug }),
    documents: t.field({ type: [LotDocumentType], resolve: (record) => record.documents }),
    labResults: t.field({ type: [LabResultType], description: "Verified laboratory results for this lot. Empty when none has been verified.", resolve: async (record, _args, ctx) => (await publicLabResults(ctx.db, [record.id])).get(record.id) ?? [] }),
  }),
});

const ReviewType = builder.objectRef<Review & { customer: Pick<Customer, "firstName"> }>("Review").implement({
  fields: (t) => ({
    id: t.exposeID("id"),
    rating: t.exposeInt("rating"),
    title: t.exposeString("title"),
    body: t.exposeString("body"),
    authorFirstName: t.string({ resolve: (review) => review.customer.firstName }),
    createdAt: t.string({ resolve: (review) => iso(review.createdAt) }),
  }),
});

const ProductType = builder.objectRef<Product & { variants?: Variant[] }>("Product").implement({
  fields: (t) => ({
    id: t.exposeID("id"),
    slug: t.exposeString("slug"),
    // Text fields answer in the language of the page that asked, when a translation is published; otherwise in English.
    name: t.string({ resolve: async (product, _args, ctx) => (await textOf(ctx, "product", product.id)).name ?? product.name }),
    blurb: t.string({ resolve: async (product, _args, ctx) => (await textOf(ctx, "product", product.id)).blurb ?? product.blurb }),
    description: t.string({ resolve: async (product, _args, ctx) => (await textOf(ctx, "product", product.id)).description ?? product.description }),
    origin: t.string({ nullable: true, resolve: async (product, _args, ctx) => (await textOf(ctx, "product", product.id)).origin ?? product.origin }),
    cultivar: t.string({ nullable: true, resolve: async (product, _args, ctx) => (await textOf(ctx, "product", product.id)).cultivar ?? product.cultivar }),
    ingredients: t.string({ nullable: true, resolve: async (product, _args, ctx) => (await textOf(ctx, "product", product.id)).ingredients ?? product.ingredients }),
    storage: t.string({ nullable: true, resolve: async (product, _args, ctx) => (await textOf(ctx, "product", product.id)).storage ?? product.storage }),
    seoTitle: t.exposeString("seoTitle", { nullable: true }),
    seoDescription: t.exposeString("seoDescription", { nullable: true }),
    nutrition: t.field({
      type: [NutritionRow],
      resolve: (product) => (Array.isArray(product.nutrition) ? (product.nutrition as { label: string; value: string | null }[]) : []),
    }),
    category: t.field({ type: CategoryType, nullable: true, resolve: (product, _args, ctx) => loaders(ctx).categoryById.load(product.categoryId) }),
    variants: t.field({ type: [VariantType], resolve: (product, _args, ctx) => product.variants ?? loaders(ctx).variantsByProduct.load(product.id) }),
    lots: t.field({ type: [LotType], description: "Published lots, newest bottling first.", resolve: (product, _args, ctx) => loaders(ctx).publishedBatchesByProduct.load(product.id) }),
    reviews: t.field({
      type: [ReviewType],
      resolve: (product, _args, ctx) =>
        ctx.db.review.findMany({ where: { productId: product.id, status: "APPROVED" }, orderBy: { createdAt: "desc" }, take: 50, include: { customer: { select: { firstName: true } } } }),
    }),
  }),
});

const ProductConnection = builder.objectRef<ProductPage>("ProductConnection").implement({
  fields: (t) => ({
    nodes: t.field({ type: [ProductType], resolve: (page) => page.nodes }),
    hasNextPage: t.exposeBoolean("hasNextPage"),
    endCursor: t.exposeString("endCursor", { nullable: true }),
    totalCount: t.exposeInt("totalCount"),
  }),
});

const ProductSort = builder.enumType("ProductSort", { values: ["FEATURED", "NAME", "NEWEST"] as const });

const ProductFilter = builder.inputType("ProductFilter", {
  fields: (t) => ({
    categorySlug: t.string(),
    search: t.string({ description: "Matches name, description, or an exact published lot number." }),
    volumesMl: t.intList(),
    inStockOnly: t.boolean(),
  }),
});

// ── Cart ──

const CartLineType = builder.objectRef<CartLine>("CartLine").implement({
  fields: (t) => ({
    sku: t.exposeString("sku"),
    quantity: t.exposeInt("quantity"),
    unitPriceCents: t.exposeInt("unitPriceCents"),
    lineTotalCents: t.exposeInt("lineTotalCents"),
    enoughStock: t.boolean({ resolve: (line) => line.available >= line.quantity }),
    variant: t.field({ type: VariantType, resolve: (line) => line.variant }),
    product: t.field({ type: ProductType, resolve: (line) => line.product }),
  }),
});

const CartType = builder.objectRef<CartSummary>("Cart").implement({
  description: "Totals are computed by the server from current prices.",
  fields: (t) => ({
    lines: t.field({ type: [CartLineType], resolve: (cart) => cart.lines }),
    itemCount: t.exposeInt("itemCount"),
    subtotalCents: t.exposeInt("subtotalCents"),
    discountCents: t.exposeInt("discountCents"),
    discountCode: t.exposeString("discountCode", { nullable: true }),
    freeShippingDiscount: t.exposeBoolean("freeShippingDiscount"),
  }),
});

const ShippingOptionType = builder.objectRef<ShippingOption>("ShippingOption").implement({
  fields: (t) => ({
    id: t.exposeID("id"),
    name: t.exposeString("name"),
    carrier: t.exposeString("carrier", { nullable: true }),
    estimate: t.exposeString("estimate", { nullable: true }),
    priceCents: t.exposeInt("priceCents"),
  }),
});

// ── Orders ──

const OrderItemType = builder.objectRef<OrderItem>("OrderItem").implement({
  fields: (t) => ({
    sku: t.exposeString("sku"),
    productName: t.exposeString("productName"),
    variantLabel: t.exposeString("variantLabel"),
    lotNumber: t.exposeString("lotNumber", { nullable: true }),
    unitPriceCents: t.exposeInt("unitPriceCents"),
    quantity: t.exposeInt("quantity"),
    lineTotalCents: t.exposeInt("lineTotalCents"),
  }),
});

const OrderEventType = builder.objectRef<OrderEvent>("OrderEvent").implement({
  fields: (t) => ({ kind: t.exposeString("kind"), message: t.exposeString("message"), at: t.string({ resolve: (event) => iso(event.createdAt) }) }),
});

const ShipmentType = builder.objectRef<Shipment>("Shipment").implement({
  fields: (t) => ({
    carrier: t.exposeString("carrier"),
    status: t.exposeString("status"),
    trackingNumber: t.exposeString("trackingNumber", { nullable: true }),
    trackingUrl: t.exposeString("trackingUrl", { nullable: true }),
    shippedAt: t.string({ nullable: true, resolve: (s) => (s.shippedAt ? iso(s.shippedAt) : null) }),
    deliveredAt: t.string({ nullable: true, resolve: (s) => (s.deliveredAt ? iso(s.deliveredAt) : null) }),
  }),
});

const OrderType = builder.objectRef<FullOrder>("Order").implement({
  fields: (t) => ({
    number: t.string({ resolve: (order) => order.number ?? "" }),
    accessToken: t.string({ nullable: true, description: "Private link token. Present only in the response that created the order.", resolve: (order) => order.accessToken ?? null }),
    canRequestReturn: t.boolean({ resolve: (order) => order.fulfilmentStatus === "DELIVERED" }),
    status: t.exposeString("status"),
    paymentStatus: t.exposeString("paymentStatus"),
    email: t.exposeString("email"),
    placedAt: t.string({ resolve: (order) => iso(order.placedAt) }),
    subtotalCents: t.exposeInt("subtotalCents"),
    discountCents: t.exposeInt("discountCents"),
    shippingCents: t.exposeInt("shippingCents"),
    taxCents: t.exposeInt("taxCents", { nullable: true, description: "VAT included in the total. Null if no rate is configured for the destination." }),
    totalCents: t.exposeInt("totalCents"),
    currency: t.exposeString("currency"),
    shippingRateName: t.exposeString("shippingRateName"),
    shipName: t.string({ resolve: (order) => `${order.shipFirstName} ${order.shipLastName}` }),
    shipLines: t.stringList({ resolve: (order) => [order.shipLine1, order.shipLine2, `${order.shipPostalCode} ${order.shipCity}`].filter((line): line is string => Boolean(line)) }),
    shipCountryCode: t.exposeString("shipCountryCode"),
    items: t.field({ type: [OrderItemType], resolve: (order) => order.items }),
    events: t.field({ type: [OrderEventType], resolve: (order) => order.events }),
    shipments: t.field({ type: [ShipmentType], resolve: (order) => order.shipments ?? [] }),
  }),
});

// ── Customer ──

const CustomerType = builder.objectRef<Customer>("Customer").implement({
  description: "The signed-in customer. Only ever resolved for the session's own account.",
  fields: (t) => ({
    id: t.exposeID("id"),
    email: t.exposeString("email"),
    firstName: t.exposeString("firstName"),
    lastName: t.exposeString("lastName"),
    marketingOptIn: t.exposeBoolean("marketingOptIn"),
    orders: t.field({ type: [OrderType], resolve: (customer, _args, ctx) => listOrdersForCustomer(ctx.db, customer.id) }),
    favouriteSkus: t.stringList({
      resolve: async (customer, _args, ctx) => (await ctx.db.favourite.findMany({ where: { customerId: customer.id }, include: { variant: { select: { sku: true } } } })).map((f) => f.variant.sku),
    }),
  }),
});

// ── Inputs ──

const RegisterInput = builder.inputType("RegisterInput", {
  fields: (t) => ({
    email: t.string({ required: true }),
    password: t.string({ required: true, description: "At least 12 characters." }),
    firstName: t.string({ required: true }),
    lastName: t.string({ required: true }),
    marketingOptIn: t.boolean(),
  }),
});

const AddressInput = builder.inputType("AddressInput", {
  fields: (t) => ({
    firstName: t.string({ required: true }),
    lastName: t.string({ required: true }),
    line1: t.string({ required: true }),
    line2: t.string(),
    postalCode: t.string({ required: true }),
    city: t.string({ required: true }),
    region: t.string(),
    countryCode: t.string({ required: true, description: "ISO 3166-1 alpha-2." }),
    phone: t.string(),
  }),
});

const BillingInput = builder.inputType("BillingInput", {
  description: "Invoice address, when it differs from the delivery address.",
  fields: (t) => ({
    firstName: t.string({ required: true }),
    lastName: t.string({ required: true }),
    company: t.string(),
    vatNumber: t.string(),
    line1: t.string({ required: true }),
    line2: t.string(),
    postalCode: t.string({ required: true }),
    city: t.string({ required: true }),
    region: t.string(),
    countryCode: t.string({ required: true, description: "ISO 3166-1 alpha-2." }),
  }),
});

const CheckoutInput = builder.inputType("CheckoutInput", {
  fields: (t) => ({
    email: t.string({ required: true }),
    shippingRateId: t.id({ required: true }),
    address: t.field({ type: AddressInput, required: true }),
    billing: t.field({ type: BillingInput, description: "Omit to bill to the delivery address." }),
    customerNote: t.string(),
    locale: t.string(),
  }),
});

const ReviewInput = builder.inputType("ReviewInput", {
  fields: (t) => ({
    productSlug: t.string({ required: true }),
    rating: t.int({ required: true }),
    title: t.string(),
    body: t.string({ required: true }),
  }),
});

// ── Queries ──

builder.queryType({
  fields: (t) => ({
    products: t.field({
      type: ProductConnection,
      args: { filter: t.arg({ type: ProductFilter }), sort: t.arg({ type: ProductSort }), first: t.arg.int(), after: t.arg.id() },
      resolve: (_root, args, ctx) =>
        listProducts(ctx.db, {
          categorySlug: args.filter?.categorySlug ?? undefined,
          search: args.filter?.search || undefined,
          volumesMl: args.filter?.volumesMl ?? undefined,
          inStockOnly: args.filter?.inStockOnly ?? undefined,
          sort: args.sort ?? undefined,
          first: args.first ?? undefined,
          after: args.after ? String(args.after) : undefined,
        }),
    }),
    product: t.field({ type: ProductType, nullable: true, args: { slug: t.arg.string({ required: true }) }, resolve: (_root, args, ctx) => getProduct(ctx.db, args.slug) }),
    categories: t.field({ type: [CategoryType], resolve: (_root, _args, ctx) => listCategories(ctx.db) }),
    lot: t.field({
      type: LotRecordType,
      nullable: true,
      description: "Public record for a lot number. Null if unknown or not yet published.",
      args: { lotNumber: t.arg.string({ required: true }) },
      resolve: (_root, args, ctx) => lookupLot(ctx.db, ctx.ip, args.lotNumber),
    }),
    me: t.field({ type: CustomerType, nullable: true, resolve: (_root, _args, ctx) => ctx.customer }),
    myData: t.string({
      description: "Everything held about the signed-in customer, as a JSON document (GDPR access and portability).",
      resolve: async (_root, _args, ctx) => JSON.stringify(await exportCustomerData(ctx.db, requireCustomer(ctx).id), null, 2),
    }),
    cart: t.field({ type: CartType, resolve: async (_root, _args, ctx) => summarise(ctx.db, await findCart(ctx)) }),
    shippingOptions: t.field({
      type: [ShippingOptionType],
      description: "Rates for the current cart to a country. Empty when we do not deliver there.",
      args: { countryCode: t.arg.string({ required: true }) },
      resolve: (_root, args, ctx) => shippingOptions(ctx, args.countryCode),
    }),
    orderByToken: t.field({
      type: OrderType,
      nullable: true,
      description: "Opens an order with the private token issued when it was placed.",
      args: { number: t.arg.string({ required: true }), token: t.arg.string({ required: true }) },
      resolve: (_root, args, ctx) => findOrderByToken(ctx, args.number, args.token),
    }),
    paymentAvailable: t.boolean({ description: "False until a payment provider is connected.", resolve: () => getPaymentProvider() !== null }),
    order: t.field({
      type: OrderType,
      nullable: true,
      description: "Guest order lookup. Requires the order number and the email used to order.",
      args: { number: t.arg.string({ required: true }), email: t.arg.string({ required: true }) },
      resolve: (_root, args, ctx) => findOrderForGuest(ctx, args.number, args.email),
    }),
  }),
});

// ── Mutations ──

builder.mutationType({
  fields: (t) => ({
    setLanguage: t.string({ description: "Remembers the visitor's chosen language on this device and, when signed in, on their account.", args: { locale: t.arg.string({ required: true }) }, resolve: (_root, args, ctx) => chooseLanguage(ctx, args.locale) }),
    register: t.field({ type: CustomerType, args: { input: t.arg({ type: RegisterInput, required: true }) }, resolve: (_root, args, ctx) => register(ctx, args.input) }),
    login: t.field({
      type: CustomerType,
      args: { email: t.arg.string({ required: true }), password: t.arg.string({ required: true }) },
      resolve: (_root, args, ctx) => login(ctx, args),
    }),
    logout: t.boolean({
      resolve: async (_root, _args, ctx) => {
        await logout(ctx);
        return true;
      },
    }),

    requestPasswordReset: t.boolean({
      description: "Emails a reset link if the address has an account. Always returns true.",
      args: { email: t.arg.string({ required: true }) },
      resolve: async (_root, args, ctx) => {
        await requestPasswordReset(ctx, args.email);
        return true;
      },
    }),
    resetPassword: t.boolean({
      args: { id: t.arg.string({ required: true }), exp: t.arg.string({ required: true }), sig: t.arg.string({ required: true }), password: t.arg.string({ required: true }) },
      resolve: async (_root, args, ctx) => {
        await resetPassword(ctx, args);
        return true;
      },
    }),
    deleteMyAccount: t.boolean({
      description: "Erases the signed-in customer's personal data. Requires the current password. Orders are kept as the law requires, detached from the account.",
      args: { password: t.arg.string({ required: true }) },
      resolve: async (_root, args, ctx) => {
        await deleteOwnAccount(ctx, args.password);
        return true;
      },
    }),

    cartAdd: t.field({
      type: CartType,
      args: { sku: t.arg.string({ required: true }), quantity: t.arg.int({ defaultValue: 1 }) },
      resolve: async (_root, args, ctx) => summarise(ctx.db, await addItem(ctx, args.sku, args.quantity ?? 1)),
    }),
    cartSetQuantity: t.field({
      type: CartType,
      args: { sku: t.arg.string({ required: true }), quantity: t.arg.int({ required: true }) },
      resolve: async (_root, args, ctx) => summarise(ctx.db, await setQuantity(ctx, args.sku, args.quantity)),
    }),
    cartRemove: t.field({ type: CartType, args: { sku: t.arg.string({ required: true }) }, resolve: async (_root, args, ctx) => summarise(ctx.db, await removeItem(ctx, args.sku)) }),
    cartApplyDiscount: t.field({ type: CartType, args: { code: t.arg.string({ required: true }) }, resolve: async (_root, args, ctx) => summarise(ctx.db, await applyDiscount(ctx, args.code)) }),
    cartRemoveDiscount: t.field({ type: CartType, resolve: async (_root, _args, ctx) => summarise(ctx.db, await removeDiscount(ctx)) }),

    checkout: t.field({
      type: OrderType,
      description: "Creates an order awaiting payment and reserves its stock. It does not take payment and never marks the order paid.",
      args: { input: t.arg({ type: CheckoutInput, required: true }) },
      resolve: (_root, args, ctx) => placeOrder(ctx, args.input),
    }),

    startPayment: t.string({
      description: "Returns the provider's hosted payment page URL for an unpaid order. Paying is confirmed only by the provider's signed webhook.",
      args: { number: t.arg.string({ required: true }), token: t.arg.string({ required: true }) },
      resolve: async (_root, args, ctx) => (await startPayment(ctx, args.number, args.token)).url,
    }),

    requestReturn: t.boolean({
      description: "Asks to return a delivered order. Signed-in customers only, for their own orders.",
      args: { number: t.arg.string({ required: true }), reason: t.arg.string({ required: true }) },
      resolve: async (_root, args, ctx) => {
        const customer = requireCustomer(ctx);
        const reason = args.reason.trim();
        if (reason.length < 10 || reason.length > 1000) throw new AppError("BAD_INPUT", "Tell us the reason in 10 to 1000 characters.", "reason");
        const order = await ctx.db.order.findFirst({ where: { number: args.number.trim().toUpperCase(), customerId: customer.id }, include: { items: true, returns: true } });
        if (!order) throw new AppError("NOT_FOUND", "Order not found.");
        if (order.fulfilmentStatus !== "DELIVERED") throw new AppError("BAD_INPUT", "A return can be requested once the order has been delivered.");
        if (order.returns.some((r) => r.status === "REQUESTED" || r.status === "APPROVED")) throw new AppError("BAD_INPUT", "A return is already in progress for this order.");
        await ctx.db.returnRequest.create({ data: { orderId: order.id, reason, items: order.items.map((item) => ({ orderItemId: item.id, quantity: item.quantity })) } });
        await ctx.db.orderEvent.create({ data: { orderId: order.id, kind: "return_requested", message: "Return requested." } });
        return true;
      },
    }),

    toggleFavourite: t.stringList({
      description: "Adds or removes a variant from the signed-in customer's favourites. Returns the resulting SKUs.",
      args: { sku: t.arg.string({ required: true }) },
      resolve: async (_root, args, ctx) => {
        const customer = requireCustomer(ctx);
        const variant = await ctx.db.variant.findUnique({ where: { sku: args.sku }, select: { id: true } });
        if (!variant) throw new AppError("NOT_FOUND", "This product is not available.", "sku");
        const key = { customerId_variantId: { customerId: customer.id, variantId: variant.id } };
        if (await ctx.db.favourite.findUnique({ where: key })) await ctx.db.favourite.delete({ where: key });
        else await ctx.db.favourite.create({ data: { customerId: customer.id, variantId: variant.id } });
        return (await ctx.db.favourite.findMany({ where: { customerId: customer.id }, include: { variant: { select: { sku: true } } } })).map((f) => f.variant.sku);
      },
    }),

    subscribeNewsletter: t.boolean({
      description: "Records a pending subscription. It becomes active only after the address is confirmed by email (double opt-in, Phase 7).",
      args: { email: t.arg.string({ required: true }), locale: t.arg.string() },
      resolve: async (_root, args, ctx) => {
        await enforce(ctx.db, `newsletter:ip:${ctx.ip}`, 10, 3600);
        const email = args.email.trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw new AppError("BAD_INPUT", "Enter a valid email address.", "email");
        // Same answer whether or not the address is already known.
        const subscriber = await ctx.db.newsletterSubscriber.upsert({ where: { email }, update: {}, create: { email, tokenHash: hashToken(newToken()), locale: toLocale(args.locale ?? ctx.locale) } });
        if (subscriber.status === "PENDING") {
          // One confirmation email per address per day, however often the form is submitted.
          const day = new Date().toISOString().slice(0, 10);
          await ctx.db.outboxJob.createMany({ data: [{ kind: "email.newsletter.confirm", dedupeKey: `email.newsletter.confirm:${subscriber.id}:${day}`, payload: { subscriberId: subscriber.id } }], skipDuplicates: true });
        }
        return true;
      },
    }),

    sendContactMessage: t.boolean({
      description: "Queues a message from the contact form for delivery to the shop's inbox.",
      args: { name: t.arg.string({ required: true }), email: t.arg.string({ required: true }), reference: t.arg.string(), message: t.arg.string({ required: true }) },
      resolve: async (_root, args, ctx) => {
        await enforce(ctx.db, `contact:ip:${ctx.ip}`, 5, 3600);
        const name = args.name.trim();
        const email = args.email.trim().toLowerCase();
        const body = args.message.trim();
        if (name.length < 1 || name.length > 120) throw new AppError("BAD_INPUT", "Enter your name.", "name");
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw new AppError("BAD_INPUT", "Enter a valid email address.", "email");
        if (body.length < 10 || body.length > 4000) throw new AppError("BAD_INPUT", "Write a message of 10 to 4000 characters.", "message");
        await ctx.db.outboxJob.create({ data: { kind: "email.contact", dedupeKey: `email.contact:${newToken()}`, payload: { name, email, reference: args.reference?.trim().slice(0, 60) || null, body } } });
        return true;
      },
    }),

    submitReview: t.boolean({
      description: "Only customers with a delivered order containing the product may review it. Reviews are published after moderation.",
      args: { input: t.arg({ type: ReviewInput, required: true }) },
      resolve: async (_root, { input }, ctx) => {
        const customer = requireCustomer(ctx);
        const body = input.body.trim();
        if (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5) throw new AppError("BAD_INPUT", "Rating must be between 1 and 5.", "rating");
        if (body.length < 10 || body.length > 2000) throw new AppError("BAD_INPUT", "Write between 10 and 2000 characters.", "body");
        const product = await getProduct(ctx.db, input.productSlug);
        if (!product) throw new AppError("NOT_FOUND", "This product is not available.", "productSlug");
        const skus = (await ctx.db.variant.findMany({ where: { productId: product.id }, select: { sku: true } })).map((v) => v.sku);
        const order = await ctx.db.order.findFirst({ where: { customerId: customer.id, fulfilmentStatus: "DELIVERED", items: { some: { sku: { in: skus } } } }, select: { id: true } });
        if (!order) throw new AppError("FORBIDDEN", "You can review a product once an order containing it has been delivered.");
        await ctx.db.review.upsert({
          where: { productId_customerId: { productId: product.id, customerId: customer.id } },
          update: { rating: input.rating, title: input.title?.trim().slice(0, 120) ?? "", body, status: "PENDING" },
          create: { productId: product.id, customerId: customer.id, orderId: order.id, rating: input.rating, title: input.title?.trim().slice(0, 120) ?? "", body },
        });
        return true;
      },
    }),
  }),
});

export const storefrontSchema = builder.toSchema();
