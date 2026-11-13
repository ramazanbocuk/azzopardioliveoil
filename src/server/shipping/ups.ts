import { randomUUID } from "node:crypto";
import { CarrierError, type BookedShipment, type CarrierTransport, type Env, type Party, type RateQuote, type ShipmentRequest, type ShippingCarrier, type Tracking, type TrackingEvent, type TrackingEventKind, amount, basicAuth, carrierCall, cm, kg, parseJson, toCents } from "./carriers";

/**
 * UPS — REST APIs: OAuth client credentials, Rating v2409, Shipping v2409, Tracking v1.
 * https://developer.ups.com · OpenAPI files: github.com/UPS-API/api-documentation
 *
 * OAuth token (cached here), then JSON. UPS sends every number as a string
 * and expects them as strings. Labels are returned inline as GIF images:
 * UPS offers GIF, PNG and printer languages (ZPL, EPL, SPL), not PDF, so the
 * label prints as an image on either printer type.
 *
 * NOT yet run against UPS. Paths and field names follow UPS's published
 * OpenAPI files as read on 2026-11-15; the first real call must be made in
 * the Customer Integration Environment (UPS_ENV unset or "test").
 */

const HOSTS = { test: "https://wwwcie.ups.com", production: "https://onlinetools.ups.com" } as const;
const VERSION = "v2409";

/** The services a European shipper normally books. UPS's own codes. */
const SERVICE_NAMES: Record<string, string> = {
  "11": "UPS Standard",
  "65": "UPS Express Saver",
  "07": "UPS Express",
  "08": "UPS Expedited",
  "54": "UPS Express Plus",
};

const text = (value: number) => String(value);
const address = (who: Party) => ({ AddressLine: [who.line1, who.line2].filter(Boolean).map((line) => String(line).slice(0, 35)), City: who.city.slice(0, 30), ...(who.region ? { StateProvinceCode: who.region.slice(0, 5).toUpperCase() } : {}), PostalCode: who.postalCode, CountryCode: who.countryCode });
const phone = (who: Party) => ({ Number: (who.phone ?? "").replace(/[^\d]/g, "").slice(0, 15) });
const party = (who: Party) => ({ Name: (who.company ?? who.name).slice(0, 35), AttentionName: who.name.slice(0, 35), Phone: phone(who), ...(who.email ? { EMailAddress: who.email.slice(0, 50) } : {}), Address: address(who) });
const packages = (request: ShipmentRequest, key: "Packaging" | "PackagingType") =>
  request.boxes.map((box) => ({
    [key]: { Code: "02" }, // customer-supplied package
    ...(box.lengthMm && box.widthMm && box.heightMm ? { Dimensions: { UnitOfMeasurement: { Code: "CM" }, Length: text(cm(box.lengthMm)!), Width: text(cm(box.widthMm)!), Height: text(cm(box.heightMm)!) } } : {}),
    PackageWeight: { UnitOfMeasurement: { Code: "KGS" }, Weight: text(kg(box.weightGrams)) },
  }));
