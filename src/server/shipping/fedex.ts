import { CarrierError, type BookedShipment, type CarrierTransport, type Env, type Party, type RateQuote, type ShipmentRequest, type ShippingCarrier, type Tracking, amount, carrierCall, cm, kg, parseJson, toCents } from "./carriers";

/**
 * FedEx — REST APIs: OAuth, Rate (/rate/v1), Ship (/ship/v1), Track (/track/v1).
 * https://developer.fedex.com
 *
 * OAuth client-credentials token (valid 60 minutes, cached here), then JSON.
 * The label is asked for inline (labelResponseOptions "LABEL") as a 4×6 PDF.
 *
 * NOT yet run against FedEx. Field names follow the published reference.
 */

const HOSTS = { sandbox: "https://apis-sandbox.fedex.com", production: "https://apis.fedex.com" } as const;

const SERVICE_NAMES: Record<string, string> = {
  FEDEX_INTERNATIONAL_PRIORITY_EXPRESS: "International Priority Express",
  FEDEX_INTERNATIONAL_PRIORITY: "International Priority",
  INTERNATIONAL_ECONOMY: "International Economy",
  FEDEX_INTERNATIONAL_CONNECT_PLUS: "International Connect Plus",
  FEDEX_REGIONAL_ECONOMY: "Regional Economy",
  PRIORITY_OVERNIGHT: "Priority Overnight",
};

const address = (who: Party) => ({ streetLines: [who.line1, who.line2].filter(Boolean).map((line) => String(line).slice(0, 35)), city: who.city, ...(who.region ? { stateOrProvinceCode: who.region.slice(0, 2).toUpperCase() } : {}), postalCode: who.postalCode, countryCode: who.countryCode });
const party = (who: Party) => ({ address: address(who), contact: { personName: who.name.slice(0, 70), ...(who.company ? { companyName: who.company.slice(0, 35) } : {}), phoneNumber: (who.phone ?? "").replace(/[^\d+]/g, ""), ...(who.email ? { emailAddress: who.email } : {}) } });
const lineItems = (request: ShipmentRequest) =>
  request.boxes.map((box, index) => ({ sequenceNumber: String(index + 1), weight: { units: "KG", value: kg(box.weightGrams) }, ...(box.lengthMm && box.widthMm && box.heightMm ? { dimensions: { length: cm(box.lengthMm), width: cm(box.widthMm), height: cm(box.heightMm), units: "CM" } } : {}) }));
const customsDetail = (request: ShipmentRequest) => ({
  dutiesPayment: { paymentType: "RECIPIENT" },
  isDocumentOnly: false,
  totalCustomsValue: { amount: amount(request.declaredValueCents), currency: request.currency },
  commercialInvoice: { purpose: "SOLD", termsOfSale: "DAP", shipmentPurpose: "SOLD" },
  commodities: request.commodities.map((line) => ({
    description: line.description.slice(0, 450),
    name: line.description.slice(0, 35),
    numberOfPieces: 1,
    quantity: line.quantity,
    quantityUnits: "PCS",
    countryOfManufacture: line.originCountry ?? request.sender.countryCode,
    ...(line.hsCode ? { harmonizedCode: line.hsCode } : {}),
    weight: { units: "KG", value: kg(line.unitWeightGrams * line.quantity) },
    unitPrice: { amount: amount(line.unitValueCents), currency: request.currency },
    customsValue: { amount: amount(line.unitValueCents * line.quantity), currency: request.currency },
  })),
});

type FedexErrors = { errors?: { code?: string; message?: string }[] };
const describe = (body: string) => {
  try {
    const errors = (JSON.parse(body) as FedexErrors).errors;
    return errors?.length ? errors.map((error) => [error.code, error.message].filter(Boolean).join(": ")).join(" — ") : null;
  } catch {
    return null;
  }
};

