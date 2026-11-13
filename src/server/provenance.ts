import { z } from "zod";
import { requireAdmin } from "./auth";
import type { Ctx } from "./context";
import type { Db } from "./db";
import { AppError, parse } from "./errors";

/**
 * Product intelligence: where an oil comes from, who made it, what it is
 * made of, how it tastes, and what a laboratory measured in each batch.
 *
 * Two rules run through this file.
 *
 * 1. Nothing is assumed. A variety, an origin or a measured value exists only
 *    if a person entered it. Empty means "not recorded" and is shown to
 *    customers as a dash, never as a typical or expected value.
 *
 * 2. A measured value reaches customers only when a second step has
 *    confirmed it against the laboratory's own certificate (verification),
 *    and only for a published batch. A value is never edited afterwards: a
 *    wrong one is deleted and entered again.
 *
 * No health or nutrition claim is derived from any value here. Whether a
 * claim may be made about a measured polyphenol content is a legal question
 * for a food-law adviser, not something the software decides.
 */

// ───────────────────────────── Measures ─────────────────────────────

/**
 * The measures a laboratory report for olive oil usually carries. The unit is
 * fixed per measure so two batches can be compared; `max` is a plausibility
 * ceiling that catches a slipped decimal point, not a quality limit.
 */
export const MEASURES = {
  polyphenols: { label: "Total polyphenols", unit: "mg/kg", max: 5000, decimals: 0 },
  hydroxytyrosol: { label: "Hydroxytyrosol and derivatives", unit: "mg/kg", max: 5000, decimals: 0 },
  free_acidity: { label: "Free acidity", unit: "% oleic acid", max: 10, decimals: 2 },
  peroxide: { label: "Peroxide value", unit: "meq O₂/kg", max: 100, decimals: 1 },
  k232: { label: "K232", unit: "", max: 10, decimals: 3 },
  k270: { label: "K270", unit: "", max: 5, decimals: 3 },
  delta_k: { label: "ΔK", unit: "", max: 1, decimals: 3 },
  oleic_acid: { label: "Oleic acid", unit: "%", max: 100, decimals: 1 },
} as const;
export type MeasureKey = keyof typeof MEASURES;
export const MEASURE_KEYS = Object.keys(MEASURES) as MeasureKey[];
export const isMeasure = (value: string): value is MeasureKey => Object.hasOwn(MEASURES, value);

export const measureLabel = (result: { measure: string; label: string | null }) => (isMeasure(result.measure) ? MEASURES[result.measure].label : (result.label ?? result.measure));

const audit = (ctx: Ctx, action: string, entity: string, entityId: string, data?: object) => ctx.db.auditLog.create({ data: { actorType: "admin", actorId: ctx.admin?.id ?? null, action, entity, entityId, data, ip: ctx.ip } });

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => (value ? value : null));
const slug = z.string().trim().toLowerCase().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, numbers and hyphens.").max(120);
const country = z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, "Enter the country as a two-letter code, such as GR.");
const optionalCountry = z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, "Enter the country as a two-letter code, such as GR.").nullish().or(z.literal("")).transform((value) => value || null);
const reference = z.string().nullish().transform((value) => value || null);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the date as YYYY-MM-DD.").nullish().or(z.literal("")).transform((value) => (value ? new Date(`${value}T00:00:00Z`) : null));

// ───────────────────────────── Regions ─────────────────────────────

export async function listRegions(ctx: Ctx) {
  requireAdmin(ctx, "VIEW", "catalog");
  return ctx.db.region.findMany({ orderBy: [{ countryCode: "asc" }, { name: "asc" }], include: { _count: { select: { products: true, producers: true } } } });
}

