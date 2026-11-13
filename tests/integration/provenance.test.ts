import { beforeEach, describe, expect, it } from "vitest";
import { GET as publicCertificate } from "@/app/media/certificate/[id]/route";
import { createServer } from "@/graphql/server";
import { storefrontSchema } from "@/graphql/storefront";
import { saveBatch } from "@/server/admin";
import type { Ctx } from "@/server/context";
import {
  addBatchDocument,
  addLabResult,
  deleteRegion,
  getBatchDetail,
  intelligenceOverview,
  isPdf,
  publicLabResults,
  removeBatchDocument,
  removeLabResult,
  saveProducer,
  saveProductProfile,
  saveRegion,
  saveVariety,
  setDocumentVerified,
  setLabResultVerified,
} from "@/server/provenance";
import { createAdmin, createClient, db, resetDb, seedCatalog } from "../helpers";

const server = createServer(storefrontSchema);
const PDF = new TextEncoder().encode("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF\n");

async function staff(role: "ADMINISTRATOR" | "MANAGER" | "STAFF"): Promise<Ctx> {
  const { email } = await createAdmin(role);
  return { db, ip: "10.9.9.9", userAgent: null, cookies: {}, setCookies: [], customer: null, admin: await db.adminUser.findUniqueOrThrow({ where: { email } }) };
}
const refused = async (promise: Promise<unknown>, expected: string) => expect(await promise.then(() => "resolved", (error: { code?: string }) => error.code)).toBe(expected);
const served = async (id: string) => (await publicCertificate(new Request("http://localhost/"), { params: Promise.resolve({ id }) })).status;

let productId: string;
let manager: Ctx;
let worker: Ctx;

async function lot(isPublished: boolean, lotNumber = "AZ-0001") {
  return saveBatch(manager, null, { lotNumber, productId, harvestYear: "2026", isPublished });
}

beforeEach(async () => {
  await resetDb();
  productId = (await seedCatalog()).product.id;
  manager = await staff("MANAGER");
  worker = await staff("STAFF");
});