export function createFedex(env: Env, transport: CarrierTransport, now: () => number = Date.now): ShippingCarrier | { missing: string[] } {
  const requires = ["FEDEX_CLIENT_ID", "FEDEX_CLIENT_SECRET", "FEDEX_ACCOUNT_NUMBER"];
  const missing = requires.filter((key) => !env[key]);
  if (missing.length) return { missing };
  const environment = env.FEDEX_ENV === "production" ? "production" : "sandbox";
  const base = HOSTS[environment];
  const account = env.FEDEX_ACCOUNT_NUMBER!;
  let token: { value: string; expiresAt: number } | null = null;

  async function bearer(): Promise<string> {
    if (token && token.expiresAt > now() + 60_000) return token.value;
    const body = new URLSearchParams({ grant_type: "client_credentials", client_id: env.FEDEX_CLIENT_ID!, client_secret: env.FEDEX_CLIENT_SECRET! }).toString();
    const text = await carrierCall(transport, "FedEx", `${base}/oauth/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body }, describe);
    const result = parseJson<{ access_token?: string; expires_in?: number }>("FedEx", text);
    if (!result.access_token) throw new CarrierError("FedEx", "did not issue an access token. Check the client id and secret.");
    token = { value: result.access_token, expiresAt: now() + (result.expires_in ?? 3600) * 1000 };
    return token.value;
  }

  async function call<T>(method: "POST" | "PUT", path: string, body: unknown): Promise<T> {
    const headers = { authorization: `Bearer ${await bearer()}`, "content-type": "application/json", "x-locale": "en_US" };
    return parseJson<T>("FedEx", await carrierCall(transport, "FedEx", `${base}${path}`, { method, headers, body: JSON.stringify(body) }, describe));
  }

  return {
    key: "fedex",
    name: "FedEx",
    requires,
    environment,
    services: Object.entries(SERVICE_NAMES).map(([code, name]) => ({ code, name })),

    async rates(request) {
      type Response = { output?: { rateReplyDetails?: { serviceType: string; serviceName?: string; ratedShipmentDetails?: { rateType?: string; totalNetCharge?: number; currency?: string; shipmentRateDetail?: { currency?: string } }[]; commit?: { dateDetail?: { dayFormat?: string } } }[] } };
      const result = await call<Response>("POST", "/rate/v1/rates/quotes", {
        accountNumber: { value: account },
        rateRequestControlParameters: { returnTransitTimes: true },
        requestedShipment: {
          shipper: { address: address(request.sender) },
          recipient: { address: address(request.recipient) },
          shipDateStamp: request.shipDate.toISOString().slice(0, 10),
          pickupType: "USE_SCHEDULED_PICKUP",
          packagingType: "YOUR_PACKAGING",
          rateRequestType: ["ACCOUNT"],
          preferredCurrency: request.currency,
          requestedPackageLineItems: lineItems(request),
          ...(request.customs ? { customsClearanceDetail: customsDetail(request) } : {}),
        },
      });
      const quotes: RateQuote[] = [];
      for (const reply of result.output?.rateReplyDetails ?? []) {
        const detail = reply.ratedShipmentDetails?.find((entry) => entry.rateType === "ACCOUNT") ?? reply.ratedShipmentDetails?.[0];
        if (!detail || !(Number(detail.totalNetCharge) > 0)) continue;
        const eta = reply.commit?.dateDetail?.dayFormat;
        quotes.push({ carrier: "fedex", carrierName: "FedEx", service: reply.serviceType, serviceName: reply.serviceName ?? SERVICE_NAMES[reply.serviceType] ?? reply.serviceType, priceCents: toCents(detail.totalNetCharge), currency: detail.currency ?? detail.shipmentRateDetail?.currency ?? request.currency, estimatedDelivery: eta ? new Date(eta) : null });
      }
      return quotes;
    },

    async book(request, service): Promise<BookedShipment> {
      type Document = { encodedLabel?: string; contentType?: string; docType?: string };
      type Response = { output?: { transactionShipments?: { masterTrackingNumber?: string; pieceResponses?: { trackingNumber?: string; packageDocuments?: Document[]; netRateAmount?: number }[]; shipmentDocuments?: Document[]; completedShipmentDetail?: { shipmentRating?: { shipmentRateDetails?: { totalNetCharge?: number }[] }; operationalDetail?: { deliveryDate?: string } } }[] } };
      const result = await call<Response>("POST", "/ship/v1/shipments", {
        labelResponseOptions: "LABEL",
        mergeLabelDocOption: "LABELS_ONLY",
        accountNumber: { value: account },
        shipAction: "CONFIRM",
        requestedShipment: {
          shipper: party(request.sender),
          recipients: [party(request.recipient)],
          shipDatestamp: request.shipDate.toISOString().slice(0, 10),
          serviceType: service,
          packagingType: "YOUR_PACKAGING",
          pickupType: "USE_SCHEDULED_PICKUP",
          blockInsightVisibility: false,
          shippingChargesPayment: { paymentType: "SENDER" },
          labelSpecification: { labelFormatType: "COMMON2D", imageType: "PDF", labelStockType: request.labelFormat === "A4" ? "PAPER_85X11_TOP_HALF_LABEL" : "PAPER_4X6" },
          customerReferences: [{ customerReferenceType: "CUSTOMER_REFERENCE", value: request.reference.slice(0, 40) }],
          totalPackageCount: request.boxes.length,
          requestedPackageLineItems: lineItems(request),
          ...(request.customs ? { customsClearanceDetail: customsDetail(request) } : {}),
        },
      });
      const shipment = result.output?.transactionShipments?.[0];
      const pieces = shipment?.pieceResponses ?? [];
      const documents = [...(shipment?.shipmentDocuments ?? []), ...pieces.flatMap((piece) => piece.packageDocuments ?? [])].filter((document) => document.encodedLabel);
      const tracking = shipment?.masterTrackingNumber ?? pieces[0]?.trackingNumber;
      if (!tracking || documents.length === 0) throw new CarrierError("FedEx", "accepted the request but returned no tracking number or label. Check the shipment in FedEx Ship Manager before trying again.");
      const charge = shipment?.completedShipmentDetail?.shipmentRating?.shipmentRateDetails?.[0]?.totalNetCharge;
      const eta = shipment?.completedShipmentDetail?.operationalDetail?.deliveryDate;
      return {
        carrierRef: tracking,
        trackingNumber: tracking,
        trackingUrl: `https://www.fedex.com/fedextrack/?trknbr=${encodeURIComponent(tracking)}`,
        boxTrackingNumbers: pieces.map((piece) => piece.trackingNumber ?? "").filter(Boolean),
        labels: documents.map((document) => ({ mime: "application/pdf", data: Buffer.from(document.encodedLabel!, "base64") })),
        costCents: charge !== undefined && Number(charge) > 0 ? toCents(charge) : null,
        estimatedDelivery: eta ? new Date(eta) : null,
      };
    },

    async cancel({ trackingNumber }) {
      type Response = { output?: { cancelledShipment?: boolean; successMessage?: string; alerts?: { message?: string }[] } };
      const result = await call<Response>("PUT", "/ship/v1/shipments/cancel", { accountNumber: { value: account }, trackingNumber, senderCountryCode: "BE", deletionControl: "DELETE_ALL_PACKAGES" });
      if (result.output?.cancelledShipment === false) throw new CarrierError("FedEx", result.output.alerts?.map((alert) => alert.message).join(" ") || "did not cancel the shipment.");
    },

    async track(trackingNumber): Promise<Tracking> {
      type Response = { output?: { completeTrackResults?: { trackResults?: { latestStatusDetail?: { code?: string; derivedCode?: string }; scanEvents?: { date?: string; eventDescription?: string; scanLocation?: { city?: string; countryCode?: string } }[]; dateAndTimes?: { type?: string; dateTime?: string }[]; error?: { message?: string } }[] }[] } };
      const result = await call<Response>("POST", "/track/v1/trackingnumbers", { includeDetailedScans: true, trackingInfo: [{ trackingNumberInfo: { trackingNumber } }] });
      const track = result.output?.completeTrackResults?.[0]?.trackResults?.[0];
      if (track?.error?.message) throw new CarrierError("FedEx", track.error.message);
      const events = (track?.scanEvents ?? []).map((event) => ({ at: new Date(event.date ?? ""), description: event.eventDescription ?? "", location: [event.scanLocation?.city, event.scanLocation?.countryCode].filter(Boolean).join(", ") || null })).filter((event) => !Number.isNaN(event.at.getTime())).sort((a, b) => a.at.getTime() - b.at.getTime());
      const code = track?.latestStatusDetail?.derivedCode ?? track?.latestStatusDetail?.code ?? "";
      const delivery = track?.dateAndTimes?.find((entry) => entry.type === "ACTUAL_DELIVERY")?.dateTime;
      const status = code === "DL" ? "DELIVERED" : code === "RS" ? "RETURNED" : code === "DE" || code === "CA" ? "FAILED" : events.length ? "IN_TRANSIT" : null;
      return { status, deliveredAt: status === "DELIVERED" ? (delivery ? new Date(delivery) : (events.at(-1)?.at ?? null)) : null, events };
    },
  };
}