export async function saveRegion(ctx: Ctx, id: string | null, input: unknown) {
  requireAdmin(ctx, "MANAGER", "catalog");
  const data = parse(z.object({ countryCode: country, name: z.string().trim().min(1, "Enter the region's name.").max(120) }), input);
  const clash = await ctx.db.region.findFirst({ where: { countryCode: data.countryCode, name: { equals: data.name, mode: "insensitive" }, NOT: id ? { id } : undefined }, select: { id: true } });
  if (clash) throw new AppError("BAD_INPUT", "That region is already listed for this country.", "name");
  const region = id ? await ctx.db.region.update({ where: { id }, data }) : await ctx.db.region.create({ data });
  await audit(ctx, id ? "region.update" : "region.create", "Region", region.id, data);
  return region;
}

/** A region in use cannot be removed: products and producers would silently lose their origin. */
export async function deleteRegion(ctx: Ctx, id: string) {
  requireAdmin(ctx, "MANAGER", "catalog");
  const region = await ctx.db.region.findUnique({ where: { id }, include: { _count: { select: { products: true, producers: true } } } });
  if (!region) throw new AppError("NOT_FOUND", "Region not found.");
  if (region._count.products + region._count.producers > 0) throw new AppError("BAD_INPUT", "This region is used by a product or producer. Change those first.");
  await ctx.db.region.delete({ where: { id } });
  await audit(ctx, "region.delete", "Region", id, { name: region.name, countryCode: region.countryCode });
}

// ───────────────────────────── Producers ─────────────────────────────

const producerInput = z.object({
  name: z.string().trim().min(1, "Enter the producer's name.").max(160),
  slug,
  countryCode: optionalCountry,
  regionId: reference,
  town: text(120),
  description: z.string().trim().max(4000).default(""),
  website: z.string().trim().max(300).regex(/^https:\/\/[^\s]+$/, "Start the website with https://").nullish().or(z.literal("")).transform((value) => value || null),
  isPublic: z.boolean().default(false),
});

export async function listProducers(ctx: Ctx) {
  requireAdmin(ctx, "VIEW", "catalog");
  return ctx.db.producer.findMany({ orderBy: { name: "asc" }, include: { region: true, _count: { select: { products: true, batches: true } } } });
}

export async function saveProducer(ctx: Ctx, id: string | null, input: unknown) {
  requireAdmin(ctx, "MANAGER", "catalog");
  const data = parse(producerInput, input);
  const clash = await ctx.db.producer.findFirst({ where: { slug: data.slug, NOT: id ? { id } : undefined }, select: { id: true } });
  if (clash) throw new AppError("BAD_INPUT", "Another producer already uses this address name.", "slug");
  if (data.regionId) {
    const region = await ctx.db.region.findUnique({ where: { id: data.regionId } });
    if (!region) throw new AppError("BAD_INPUT", "Choose a region from the list.", "regionId");
    // A producer cannot be in a region of another country than the one stated.
    if (data.countryCode && data.countryCode !== region.countryCode) throw new AppError("BAD_INPUT", `${region.name} is in ${region.countryCode}, not ${data.countryCode}.`, "regionId");
    data.countryCode = region.countryCode;
  }
  const producer = id ? await ctx.db.producer.update({ where: { id }, data }) : await ctx.db.producer.create({ data });
  await audit(ctx, id ? "producer.update" : "producer.create", "Producer", producer.id, { name: data.name, isPublic: data.isPublic });
  return producer;
}

// ───────────────────────────── Olive varieties ─────────────────────────────

export async function listVarieties(ctx: Ctx) {
  requireAdmin(ctx, "VIEW", "catalog");
  return ctx.db.oliveVariety.findMany({ orderBy: { name: "asc" }, include: { _count: { select: { products: true } } } });
}