const yyyymmdd = (date: Date) => date.toISOString().slice(0, 10).replaceAll("-", "");
/** "20261116" (+ optional "143000") as UTC. Invalid input gives null. */
function stamp(date?: string | null, time?: string | null): Date | null {
  if (!date || !/^\d{8}$/.test(date)) return null;
  const clock = time && /^\d{4,6}$/.test(time) ? time.padEnd(6, "0") : "000000";
  const parsed = new Date(`${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T${clock.slice(0, 2)}:${clock.slice(2, 4)}:${clock.slice(4, 6)}Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

type UpsErrors = { response?: { errors?: { code?: string; message?: string }[] } };
const describe = (body: string) => {
  try {
    const errors = (JSON.parse(body) as UpsErrors).response?.errors;
    return errors?.length ? errors.map((error) => [error.code, error.message].filter(Boolean).join(": ")).join(" — ") : null;
  } catch {
    return null;
  }
};

/**
 * UPS's one-letter activity types. D delivered; RS returned to shipper;
 * X exception; O out for delivery; I in transit; P picked up; M and MV are
 * label created and label voided, which say nothing about a moving parcel.
 */
const KIND: Record<string, TrackingEventKind> = { D: "DELIVERED", RS: "RETURNED", X: "EXCEPTION", O: "OUT_FOR_DELIVERY" };

export function createUps(env: Env, transport: CarrierTransport, now: () => number = Date.now): ShippingCarrier | { missing: string[] } {
  const requires = ["UPS_CLIENT_ID", "UPS_CLIENT_SECRET", "UPS_ACCOUNT_NUMBER"];
  const missing = requires.filter((key) => !env[key]);
  if (missing.length) return { missing };
  const environment = env.UPS_ENV === "production" ? "production" : "test";
  const host = HOSTS[environment];
  const account = env.UPS_ACCOUNT_NUMBER!;
  let token: { value: string; expiresAt: number } | null = null;

  async function bearer(): Promise<string> {
    if (token && token.expiresAt > now() + 60_000) return token.value;
    const answer = await carrierCall(transport, "UPS", `${host}/security/v1/oauth/token`, { method: "POST", headers: { authorization: basicAuth(env.UPS_CLIENT_ID!, env.UPS_CLIENT_SECRET!), "x-merchant-id": account, "content-type": "application/x-www-form-urlencoded" }, body: "grant_type=client_credentials" }, describe);
    const result = parseJson<{ access_token?: string; expires_in?: string | number }>("UPS", answer);
    if (!result.access_token) throw new CarrierError("UPS", "did not issue an access token. Check the client id, the secret and the account number.");
    token = { value: result.access_token, expiresAt: now() + (Number(result.expires_in) || 3600) * 1000 };
    return token.value;
  }

  async function call<T>(method: "GET" | "POST" | "DELETE", path: string, body?: unknown): Promise<T> {
    // transId lets UPS find one request in its logs; it must be unique and at most 32 characters.
    const headers = { authorization: `Bearer ${await bearer()}`, "content-type": "application/json", transId: randomUUID().replaceAll("-", ""), transactionSrc: "azzopardi" };
    return parseJson<T>("UPS", await carrierCall(transport, "UPS", `${host}/api${path}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, describe));
  }

  const shipper = (request: ShipmentRequest) => ({ ...party(request.sender), ShipperNumber: account });
  const payment = { ShipmentCharge: [{ Type: "01", BillShipper: { AccountNumber: account } }] };

  return {
    key: "ups",
    name: "UPS",
    requires,
    environment,
    services: Object.entries(SERVICE_NAMES).map(([code, name]) => ({ code, name })),

    async ping() {
      await bearer();
    },

    async rates(request) {
      type Money = { CurrencyCode?: string; MonetaryValue?: string };
      type Rated = { Service?: { Code?: string }; TotalCharges?: Money; NegotiatedRateCharges?: { TotalCharge?: Money }; TimeInTransit?: { ServiceSummary?: { Service?: { Description?: string }; EstimatedArrival?: { Arrival?: { Date?: string; Time?: string } } } } };
      const result = await call<{ RateResponse?: { RatedShipment?: Rated[] | Rated } }>("POST", `/rating/${VERSION}/Shoptimeintransit`, {
        RateRequest: {
          Request: { RequestOption: "Shoptimeintransit", TransactionReference: { CustomerContext: request.reference.slice(0, 512) } },
          Shipment: {
            Shipper: { Name: shipper(request).Name, ShipperNumber: account, Address: address(request.sender) },
            ShipTo: { Name: party(request.recipient).Name, Address: address(request.recipient) },
            ShipFrom: { Name: shipper(request).Name, Address: address(request.sender) },
            PaymentDetails: payment,
            // Ask for the prices agreed for this account, not the public list.
            ShipmentRatingOptions: { NegotiatedRatesIndicator: "Y" },
            Package: packages(request, "PackagingType"),
            InvoiceLineTotal: { CurrencyCode: request.currency, MonetaryValue: text(amount(request.declaredValueCents)) },
            DeliveryTimeInformation: { PackageBillType: "03", Pickup: { Date: yyyymmdd(request.shipDate) } },
          },
        },
      });
      const rated = result.RateResponse?.RatedShipment;
      const quotes: RateQuote[] = [];
      for (const entry of Array.isArray(rated) ? rated : rated ? [rated] : []) {
        const code = entry.Service?.Code;
        const charge = entry.NegotiatedRateCharges?.TotalCharge ?? entry.TotalCharges;
        if (!code || !(Number(charge?.MonetaryValue) > 0)) continue;
        const arrival = entry.TimeInTransit?.ServiceSummary?.EstimatedArrival?.Arrival;
        quotes.push({ carrier: "ups", carrierName: "UPS", service: code, serviceName: SERVICE_NAMES[code] ?? entry.TimeInTransit?.ServiceSummary?.Service?.Description ?? `UPS service ${code}`, priceCents: toCents(charge?.MonetaryValue), currency: charge?.CurrencyCode ?? request.currency, estimatedDelivery: stamp(arrival?.Date, arrival?.Time) });
      }
      return quotes;
    },

    async book(request, service): Promise<BookedShipment> {
      type Money = { MonetaryValue?: string };
      type Result = { TrackingNumber?: string; ShippingLabel?: { ImageFormat?: { Code?: string }; GraphicImage?: string } };
      type Response = { ShipmentResponse?: { ShipmentResults?: { ShipmentIdentificationNumber?: string; ShipmentCharges?: { TotalCharges?: Money }; NegotiatedRateCharges?: { TotalCharge?: Money }; PackageResults?: Result[] | Result } } };
      const result = await call<Response>("POST", `/shipments/${VERSION}/ship`, {
        ShipmentRequest: {
          Request: { RequestOption: "nonvalidate", TransactionReference: { CustomerContext: request.reference.slice(0, 512) } },
          Shipment: {
            Description: (request.commodities[0]?.description ?? "Olive oil").slice(0, 50),
            Shipper: shipper(request),
            ShipTo: party(request.recipient),
            ShipFrom: party(request.sender),
            PaymentInformation: payment,
            Service: { Code: service },
            ShipmentRatingOptions: { NegotiatedRatesIndicator: "Y" },
            Package: packages(request, "Packaging"),
            ...(request.customs
              ? {
                  ShipmentServiceOptions: {
                    InternationalForms: {
                      FormType: "01", // commercial invoice
                      InvoiceDate: yyyymmdd(request.shipDate),
                      ReasonForExport: "SALE",
                      CurrencyCode: request.currency,
                      Contacts: { SoldTo: party(request.recipient) },
                      Product: request.commodities.map((line) => ({
                        Description: line.description.slice(0, 35),
                        Unit: { Number: text(line.quantity), UnitOfMeasurement: { Code: "PCS" }, Value: text(amount(line.unitValueCents)) },
                        ...(line.hsCode ? { CommodityCode: line.hsCode } : {}),
                        OriginCountryCode: line.originCountry ?? request.sender.countryCode,
                      })),
                    },
                  },
                }
              : {}),
          },
          LabelSpecification: { LabelImageFormat: { Code: "GIF" }, LabelStockSize: { Height: "6", Width: "4" } },
        },
      });
      const shipment = result.ShipmentResponse?.ShipmentResults;
      const pieces = Array.isArray(shipment?.PackageResults) ? shipment.PackageResults : shipment?.PackageResults ? [shipment.PackageResults] : [];
      const labels = pieces.filter((piece) => piece.ShippingLabel?.GraphicImage);
      const reference = shipment?.ShipmentIdentificationNumber ?? pieces[0]?.TrackingNumber;
      if (!reference || labels.length === 0) throw new CarrierError("UPS", "accepted the request but returned no shipment number or label. Check the shipment on ups.com before trying again.");
      const charge = shipment?.NegotiatedRateCharges?.TotalCharge?.MonetaryValue ?? shipment?.ShipmentCharges?.TotalCharges?.MonetaryValue;
      const tracking = pieces[0]?.TrackingNumber ?? reference;
      return {
        carrierRef: reference,
        trackingNumber: tracking,
        trackingUrl: `https://www.ups.com/track?tracknum=${encodeURIComponent(tracking)}`,
        boxTrackingNumbers: pieces.map((piece) => piece.TrackingNumber ?? "").filter(Boolean),
        labels: labels.map((piece) => ({ mime: (piece.ShippingLabel?.ImageFormat?.Code ?? "GIF").toUpperCase() === "PNG" ? "image/png" : "image/gif", data: Buffer.from(piece.ShippingLabel!.GraphicImage!, "base64"), trackingNumber: piece.TrackingNumber ?? null })),
        costCents: Number(charge) > 0 ? toCents(charge) : null,
        // The ship answer carries no delivery date; the rate quote does, and tracking will.
        estimatedDelivery: null,
      };
    },

    async cancel({ carrierRef }) {
      type Response = { VoidShipmentResponse?: { SummaryResult?: { Status?: { Code?: string; Description?: string } } } };
      const result = await call<Response>("DELETE", `/shipments/${VERSION}/void/cancel/${encodeURIComponent(carrierRef)}`);
      const status = result.VoidShipmentResponse?.SummaryResult?.Status;
      if (status?.Code && status.Code !== "1") throw new CarrierError("UPS", status.Description || "did not void the shipment.");
    },

    async track(trackingNumber): Promise<Tracking> {
      type Activity = { date?: string; time?: string; gmtDate?: string; gmtTime?: string; location?: { address?: { city?: string; countryCode?: string; country?: string } }; status?: { type?: string; description?: string; code?: string } };
      type Package = { currentStatus?: { type?: string; description?: string; code?: string }; deliveryDate?: { type?: string; date?: string }[]; deliveryTime?: { endTime?: string }; activity?: Activity[] };
      type Response = { trackResponse?: { shipment?: { package?: Package[]; warnings?: { code?: string; message?: string }[] }[] } };
      const result = await call<Response>("GET", `/track/v1/details/${encodeURIComponent(trackingNumber)}?locale=en_US&returnSignature=false`);
      const shipment = result.trackResponse?.shipment?.[0];
      const parcel = shipment?.package?.[0];
      if (!parcel) throw new CarrierError("UPS", shipment?.warnings?.map((warning) => warning.message).filter(Boolean).join(" ") || "has no tracking information for this number yet.");

      const events: TrackingEvent[] = (parcel.activity ?? [])
        .flatMap((activity) => {
          // UPS gives local and GMT times; GMT is unambiguous.
          const at = stamp(activity.gmtDate, activity.gmtTime) ?? stamp(activity.date, activity.time);
          const type = (activity.status?.type ?? "").toUpperCase();
          const where = activity.location?.address;
          return at ? [{ at, description: (activity.status?.description ?? "").trim(), location: [where?.city, where?.countryCode ?? where?.country].filter(Boolean).join(", ") || null, code: activity.status?.code ?? (type || null), kind: KIND[type] ?? "INFO" }] : [];
        })
        .filter((event) => event.description)
        .sort((a, b) => a.at.getTime() - b.at.getTime());

      const type = (parcel.currentStatus?.type ?? "").toUpperCase();
      const moving = events.some((event) => !["M", "MV"].includes(event.code ?? ""));
      const status = type === "D" ? "DELIVERED" : type === "RS" ? "RETURNED" : moving ? "IN_TRANSIT" : null;
      const delivered = parcel.deliveryDate?.find((entry) => entry.type === "DEL")?.date;
      return {
        status,
        deliveredAt: status === "DELIVERED" ? (stamp(delivered, parcel.deliveryTime?.endTime) ?? events.at(-1)?.at ?? null) : null,
        events,
        // An exception is the current state only while it is the latest thing UPS reports.
        problem: type === "X" ? (parcel.currentStatus?.description?.trim() || events.at(-1)?.description || "UPS reports a delivery exception.") : null,
      };
    },
  };
}
