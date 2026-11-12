import { CarrierError, type BookedShipment, type CarrierTransport, type Env, type Party, type ShipmentRequest, type ShippingCarrier, type Tracking, basicAuth, carrierCall } from "./carriers";

/**
 * bpost — Shipping Manager API v5 (XML over HTTPS), integration manual v3.3.35.
 *
 * Basic authentication with the account id and passphrase. An order is
 * created with one <box> per parcel, then its A6 PDF labels are fetched; each
 * label carries the barcode that is the tracking number. bpost has no rating
 * API: prices come from the contract, so `rates` is null.
 *
 * NOT yet run against bpost. Host, headers and the international box follow
 * the manual; the national box and the cancel body follow the v3 schema as
 * published in the manual's XSDs and must be confirmed on the first test call.
 */

const SHM = "https://shm-rest.bpost.cloud/services/shm";
const TRACK = "https://api.parcel.bpost.cloud/services/trackedmail";
const NAMESPACES = `xmlns="http://schema.post.be/shm/deepintegration/v5/national" xmlns:common="http://schema.post.be/shm/deepintegration/v5/common" xmlns:tns="http://schema.post.be/shm/deepintegration/v5/" xmlns:international="http://schema.post.be/shm/deepintegration/v5/international" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://schema.post.be/shm/deepintegration/v5/"`;
const NATIONAL = "bpack 24h Pro";
const INTERNATIONAL = ["bpack World Business", "bpack World Express Pro", "bpack Europe Business"];