export async function saveVariety(ctx: Ctx, id: string | null, input: unknown) {
  requireAdmin(ctx, "MANAGER", "catalog");
  const data = parse(z.object({ name: z.string().trim().min(1, "Enter the variety's name.").max(120), slug, description: z.string().trim().max(2000).default("") }), input);
  const clash = await ctx.db.oliveVariety.findFirst({ where: { OR: [{ slug: data.slug }, { name: { equals: data.name, mode: "insensitive" } }], NOT: id ? { id } : undefined }, select: { id: true } });
  if (clash) throw new AppError("BAD_INPUT", "That variety is already listed.", "name");
  const variety = id ? await ctx.db.oliveVariety.update({ where: { id }, data }) : await ctx.db.oliveVariety.create({ data });
  await audit(ctx, id ? "variety.update" : "variety.create", "OliveVariety", variety.id, { name: data.name });
  return variety;
}

// ───────────────────────────── Product profile ─────────────────────────────

/** An optional whole number from a form: empty, missing and null all mean "not recorded". */
const optionalInt = (min: number, max: number, message: string) =>
  z
    .union([z.literal(""), z.null(), z.coerce.number().int().min(min, message).max(max, message)])
    .optional()
    .transform((value) => (typeof value === "number" ? value : null));
const intensity = optionalInt(0, 5, "Use 0 to 5.");

const profileInput = z.object({
  originCountry: optionalCountry,
  regionId: reference,
  producerId: reference,
  composition: z.enum(["SINGLE_VARIETY", "BLEND"]).nullish().or(z.literal("")).transform((value) => value || null),
  extractionMethod: text(300),
  harvestMethod: text(300),
  aroma: text(600),
  taste: text(600),
  bitterness: intensity,
  pungency: intensity,
  pairings: text(600),
  packaging: text(300),
  varieties: z.array(z.object({ varietyId: z.string().min(1), percent: optionalInt(1, 100, "Give each share as a whole number from 1 to 100.") })).max(12).default([]),
});

export async function getProductProfile(ctx: Ctx, productId: string) {
  requireAdmin(ctx, "VIEW", "catalog");
  const [product, regions, producers, varieties] = await Promise.all([
    ctx.db.product.findFirst({ where: { id: productId, deletedAt: null }, include: { varieties: { include: { variety: true } } } }),
    ctx.db.region.findMany({ orderBy: [{ countryCode: "asc" }, { name: "asc" }] }),
    ctx.db.producer.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, isPublic: true } }),
    ctx.db.oliveVariety.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  if (!product) throw new AppError("NOT_FOUND", "Product not found.");
  return { product, regions, producers, varieties };
}

/**
 * Saves where a product comes from, what it is made of and how it tastes.
 * A "single variety" must name exactly one variety and a blend at least two;
 * shares, where given, must be given for every variety and add up to 100.
 * Nothing is inferred: choosing a variety sets no origin, taste or lab value.
 */
export async function saveProductProfile(ctx: Ctx, productId: string, input: unknown) {
  requireAdmin(ctx, "MANAGER", "catalog");
  const { varieties, ...data } = parse(profileInput, input);
  const product = await ctx.db.product.findFirst({ where: { id: productId, deletedAt: null }, select: { id: true } });
  if (!product) throw new AppError("NOT_FOUND", "Product not found.");

  const ids = varieties.map((entry) => entry.varietyId);
  if (new Set(ids).size !== ids.length) throw new AppError("BAD_INPUT", "The same variety is listed twice.", "varieties");
  if ((await ctx.db.oliveVariety.count({ where: { id: { in: ids } } })) !== ids.length) throw new AppError("BAD_INPUT", "Choose varieties from the list.", "varieties");
  if (data.composition === "SINGLE_VARIETY" && ids.length !== 1) throw new AppError("BAD_INPUT", "A single-variety oil has exactly one variety. Choose one, or mark the oil as a blend.", "varieties");
  if (data.composition === "BLEND" && ids.length < 2) throw new AppError("BAD_INPUT", "A blend has at least two varieties.", "varieties");
  const shares = varieties.filter((entry) => entry.percent !== null);
  if (shares.length > 0 && (shares.length !== varieties.length || shares.reduce((sum, entry) => sum + (entry.percent ?? 0), 0) !== 100)) throw new AppError("BAD_INPUT", "Give a share for every variety, adding up to 100, or leave all shares empty.", "varieties");

  if (data.regionId) {
    const region = await ctx.db.region.findUnique({ where: { id: data.regionId } });
    if (!region) throw new AppError("BAD_INPUT", "Choose a region from the list.", "regionId");
    if (data.originCountry && data.originCountry !== region.countryCode) throw new AppError("BAD_INPUT", `${region.name} is in ${region.countryCode}, not ${data.originCountry}.`, "regionId");
    data.originCountry = region.countryCode;
  }
  if (data.producerId && !(await ctx.db.producer.findUnique({ where: { id: data.producerId }, select: { id: true } }))) throw new AppError("BAD_INPUT", "Choose a producer from the list.", "producerId");

  await ctx.db.$transaction([
    ctx.db.product.update({ where: { id: productId }, data }),
    ctx.db.productVariety.deleteMany({ where: { productId } }),
    ctx.db.productVariety.createMany({ data: varieties.map((entry) => ({ productId, varietyId: entry.varietyId, percent: entry.percent })) }),
  ]);
  await audit(ctx, "product.profile", "Product", productId, { composition: data.composition, varieties: ids.length, originCountry: data.originCountry });
}