describe("origin, producer and varieties", () => {
  it("keeps regions, producers and varieties consistent, and to managers", async () => {
    await refused(saveRegion(worker, null, { countryCode: "GR", name: "Crete" }), "FORBIDDEN");
    const crete = await saveRegion(manager, null, { countryCode: "gr", name: "Crete" });
    expect(crete.countryCode).toBe("GR");
    await refused(saveRegion(manager, null, { countryCode: "GR", name: "crete" }), "BAD_INPUT"); // listed already
    await refused(saveRegion(manager, null, { countryCode: "Greece", name: "Lesbos" }), "BAD_INPUT");

    // A producer takes its country from its region, and cannot contradict it.
    const mill = await saveProducer(manager, null, { name: "Mylos Estate", slug: "mylos-estate", regionId: crete.id, isPublic: true });
    expect(mill.countryCode).toBe("GR");
    await refused(saveProducer(manager, null, { name: "Other", slug: "other", regionId: crete.id, countryCode: "IT" }), "BAD_INPUT");
    await refused(saveProducer(manager, null, { name: "Copy", slug: "mylos-estate" }), "BAD_INPUT");
    await refused(saveProducer(manager, null, { name: "Insecure", slug: "insecure", website: "http://example.com" }), "BAD_INPUT");

    await saveVariety(manager, null, { name: "Koroneiki", slug: "koroneiki" });
    await refused(saveVariety(manager, null, { name: "KORONEIKI", slug: "koroneiki-2" }), "BAD_INPUT");

    await refused(deleteRegion(manager, crete.id), "BAD_INPUT"); // in use by the producer
    const unused = await saveRegion(manager, null, { countryCode: "ES", name: "Jaén" });
    await deleteRegion(manager, unused.id);
    expect(await db.region.count()).toBe(1);
  });

  it("holds a product's profile to what a single variety and a blend mean, and infers nothing", async () => {
    const crete = await saveRegion(manager, null, { countryCode: "GR", name: "Crete" });
    const koroneiki = await saveVariety(manager, null, { name: "Koroneiki", slug: "koroneiki" });
    const picual = await saveVariety(manager, null, { name: "Picual", slug: "picual" });
    const save = (input: object) => saveProductProfile(manager, productId, input);

    await refused(saveProductProfile(worker, productId, {}), "FORBIDDEN");
    await refused(save({ composition: "SINGLE_VARIETY", varieties: [] }), "BAD_INPUT");
    await refused(save({ composition: "SINGLE_VARIETY", varieties: [{ varietyId: koroneiki.id }, { varietyId: picual.id }] }), "BAD_INPUT");
    await refused(save({ composition: "BLEND", varieties: [{ varietyId: koroneiki.id }] }), "BAD_INPUT");
    await refused(save({ composition: "BLEND", varieties: [{ varietyId: koroneiki.id, percent: "70" }, { varietyId: picual.id, percent: "20" }] }), "BAD_INPUT"); // 90, not 100
    await refused(save({ composition: "BLEND", varieties: [{ varietyId: koroneiki.id, percent: "70" }, { varietyId: picual.id }] }), "BAD_INPUT"); // a share for one only
    await refused(save({ varieties: [{ varietyId: koroneiki.id }, { varietyId: koroneiki.id }] }), "BAD_INPUT");
    await refused(save({ varieties: [{ varietyId: "nope" }] }), "BAD_INPUT");
    await refused(save({ regionId: crete.id, originCountry: "IT" }), "BAD_INPUT");
    await refused(save({ bitterness: "9" }), "BAD_INPUT");

    await save({ composition: "BLEND", regionId: crete.id, bitterness: "3", pungency: "", aroma: "Cut grass, green almond.", varieties: [{ varietyId: koroneiki.id, percent: "70" }, { varietyId: picual.id, percent: "30" }] });
    const product = await db.product.findUniqueOrThrow({ where: { id: productId }, include: { varieties: true } });
    expect(product).toMatchObject({ composition: "BLEND", originCountry: "GR", bitterness: 3, pungency: null, aroma: "Cut grass, green almond." });
    expect(product.varieties.map((entry) => entry.percent).sort()).toEqual([30, 70]);
    // Choosing varieties and a region set nothing that was not entered: no taste, no method, and above all no measured value.
    expect(product).toMatchObject({ taste: null, extractionMethod: null, harvestMethod: null, producerId: null });
    expect(await db.labResult.count()).toBe(0);

    // Saving again replaces the list of varieties instead of adding to it.
    await save({ composition: "SINGLE_VARIETY", varieties: [{ varietyId: picual.id }] });
    expect(await db.productVariety.count({ where: { productId } })).toBe(1);
  });
});

