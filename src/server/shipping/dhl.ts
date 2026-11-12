import { CarrierError, type BookedShipment, type CarrierTransport, type Env, type Party, type RateQuote, type ShipmentRequest, type ShippingCarrier, type Tracking, type TrackingStatus, amount, basicAuth, carrierCall, cm, kg, parseJson, toCents } from "./carriers";

/**
 * DHL Express — MyDHL API (REST), reference v3.4.1.
 * https://developer.dhl.com/api-reference/dhl-express-mydhl-api
 *
 * Basic authentication with the API key and secret; rates are the account's
 * own. MyDHL API has no "cancel shipment" operation (only pickups can be
 * cancelled): a label that is never handed over is not charged.
 *
 * NOT yet run against DHL. Field names follow the published reference.
 */

const HOSTS = { test: "https://express.api.dhl.com/mydhlapi/test", production: "https://express.api.dhl.com/mydhlapi" } as const;

/** "2026-11-12T10:00:00 GMT+01:00" — the format MyDHL requires, in Belgian local time. */
export function dhlDateTime(date: Date): string {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Brussels", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23", timeZoneName: "longOffset" }).formatToParts(date).map((part) => [part.type, part.value]));
  const offset = parts.timeZoneName === "GMT" ? "GMT+00:00" : parts.timeZoneName;
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second} ${offset}`;
}

const packages = (request: ShipmentRequest) =>
  request.boxes.map((box) => ({ weight: kg(box.weightGrams), ...(box.lengthMm && box.widthMm && box.heightMm ? { dimensions: { length: cm(box.lengthMm), width: cm(box.widthMm), height: cm(box.heightMm) } } : {}) }));

const party = (who: Party) => ({
  postalAddress: { postalCode: who.postalCode, cityName: who.city, countryCode: who.countryCode, addressLine1: who.line1.slice(0, 45), ...(who.line2 ? { addressLine2: who.line2.slice(0, 45) } : {}), ...(who.region ? { provinceName: who.region.slice(0, 35) } : {}) },
  contactInformation: { fullName: who.name.slice(0, 70), companyName: (who.company || who.name).slice(0, 70), phone: who.phone ?? "", ...(who.email ? { email: who.email } : {}) },
});

const STATUS: Record<string, TrackingStatus> = { delivered: "DELIVERED", transit: "IN_TRANSIT", failure: "FAILED", returned: "RETURNED" };

type DhlError = { detail?: string; title?: string; message?: string; additionalDetails?: string[] };
const describe = (body: string) => {
  try {
    const error = JSON.parse(body) as DhlError;
    return [error.detail ?? error.title ?? error.message, ...(error.additionalDetails ?? [])].filter(Boolean).join(" — ") || null;
  } catch {
    return null;
  }
};

export function createDhlExpress(env: Env, transport: CarrierTransport): ShippingCarrier | { missing: string[] } {
  const requires = ["DHL_EXPRESS_API_KEY", "DHL_EXPRESS_API_SECRET", "DHL_EXPRESS_ACCOUNT_NUMBER"];
  const missing = requires.filter((key) => !env[key]);
  if (missing.length) return { missing };
  const environment = env.DHL_EXPRESS_ENV === "production" ? "production" : "test";
  const base = HOSTS[environment];
  const account = env.DHL_EXPRESS_ACCOUNT_NUMBER!;
  const headers = { authorization: basicAuth(env.DHL_EXPRESS_API_KEY!, env.DHL_EXPRESS_API_SECRET!), "content-type": "application/json", accept: "application/json" };
  const call = <T>(method: "GET" | "POST", path: string, body?: unknown) => carrierCall(transport, "DHL Express", `${base}${path}`, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) }, describe).then((text) => parseJson<T>("DHL Express", text));

  return {
    key: "dhl",
    name: "DHL Express",
    requires,
    environment,
    services: [
      { code: "P", name: "Express Worldwide (non-EU)" },
      { code: "U", name: "Express Worldwide (EU)" },
      { code: "N", name: "Express Domestic" },
    ],

    async rates(request) {
      type Response = { products?: { productCode: string; productName: string; totalPrice?: { currencyType: string; priceCurrency: string; price: number }[]; deliveryCapabilities?: { estimatedDeliveryDateAndTime?: string } }[] };
      const result = await call<Response>("POST", "/rates", {
        customerDetails: {
          shipperDetails: { postalCode: request.sender.postalCode, cityName: request.sender.city, countryCode: request.sender.countryCode },
          receiverDetails: { postalCode: request.recipient.postalCode, cityName: request.recipient.city, countryCode: request.recipient.countryCode },
        },
        accounts: [{ typeCode: "shipper", number: account }],
        plannedShippingDateAndTime: dhlDateTime(request.shipDate),
        unitOfMeasurement: "metric",
        isCustomsDeclarable: request.customs,
        ...(request.customs ? { monetaryAmount: [{ typeCode: "declaredValue", value: amount(request.declaredValueCents), currency: request.currency }] } : {}),
        packages: packages(request),
      });
      const quotes: RateQuote[] = [];
      for (const product of result.products ?? []) {
        // BILLC is the price in the account's billing currency: what DHL will invoice.
        const price = product.totalPrice?.find((entry) => entry.currencyType === "BILLC") ?? product.totalPrice?.[0];
        if (!price || !(price.price > 0)) continue;
        const eta = product.deliveryCapabilities?.estimatedDeliveryDateAndTime;
        quotes.push({ carrier: "dhl", carrierName: "DHL Express", service: product.productCode, serviceName: product.productName, priceCents: toCents(price.price), currency: price.priceCurrency, estimatedDelivery: eta ? new Date(eta) : null });
      }
      return quotes;
    },

    async book(request, service): Promise<BookedShipment> {
      type Response = { shipmentTrackingNumber?: string; trackingUrl?: string; packages?: { trackingNumber?: string }[]; documents?: { imageFormat?: string; content?: string; typeCode?: string }[]; estimatedDeliveryDate?: { estimatedDeliveryDate?: string } };
      const result = await call<Response>("POST", "/shipments", {
        plannedShippingDateAndTime: dhlDateTime(request.shipDate),
        pickup: { isRequested: false },
        productCode: service,
        accounts: [{ typeCode: "shipper", number: account }],
        customerReferences: [{ value: request.reference.slice(0, 35), typeCode: "CU" }],
        outputImageProperties: { encodingFormat: "pdf", imageOptions: [{ typeCode: "label", templateName: "ECOM26_84_001" }] },
        customerDetails: { shipperDetails: party(request.sender), receiverDetails: party(request.recipient) },
        content: {
          packages: packages(request).map((box) => ({ ...box, customerReferences: [{ value: request.reference.slice(0, 35), typeCode: "CU" }] })),
          isCustomsDeclarable: request.customs,
          description: request.commodities.map((line) => line.description).join(", ").slice(0, 70),
          incoterm: "DAP",
          unitOfMeasurement: "metric",
          ...(request.customs
            ? {
                declaredValue: amount(request.declaredValueCents),
                declaredValueCurrency: request.currency,
                exportDeclaration: {
                  lineItems: request.commodities.map((line, index) => ({
                    number: index + 1,
                    description: line.description.slice(0, 75),
                    price: amount(line.unitValueCents),
                    quantity: { value: line.quantity, unitOfMeasurement: "PCS" },
                    ...(line.hsCode ? { commodityCodes: [{ typeCode: "outbound", value: line.hsCode }] } : {}),
                    exportReasonType: "permanent",
                    manufacturerCountry: line.originCountry ?? request.sender.countryCode,
                    weight: { netValue: kg(line.unitWeightGrams * line.quantity), grossValue: kg(line.unitWeightGrams * line.quantity) },
                  })),
                  invoice: { number: request.reference.slice(0, 35), date: request.shipDate.toISOString().slice(0, 10) },
                  exportReason: "sale",
                  exportReasonType: "permanent",
                },
              }
            : {}),
        },
      });
      const label = result.documents?.find((document) => document.typeCode === "label" || document.typeCode === "waybillDoc") ?? result.documents?.[0];
      if (!result.shipmentTrackingNumber || !label?.content) throw new CarrierError("DHL Express", "accepted the request but returned no tracking number or label. Check the shipment in MyDHL before trying again.");
      const eta = result.estimatedDeliveryDate?.estimatedDeliveryDate;
      return {
        carrierRef: result.shipmentTrackingNumber,
        trackingNumber: result.shipmentTrackingNumber,
        trackingUrl: `https://www.dhl.com/be-en/home/tracking/tracking-express.html?submit=1&tracking-id=${encodeURIComponent(result.shipmentTrackingNumber)}`,
        boxTrackingNumbers: (result.packages ?? []).map((box) => box.trackingNumber ?? "").filter(Boolean),
        labels: [{ mime: label.imageFormat?.toLowerCase() === "pdf" || !label.imageFormat ? "application/pdf" : `image/${label.imageFormat.toLowerCase()}`, data: Buffer.from(label.content, "base64") }],
        costCents: null,
        estimatedDelivery: eta ? new Date(eta) : null,
      };
    },

    cancel: null,

    async track(trackingNumber): Promise<Tracking> {
      type Response = { shipments?: { status?: string; events?: { date?: string; time?: string; description?: string; serviceArea?: { description?: string }[] }[] }[] };
      const result = await call<Response>("GET", `/shipments/${encodeURIComponent(trackingNumber)}/tracking?trackingView=all-checkpoints&levelOfDetail=shipment`);
      const shipment = result.shipments?.[0];
      const events = (shipment?.events ?? []).map((event) => ({ at: new Date(`${event.date ?? ""}T${event.time ?? "00:00:00"}`), description: event.description ?? "", location: event.serviceArea?.[0]?.description ?? null })).filter((event) => !Number.isNaN(event.at.getTime()));
      const state = (shipment?.status ?? "").toLowerCase();
      const delivered = state.includes("deliver") || events.some((event) => /^delivered/i.test(event.description));
      const status = delivered ? "DELIVERED" : (STATUS[state] ?? (events.length ? "IN_TRANSIT" : null));
      return { status, deliveredAt: delivered ? (events.find((event) => /^delivered/i.test(event.description))?.at ?? events.at(-1)?.at ?? null) : null, events };
    },
  };
}