export const xml = (value: string | number | null | undefined) => String(value ?? "").replace(/[<>&'"]/g, (char) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[char]!);
const tag = (name: string, value: string | number | null | undefined, max = 200) => (value === null || value === undefined || value === "" ? "" : `<${name}>${xml(String(value).slice(0, max))}</${name}>`);

/** bpost wants street and house number apart. "Rue de la Loi 16 bte 3" → ["Rue de la Loi", "16", "bte 3"]. */
export function splitStreet(line: string): { street: string; number: string; box: string | null } {
  const match = line.trim().match(/^(.*?\D)[\s,]+(\d+[a-zA-Z]?)(?:[\s,/-]+(.{1,8}))?$/);
  if (!match) throw new CarrierError("bpost", `needs a house number, and none could be read from "${line}". Correct the address, or record this shipment by hand.`);
  return { street: match[1].trim().replace(/,$/, ""), number: match[2], box: match[3]?.trim() || null };
}

function person(who: Party): string {
  const { street, number, box } = splitStreet(who.line1);
  return [
    tag("common:name", who.name, 40),
    tag("common:company", who.company, 40),
    "<common:address>",
    tag("common:streetName", street, 40),
    tag("common:number", number, 8),
    tag("common:box", box ?? who.line2, 8),
    tag("common:postalCode", who.postalCode, 32),
    tag("common:locality", who.city, 40),
    tag("common:countryCode", who.countryCode),
    "</common:address>",
    tag("common:emailAddress", who.email, 50),
    tag("common:phoneNumber", who.phone, 20),
  ].join("");
}

export function bpostOrderXml(accountId: string, request: ShipmentRequest, service: string): string {
  const national = request.recipient.countryCode === "BE";
  if (national !== (service === NATIONAL)) throw new CarrierError("bpost", national ? `delivers within Belgium with "${NATIONAL}".` : `"${NATIONAL}" is for Belgium only. Choose an international bpost service.`);
  const sender = `<tns:sender>${person(request.sender)}</tns:sender>`;
  const boxes = request.boxes.map((box) => {
    const grams = Math.min(30_000, Math.max(100, Math.round(box.weightGrams)));
    if (national) {
      return `<tns:box>${sender}<tns:nationalBox><atHome><product>${xml(service)}</product>${request.recipient.email ? `<options><common:infoNextDay language="EN"><common:emailAddress>${xml(request.recipient.email)}</common:emailAddress></common:infoNextDay></options>` : ""}<weight>${grams}</weight><receiver>${person(request.recipient)}</receiver></atHome></tns:nationalBox></tns:box>`;
    }
    // Customs content is declared per box; with several boxes each carries its share by weight.
    const share = box.weightGrams / Math.max(1, request.boxes.reduce((sum, each) => sum + each.weightGrams, 0));
    const contents = request.commodities
      .slice(0, 10)
      .map((line) => `<international:parcelContent>${tag("international:numberOfItemType", line.quantity)}${tag("international:valueOfItem", Math.round(line.unitValueCents * line.quantity))}${tag("international:itemDescription", line.description, 30)}${tag("international:nettoWeight", Math.round(line.unitWeightGrams * line.quantity))}${tag("international:hsTariffCode", line.hsCode)}${tag("international:originOfGoods", line.originCountry ?? request.sender.countryCode)}</international:parcelContent>`)
      .join("");
    return `<tns:box>${sender}<tns:internationalBox><international:international>${tag("international:product", service)}<international:receiver>${person(request.recipient)}</international:receiver>${tag("international:parcelWeight", grams)}<international:customsInfo>${tag("international:parcelValue", Math.round(request.declaredValueCents * share))}${tag("international:contentDescription", request.commodities.map((line) => line.description).join(", "), 50)}<international:shipmentType>GOODS</international:shipmentType><international:parcelReturnInstructions>RTS</international:parcelReturnInstructions><international:privateAddress>${request.recipient.company ? "false" : "true"}</international:privateAddress>${tag("international:currency", request.currency)}<international:amtPostagePaidByAddresse>0</international:amtPostagePaidByAddresse></international:customsInfo><international:parcelContents>${contents}</international:parcelContents></international:international></tns:internationalBox></tns:box>`;
  });
  const lines = request.commodities.map((line) => `<tns:orderLine>${tag("tns:text", line.description, 50)}${tag("tns:nbOfItems", line.quantity)}</tns:orderLine>`).join("");
  return `<?xml version="1.0" encoding="UTF-8"?><tns:order ${NAMESPACES}>${tag("tns:accountId", accountId)}${tag("tns:reference", request.reference, 50)}${lines}${boxes.join("")}</tns:order>`;
}

const first = (source: string, name: string) => source.match(new RegExp(`<(?:\\w+:)?${name}[^>]*>([\\s\\S]*?)</(?:\\w+:)?${name}>`))?.[1]?.trim() ?? null;
const all = (source: string, name: string) => [...source.matchAll(new RegExp(`<(?:\\w+:)?${name}[^>]*>([\\s\\S]*?)</(?:\\w+:)?${name}>`, "g"))].map((match) => match[1]);
const describe = (body: string) => first(body, "message") ?? first(body, "error") ?? (body.trim().startsWith("<") ? null : body.trim().slice(0, 300) || null);

export function createBpost(env: Env, transport: CarrierTransport): ShippingCarrier | { missing: string[] } {
  const requires = ["BPOST_ACCOUNT_ID", "BPOST_PASSPHRASE"];
  const missing = requires.filter((key) => !env[key]);
  if (missing.length) return { missing };
  const accountId = env.BPOST_ACCOUNT_ID!;
  const authorization = basicAuth(accountId, env.BPOST_PASSPHRASE!);
  const orders = `${SHM}/${encodeURIComponent(accountId)}/orders`;

  return {
    key: "bpost",
    name: "bpost",
    requires,
    // bpost has no separate test host: test with a test account, or cancel test orders before they are handed over.
    environment: "production",
    services: [NATIONAL, ...INTERNATIONAL].map((name) => ({ code: name, name })),
    rates: null,

    async book(request, service): Promise<BookedShipment> {
      await carrierCall(transport, "bpost", orders, { method: "POST", headers: { authorization, "content-type": "application/vnd.bpost.shm-order-v5+XML" }, body: bpostOrderXml(accountId, request, service) }, describe);
      const reference = encodeURIComponent(request.reference);
      const body = await carrierCall(transport, "bpost", `${orders}/${reference}/labels/A6`, { method: "GET", headers: { authorization, "content-type": "application/vnd.bpost.shm-labelRequest-v5+XML", accept: "application/vnd.bpost.shm-label-pdf-v3.4+XML" } }, describe);
      const labels = all(body, "label").map((label) => ({ barcode: first(label, "barcode"), bytes: first(label, "bytes") })).filter((label): label is { barcode: string; bytes: string } => !!label.barcode && !!label.bytes);
      if (labels.length === 0) throw new CarrierError("bpost", `created order ${request.reference} but returned no label. Open the order in Shipping Manager to print it, or cancel it there.`);
      const tracking = labels[0].barcode;
      return {
        carrierRef: request.reference,
        trackingNumber: tracking,
        trackingUrl: `https://track.bpost.cloud/btr/web/#/search?itemCode=${encodeURIComponent(tracking)}&postalCode=${encodeURIComponent(request.recipient.postalCode)}&lang=en`,
        boxTrackingNumbers: labels.map((label) => label.barcode),
        labels: labels.map((label) => ({ mime: "application/pdf", data: Buffer.from(label.bytes, "base64"), trackingNumber: label.barcode })),
        costCents: null,
        estimatedDelivery: null,
      };
    },

    async cancel({ carrierRef }) {
      const body = `<?xml version="1.0" encoding="UTF-8"?><orderUpdate xmlns="http://schema.post.be/shm/deepintegration/v3/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><status>CANCELLED</status></orderUpdate>`;
      await carrierCall(transport, "bpost", `${orders}/${encodeURIComponent(carrierRef)}`, { method: "POST", headers: { authorization, "content-type": "application/vnd.bpost.shm-orderUpdate-v3+XML" }, body }, describe);
    },

    async track(trackingNumber): Promise<Tracking> {
      const body = await carrierCall(transport, "bpost", `${TRACK}/item/${encodeURIComponent(trackingNumber)}/trackingInfo`, { method: "GET", headers: { authorization, accept: "application/xml" } }, describe);
      const events = all(body, "stateInfo")
        .map((state) => ({ at: new Date(first(state, "time") ?? ""), description: first(state, "stateDescription") ?? first(state, "stateCode") ?? "", location: null }))
        .filter((event) => !Number.isNaN(event.at.getTime()))
        .sort((a, b) => a.at.getTime() - b.at.getTime());
      const delivered = first(body, "deliveryTime");
      const deliveredAt = delivered && !Number.isNaN(new Date(delivered).getTime()) ? new Date(delivered) : null;
      return { status: deliveredAt ? "DELIVERED" : events.length ? "IN_TRANSIT" : null, deliveredAt, events };
    },
  };
}