// ───────────────────────────── Batch documents (certificates) ─────────────────────────────

export const CERTIFICATE_MAX_BYTES = 4 * 1024 * 1024;
const DOCUMENT_KINDS = ["ANALYSIS", "CERTIFICATION", "AWARD", "OTHER"] as const;
export const DOCUMENT_KIND_LABEL: Record<(typeof DOCUMENT_KINDS)[number], string> = { ANALYSIS: "Laboratory analysis", CERTIFICATION: "Certification", AWARD: "Award", OTHER: "Other document" };

/** True for a PDF, read from its first bytes. The file name and the browser's claim are not trusted. */
export const isPdf = (data: Uint8Array) => data.length > 5 && String.fromCharCode(...data.slice(0, 5)) === "%PDF-";

/** Stores a document for a batch. PDF only, up to 4 MB. It is not shown to customers until verified. */
export async function addBatchDocument(ctx: Ctx, batchId: string, file: { data: Uint8Array; title: string; kind: string }) {
  const admin = requireAdmin(ctx, "STAFF", "traceability");
  const kind = DOCUMENT_KINDS.find((value) => value === file.kind);
  if (!kind) throw new AppError("BAD_INPUT", "Choose what kind of document this is.", "kind");
  const title = file.title.trim().slice(0, 200);
  if (!title) throw new AppError("BAD_INPUT", "Give the document a title customers will understand, such as “Analysis report, March 2026”.", "title");
  if (file.data.length === 0) throw new AppError("BAD_INPUT", "Choose a PDF to upload.");
  if (file.data.length > CERTIFICATE_MAX_BYTES) throw new AppError("BAD_INPUT", "That file is larger than 4 MB.");
  if (!isPdf(file.data)) throw new AppError("BAD_INPUT", "Upload the document as a PDF.");
  if (!(await ctx.db.batch.findUnique({ where: { id: batchId }, select: { id: true } }))) throw new AppError("NOT_FOUND", "Lot not found.");
  const created = await ctx.db.batchDocument.create({ data: { batchId, kind, title, url: "", data: new Uint8Array(file.data), mime: "application/pdf", bytes: file.data.length, uploadedById: admin.id } });
  await ctx.db.batchDocument.update({ where: { id: created.id }, data: { url: `/media/certificate/${created.id}` } });
  await audit(ctx, "batch.document.add", "Batch", batchId, { documentId: created.id, kind, bytes: file.data.length });
  return created.id;
}

/** Confirms a document is what its title says. Only then can customers open it. */
export async function setDocumentVerified(ctx: Ctx, documentId: string, verified: boolean) {
  const admin = requireAdmin(ctx, "MANAGER", "traceability");
  const document = await ctx.db.batchDocument.update({ where: { id: documentId }, data: { verifiedAt: verified ? new Date() : null, verifiedById: verified ? admin.id : null } }).catch(() => null);
  if (!document) throw new AppError("NOT_FOUND", "Document not found.");
  await audit(ctx, verified ? "batch.document.verify" : "batch.document.unverify", "Batch", document.batchId, { documentId });
  return document.batchId;
}