describe("laboratory results", () => {
  it("reach customers only when verified against a verified certificate, on a published lot", async () => {
    const batch = await lot(true);
    const shown = async () => ((await publicLabResults(db, [batch.id])).get(batch.id) ?? []).map((result) => [result.measure, result.value, result.unit]);

    const documentId = await addBatchDocument(worker, batch.id, { data: PDF, title: "Analysis report, March 2026", kind: "ANALYSIS" });
    const polyphenols = await addLabResult(worker, batch.id, { measure: "polyphenols", value: "612", method: "HPLC (IOC)", laboratory: "Example Lab", testedAt: "2026-03-02", documentId });
    const acidity = await addLabResult(worker, batch.id, { measure: "free_acidity", value: "0,21", laboratory: "Example Lab", testedAt: "2026-03-02", documentId });
    expect(await shown()).toEqual([]); // entered is not verified

    await refused(setLabResultVerified(worker, polyphenols, true), "FORBIDDEN"); // the person who types is not the person who verifies
    await refused(setLabResultVerified(manager, polyphenols, true), "BAD_INPUT"); // the certificate itself is not verified yet
    await setDocumentVerified(manager, documentId, true);
    await setLabResultVerified(manager, polyphenols, true);
    expect(await shown()).toEqual([["polyphenols", 612, "mg/kg"]]);
    await setLabResultVerified(manager, acidity, true);
    expect(await shown()).toEqual([["polyphenols", 612, "mg/kg"], ["free_acidity", 0.21, "% oleic acid"]]); // listed in a fixed order

    // The lot lookup on the site gives the same answer, and nothing more.
    const found = await createClient(server).gql<{ lot: { labResults: { measure: string; value: number; laboratory: string }[]; documents: { title: string; url: string }[] } }>(`{ lot(lotNumber: "AZ-0001") { labResults { measure value laboratory } documents { title url } } }`);
    expect(found.data?.lot.labResults).toEqual([{ measure: "polyphenols", value: 612, laboratory: "Example Lab" }, { measure: "free_acidity", value: 0.21, laboratory: "Example Lab" }]);
    expect(found.data?.lot.documents).toEqual([{ title: "Analysis report, March 2026", url: `/media/certificate/${documentId}` }]);

    // Withdrawing a verification, or the certificate, takes the value off the shop at once.
    await setLabResultVerified(manager, acidity, false);
    expect((await shown()).map(([measure]) => measure)).toEqual(["polyphenols"]);
    await removeBatchDocument(manager, documentId);
    expect(await shown()).toEqual([]);
    expect((await db.labResult.findUniqueOrThrow({ where: { id: polyphenols } })).verifiedAt).toBeNull(); // kept, but its evidence is gone

    const actions = (await db.auditLog.findMany({ where: { action: { startsWith: "lab." } }, orderBy: { createdAt: "asc" } })).map((log) => log.action);
    expect(actions).toEqual(["lab.result.add", "lab.result.add", "lab.result.verify", "lab.result.verify", "lab.result.unverify"]);
  });

  it("hides even verified results while the lot is a draft", async () => {
    const batch = await lot(false);
    const documentId = await addBatchDocument(worker, batch.id, { data: PDF, title: "Report", kind: "ANALYSIS" });
    const result = await addLabResult(worker, batch.id, { measure: "peroxide", value: "6.4", laboratory: "Example Lab", testedAt: "2026-03-02", documentId });
    await setDocumentVerified(manager, documentId, true);
    await setLabResultVerified(manager, result, true);
    expect((await publicLabResults(db, [batch.id])).size).toBe(0);
    expect(await served(documentId)).toBe(404);
    await saveBatch(manager, batch.id, { lotNumber: "AZ-0001", productId, harvestYear: "2026", isPublished: true });
    expect((await publicLabResults(db, [batch.id])).get(batch.id)).toHaveLength(1);
    expect(await served(documentId)).toBe(200);
  });

  it("will not verify a number without a laboratory, a date and a certificate", async () => {
    const batch = await lot(true);
    const documentId = await addBatchDocument(worker, batch.id, { data: PDF, title: "Report", kind: "ANALYSIS" });
    await setDocumentVerified(manager, documentId, true);
    const bare = await addLabResult(worker, batch.id, { measure: "polyphenols", value: "500" });
    const undated = await addLabResult(worker, batch.id, { measure: "polyphenols", value: "500", laboratory: "Example Lab", documentId });
    const unattached = await addLabResult(worker, batch.id, { measure: "polyphenols", value: "500", laboratory: "Example Lab", testedAt: "2026-03-02" });
    for (const id of [bare, undated, unattached]) await refused(setLabResultVerified(manager, id, true), "BAD_INPUT");
    expect((await publicLabResults(db, [batch.id])).size).toBe(0);
    await refused(removeLabResult(worker, bare), "FORBIDDEN");
    await removeLabResult(manager, bare);
    expect((await getBatchDetail(manager, batch.id)).labResults).toHaveLength(2);
  });

  it("rejects implausible and malformed values instead of storing them", async () => {
    const batch = await lot(true);
    const other = await lot(true, "AZ-0002");
    const foreign = await addBatchDocument(worker, other.id, { data: PDF, title: "Other lot's report", kind: "ANALYSIS" });
    const add = (input: object) => addLabResult(worker, batch.id, input);
    await refused(add({ measure: "free_acidity", value: "21" }), "BAD_INPUT"); // 0.21 with a slipped decimal point
    await refused(add({ measure: "polyphenols", value: "60000" }), "BAD_INPUT");
    await refused(add({ measure: "polyphenols", value: "high" }), "BAD_INPUT");
    await refused(add({ measure: "polyphenols", value: "-5" }), "BAD_INPUT");
    await refused(add({ measure: "antioxidants", value: "5" }), "BAD_INPUT"); // not a measure this shop reports
    await refused(add({ measure: "other", value: "5" }), "BAD_INPUT"); // unnamed
    await refused(add({ measure: "polyphenols", value: "500", testedAt: "2999-01-01" }), "BAD_INPUT");
    await refused(add({ measure: "polyphenols", value: "500", documentId: foreign }), "BAD_INPUT"); // another lot's certificate
    await refused(addLabResult({ ...worker, admin: null }, batch.id, { measure: "polyphenols", value: "500" }), "UNAUTHENTICATED");
    expect(await db.labResult.count()).toBe(0);

    await add({ measure: "other", label: "Squalene", unit: "mg/kg", value: "4200" });
    await add({ measure: "polyphenols", value: "500", unit: "g/l" }); // the unit of a known measure is fixed, whatever is sent
    expect((await db.labResult.findMany({ orderBy: { createdAt: "asc" } })).map((result) => [result.measure, result.label, result.unit])).toEqual([["other", "Squalene", "mg/kg"], ["polyphenols", null, "mg/kg"]]);
  });
});