/** Removes a document. Results read from it stay, but lose their verification: their evidence is gone. */
export async function removeBatchDocument(ctx: Ctx, documentId: string) {
  requireAdmin(ctx, "MANAGER", "traceability");
  const document = await ctx.db.batchDocument.findUnique({ where: { id: documentId }, select: { batchId: true, title: true } });
  if (!document) throw new AppError("NOT_FOUND", "Document not found.");
  await ctx.db.$transaction([ctx.db.labResult.updateMany({ where: { documentId }, data: { verifiedAt: null, verifiedById: null } }), ctx.db.batchDocument.delete({ where: { id: documentId } })]);
  await audit(ctx, "batch.document.remove", "Batch", document.batchId, { documentId, title: document.title });
  return document.batchId;
}

/** The file itself, for staff (any document) or for the public (verified, on a published batch of a visible product). */
export async function readDocument(db: Db, documentId: string, audience: "staff" | "public") {
  const document = await db.batchDocument.findFirst({
    where: { id: documentId, data: { not: null }, ...(audience === "public" ? { NOT: { verifiedAt: null }, batch: { isPublished: true, product: { isVisible: true, deletedAt: null } } } : {}) },
    select: { data: true, mime: true, title: true },
  });
  return document?.data && document.mime ? { data: document.data, mime: document.mime, title: document.title } : null;
}

// ───────────────────────────── Laboratory results ─────────────────────────────

const resultInput = z.object({
  measure: z.string().trim().min(1, "Choose what was measured."),
  label: text(80),
  value: z.string().trim().regex(/^\d{1,7}([.,]\d{1,4})?$/, "Enter the value as a number, such as 412 or 0.21."),
  unit: text(30),
  method: text(160),
  laboratory: text(160),
  testedAt: day,
  documentId: reference,
  note: text(500),
});

/**
 * Records one measured value for a batch. Day-to-day staff may enter it;
 * it stays invisible to customers until a manager verifies it.
 */
export async function addLabResult(ctx: Ctx, batchId: string, input: unknown) {
  const admin = requireAdmin(ctx, "STAFF", "traceability");
  const data = parse(resultInput, input);
  const value = Number(data.value.replace(",", "."));
  let unit: string;
  if (isMeasure(data.measure)) {
    const spec = MEASURES[data.measure];
    if (value > spec.max) throw new AppError("BAD_INPUT", `${spec.label} of ${value} ${spec.unit} is not plausible. Check the decimal point and the unit (${spec.unit || "no unit"}).`, "value");
    unit = spec.unit;
    data.label = null;
  } else {
    if (data.measure !== "other") throw new AppError("BAD_INPUT", "Choose what was measured.", "measure");
    if (!data.label) throw new AppError("BAD_INPUT", "Name what was measured.", "label");
    unit = data.unit ?? "";
  }
  if (data.testedAt && data.testedAt > new Date()) throw new AppError("BAD_INPUT", "The test date is in the future.", "testedAt");
  if (!(await ctx.db.batch.findUnique({ where: { id: batchId }, select: { id: true } }))) throw new AppError("NOT_FOUND", "Lot not found.");
  if (data.documentId && !(await ctx.db.batchDocument.findFirst({ where: { id: data.documentId, batchId }, select: { id: true } }))) throw new AppError("BAD_INPUT", "Choose a document that belongs to this lot.", "documentId");

  const result = await ctx.db.labResult.create({ data: { batchId, measure: data.measure, label: data.label, value, unit, method: data.method, laboratory: data.laboratory, testedAt: data.testedAt, documentId: data.documentId, note: data.note, createdById: admin.id } });
  await audit(ctx, "lab.result.add", "Batch", batchId, { resultId: result.id, measure: data.measure, value, unit });
  return result.id;
}

/**
 * Confirms a value against the laboratory's certificate. It needs the
 * laboratory's name, the test date and a verified certificate on file for the
 * same lot: a number with no source is not a verified number.
 */
export async function setLabResultVerified(ctx: Ctx, resultId: string, verified: boolean) {
  const admin = requireAdmin(ctx, "MANAGER", "traceability");
  const result = await ctx.db.labResult.findUnique({ where: { id: resultId }, include: { document: { select: { verifiedAt: true } } } });
  if (!result) throw new AppError("NOT_FOUND", "Result not found.");
  if (verified) {
    if (!result.laboratory || !result.testedAt) throw new AppError("BAD_INPUT", "A result can be verified only with the laboratory's name and the test date. Delete it and enter it again with both.");
    if (!result.document) throw new AppError("BAD_INPUT", "Attach the laboratory's certificate to this result before verifying it. Delete the result and enter it again, choosing the certificate.");
    if (!result.document.verifiedAt) throw new AppError("BAD_INPUT", "Verify the certificate first, then the values read from it.");
  }
  await ctx.db.labResult.update({ where: { id: resultId }, data: { verifiedAt: verified ? new Date() : null, verifiedById: verified ? admin.id : null } });
  await audit(ctx, verified ? "lab.result.verify" : "lab.result.unverify", "Batch", result.batchId, { resultId, measure: result.measure, value: Number(result.value) });
  return result.batchId;
}

export async function removeLabResult(ctx: Ctx, resultId: string) {
  requireAdmin(ctx, "MANAGER", "traceability");
  const result = await ctx.db.labResult.delete({ where: { id: resultId } }).catch(() => null);
  if (!result) throw new AppError("NOT_FOUND", "Result not found.");
  await audit(ctx, "lab.result.remove", "Batch", result.batchId, { resultId, measure: result.measure, value: Number(result.value), wasVerified: !!result.verifiedAt });
  return result.batchId;
}

/** Everything recorded for one lot, for the staff screen. */
export async function getBatchDetail(ctx: Ctx, batchId: string) {
  requireAdmin(ctx, "VIEW", "traceability");
  const batch = await ctx.db.batch.findUnique({
    where: { id: batchId },
    include: {
      product: { select: { id: true, name: true, slug: true } },
      producer: { select: { name: true } },
      documents: { orderBy: { createdAt: "asc" }, select: { id: true, kind: true, title: true, url: true, bytes: true, verifiedAt: true, verifiedById: true, uploadedById: true, createdAt: true } },
      labResults: { orderBy: [{ measure: "asc" }, { createdAt: "asc" }] },
    },
  });
  if (!batch) throw new AppError("NOT_FOUND", "Lot not found.");
  const ids = [...new Set([...batch.documents.flatMap((document) => [document.verifiedById, document.uploadedById]), ...batch.labResults.flatMap((result) => [result.verifiedById, result.createdById])].filter((id): id is string => !!id))];
  const staff = new Map((await ctx.db.adminUser.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })).map((user) => [user.id, user.name]));
  const who = (id: string | null) => (id ? (staff.get(id) ?? "Former staff") : "—");
  return {
    ...batch,
    documents: batch.documents.map((document) => ({ ...document, uploadedBy: who(document.uploadedById), verifiedBy: who(document.verifiedById) })),
    labResults: batch.labResults.map((result) => ({ ...result, value: Number(result.value), name: measureLabel(result), enteredBy: who(result.createdById), verifiedBy: who(result.verifiedById) })),
  };
}

/**
 * What is missing, across the range: batches without a verified polyphenol
 * or acidity value or without a verified analysis certificate, and products
 * without an origin, producer or variety. This is the list staff work down.
 */