describe("certificates", () => {
  it("accepts only real PDFs of a sensible size", async () => {
    const batch = await lot(true);
    const upload = (file: { data: Uint8Array; title?: string; kind?: string }) => addBatchDocument(worker, batch.id, { title: "Report", kind: "ANALYSIS", ...file });
    expect(isPdf(PDF)).toBe(true);
    await refused(upload({ data: new TextEncoder().encode("<html><script>alert(1)</script></html>") }), "BAD_INPUT"); // a web page named .pdf
    await refused(upload({ data: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]) }), "BAD_INPUT"); // a photo
    await refused(upload({ data: new Uint8Array() }), "BAD_INPUT");
    await refused(upload({ data: new Uint8Array(4 * 1024 * 1024 + 1).fill(0x25) }), "BAD_INPUT");
    await refused(upload({ data: PDF, title: "  " }), "BAD_INPUT");
    await refused(upload({ data: PDF, kind: "SELFIE" }), "BAD_INPUT");
    await refused(addBatchDocument(worker, "missing", { data: PDF, title: "Report", kind: "ANALYSIS" }), "NOT_FOUND");
    expect(await db.batchDocument.count()).toBe(0);
  });

  it("serves a certificate to the public only once verified, and stops when that is withdrawn or the product is hidden", async () => {
    const batch = await lot(true);
    const documentId = await addBatchDocument(worker, batch.id, { data: PDF, title: "Report", kind: "ANALYSIS" });
    expect(await served(documentId)).toBe(404);
    await refused(setDocumentVerified(worker, documentId, true), "FORBIDDEN");
    await setDocumentVerified(manager, documentId, true);

    const response = await publicCertificate(new Request("http://localhost/"), { params: Promise.resolve({ id: documentId }) });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(PDF);

    await db.product.update({ where: { id: productId }, data: { isVisible: false } });
    expect(await served(documentId)).toBe(404);
    await db.product.update({ where: { id: productId }, data: { isVisible: true } });
    await setDocumentVerified(manager, documentId, false);
    expect(await served(documentId)).toBe(404);
    expect(await served("../../etc/passwd")).toBe(404);
  });
});

describe("the list of what is missing", () => {
  it("names each gap per lot and per product", async () => {
    const batch = await lot(true);
    await saveBatch(manager, null, { lotNumber: "AZ-0002", productId, isPublished: false });
    const before = await intelligenceOverview(worker);
    expect(before.lots.find((entry) => entry.lotNumber === "AZ-0001")?.missing).toEqual(["verified analysis certificate", "verified polyphenols", "verified free acidity", "verified peroxide value"]);
    expect(before.lots.find((entry) => entry.lotNumber === "AZ-0002")?.missing[0]).toBe("harvest year");
    expect(before.incomplete.find((entry) => entry.id === productId)?.missing).toEqual(["country of origin", "region", "producer", "olive variety", "single variety or blend", "tasting notes"]);
    expect(before.lotsComplete).toBe(0);

    const documentId = await addBatchDocument(worker, batch.id, { data: PDF, title: "Report", kind: "ANALYSIS" });
    await setDocumentVerified(manager, documentId, true);
    for (const [measure, value] of [["polyphenols", "612"], ["free_acidity", "0.21"], ["peroxide", "6.4"]]) {
      await setLabResultVerified(manager, await addLabResult(worker, batch.id, { measure, value, laboratory: "Example Lab", testedAt: "2026-03-02", documentId }), true);
    }
    await addLabResult(worker, batch.id, { measure: "k232", value: "1.8" });
    const after = await intelligenceOverview(worker);
    expect(after.lots.find((entry) => entry.lotNumber === "AZ-0001")).toMatchObject({ missing: [], verifiedResults: 3, waiting: 1 });
    expect(after).toMatchObject({ lotsComplete: 1, waiting: 1 });
  });
});