export async function intelligenceOverview(ctx: Ctx) {
  requireAdmin(ctx, "VIEW", "traceability");
  const [batches, products] = await Promise.all([
    ctx.db.batch.findMany({
      orderBy: { createdAt: "desc" },
      take: 200,
      include: { product: { select: { name: true } }, documents: { select: { kind: true, verifiedAt: true } }, labResults: { select: { measure: true, verifiedAt: true } } },
    }),
    ctx.db.product.findMany({ where: { deletedAt: null }, orderBy: { name: "asc" }, select: { id: true, name: true, isVisible: true, originCountry: true, regionId: true, producerId: true, composition: true, aroma: true, taste: true, _count: { select: { varieties: true } } } }),
  ]);
  const lots = batches.map((batch) => {
    const verified = new Set(batch.labResults.filter((result) => result.verifiedAt).map((result) => result.measure));
    const missing = [
      ...(batch.harvestYear ? [] : ["harvest year"]),
      ...(batch.documents.some((document) => document.kind === "ANALYSIS" && document.verifiedAt) ? [] : ["verified analysis certificate"]),
      ...(verified.has("polyphenols") ? [] : ["verified polyphenols"]),
      ...(verified.has("free_acidity") ? [] : ["verified free acidity"]),
      ...(verified.has("peroxide") ? [] : ["verified peroxide value"]),
    ];
    return { id: batch.id, lotNumber: batch.lotNumber, product: batch.product.name, isPublished: batch.isPublished, harvestYear: batch.harvestYear, results: batch.labResults.length, verifiedResults: batch.labResults.filter((result) => result.verifiedAt).length, waiting: batch.labResults.filter((result) => !result.verifiedAt).length, missing };
  });
  const incomplete = products
    .map((product) => ({
      id: product.id,
      name: product.name,
      isVisible: product.isVisible,
      missing: [...(product.originCountry ? [] : ["country of origin"]), ...(product.regionId ? [] : ["region"]), ...(product.producerId ? [] : ["producer"]), ...(product._count.varieties ? [] : ["olive variety"]), ...(product.composition ? [] : ["single variety or blend"]), ...(product.aroma || product.taste ? [] : ["tasting notes"])],
    }))
    .filter((product) => product.missing.length > 0);
  return { lots, incomplete, waiting: lots.reduce((sum, lot) => sum + lot.waiting, 0), lotsComplete: lots.filter((lot) => lot.missing.length === 0).length };
}

// ───────────────────────────── What customers may see ─────────────────────────────

export type PublicLabResult = { measure: string; label: string; value: number; unit: string; decimals: number; method: string | null; laboratory: string | null; testedAt: Date | null; certificateUrl: string | null };

/** Verified results of the given published batches, by batch id. Unverified values and unpublished batches never leave the server. */
export async function publicLabResults(db: Db, batchIds: string[]): Promise<Map<string, PublicLabResult[]>> {
  if (batchIds.length === 0) return new Map();
  const rows = await db.labResult.findMany({
    where: { batchId: { in: batchIds }, NOT: { verifiedAt: null }, batch: { isPublished: true } },
    orderBy: [{ measure: "asc" }, { testedAt: "desc" }],
    include: { document: { select: { url: true, verifiedAt: true, bytes: true } } },
  });
  const order = (measure: string) => (isMeasure(measure) ? MEASURE_KEYS.indexOf(measure) : MEASURE_KEYS.length);
  const out = new Map<string, PublicLabResult[]>();
  for (const row of rows.sort((a, b) => order(a.measure) - order(b.measure))) {
    const list = out.get(row.batchId) ?? [];
    list.push({
      measure: row.measure,
      label: measureLabel(row),
      value: Number(row.value),
      unit: row.unit,
      decimals: isMeasure(row.measure) ? MEASURES[row.measure].decimals : 2,
      method: row.method,
      laboratory: row.laboratory,
      testedAt: row.testedAt,
      certificateUrl: row.document?.verifiedAt && row.document.bytes ? row.document.url : null,
    });
    out.set(row.batchId, list);
  }
  return out;
}
