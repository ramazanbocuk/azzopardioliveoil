/**
 * Shipping carriers.
 *
 * Every carrier is an adapter behind this one interface, so orders, checkout
 * and the admin screens never know which carrier they are talking to.
 *
 * Nothing here is simulated. An adapter only ever returns what the carrier's
 * own API returned: a rate, a label, a tracking number, a tracking event. A
 * carrier with no credentials is "not connected" and every call to it fails
 * with `CarrierNotConnected`; staff can still record a shipment by hand.
 *
 * STATUS — read before relying on any adapter:
 *   DHL Express   MyDHL API v3 (REST)          written from the official reference, NOT yet run against DHL
 *   FedEx         Ship/Rate/Track REST APIs     written from the official reference, NOT yet run against FedEx
 *   bpost         Shipping Manager API v5 (XML) written from integration manual v3.3.35, NOT yet run against bpost
 * Each needs a business account and API credentials. The first real call for
 * each carrier must be made in that carrier's test environment.
 */

export type Env = Record<string, string | undefined>;

export type Party = {
  name: string;
  company?: string | null;
  line1: string;
  line2?: string | null;
  postalCode: string;
  city: string;
  region?: string | null;
  countryCode: string;
  email?: string | null;
  phone?: string | null;
};

export type Box = { weightGrams: number; lengthMm?: number | null; widthMm?: number | null; heightMm?: number | null };

/** One kind of goods in the shipment, as customs wants it described. */
export type Commodity = { description: string; quantity: number; unitValueCents: number; unitWeightGrams: number; hsCode?: string | null; originCountry?: string | null };

export type ShipmentRequest = {
  /** Our reference, printed on the label where the carrier allows it. */
  reference: string;
  sender: Party;
  recipient: Party;
  boxes: Box[];
  commodities: Commodity[];
  currency: string;
  /** Value of the goods, for customs and carrier liability. */
  declaredValueCents: number;
  /** True when the parcel leaves the EU customs union and needs a customs declaration. */
  customs: boolean;
  shipDate: Date;
};

export type RateQuote = {
  carrier: string;
  carrierName: string;
  /** The carrier's own product code, passed back unchanged when booking. */
  service: string;
  serviceName: string;
  priceCents: number;
  currency: string;
  estimatedDelivery: Date | null;
};

export type BookedShipment = {
  /** The carrier's id for the booking, needed to cancel it. */
  carrierRef: string;
  trackingNumber: string;
  trackingUrl: string | null;
  /** One tracking number per box, in the order the boxes were given, when the carrier issues them. */
  boxTrackingNumbers: string[];
  /** Every label the carrier issued: one document for the whole shipment, or one per box. */
  labels: { mime: string; data: Buffer; trackingNumber?: string | null }[];
  costCents: number | null;
  estimatedDelivery: Date | null;
};

export type TrackingStatus = "IN_TRANSIT" | "DELIVERED" | "RETURNED" | "FAILED";
export type TrackingEvent = { at: Date; description: string; location?: string | null };
export type Tracking = { status: TrackingStatus | null; deliveredAt: Date | null; events: TrackingEvent[] };

export type CarrierService = { code: string; name: string };

export interface ShippingCarrier {
  readonly key: string;
  readonly name: string;
  /** Environment variables this carrier needs, for the Integrations screen. */
  readonly requires: string[];
  /** "test" or "production", as configured. */
  readonly environment: string;
  /** Services that can be booked without asking the carrier for rates first. */
  readonly services: CarrierService[];
  /** Live prices for this shipment. Null when the carrier has no rating API (prices come from the contract). */
  rates: ((request: ShipmentRequest) => Promise<RateQuote[]>) | null;
  /** Books the shipment with the carrier and returns its label. */
  book(request: ShipmentRequest, service: string): Promise<BookedShipment>;
  /** Cancels a booking. Null when the carrier offers no cancellation API. */
  cancel: ((booking: { carrierRef: string; trackingNumber: string; recipientCountryCode: string }) => Promise<void>) | null;
  track(trackingNumber: string): Promise<Tracking>;
}

export class CarrierNotConnected extends Error {
  constructor(carrier: string, missing: string[] = []) {
    super(`${carrier} is not connected${missing.length ? ` (missing ${missing.join(", ")})` : ""}. Record the shipment by hand, or add the carrier's credentials first.`);
    this.name = "CarrierNotConnected";
  }
}

/** The carrier answered, and refused. The message is the carrier's own, so staff can act on it. */
export class CarrierError extends Error {
  constructor(
    public readonly carrier: string,
    message: string,
    public readonly status?: number,
  ) {
    super(`${carrier}: ${message}`);
    this.name = "CarrierError";
  }
}

export type HttpResponse = { ok: boolean; status: number; text(): Promise<string> };
export type CarrierTransport = (url: string, init: { method: "GET" | "POST" | "PUT"; headers: Record<string, string>; body?: string }) => Promise<HttpResponse>;

export const defaultCarrierTransport: CarrierTransport = (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(30_000) });

/** Sends one request and returns the body text; turns network failures and refusals into a CarrierError carrying the carrier's message. */
export async function carrierCall(transport: CarrierTransport, carrier: string, url: string, init: Parameters<CarrierTransport>[1], describeError: (body: string) => string | null = () => null): Promise<string> {
  let response: HttpResponse;
  try {
    response = await transport(url, init);
  } catch (error) {
    throw new CarrierError(carrier, `could not be reached (${error instanceof Error ? error.message : "network error"}). Nothing was booked.`);
  }
  const body = await response.text().catch(() => "");
  if (!response.ok) throw new CarrierError(carrier, (describeError(body) ?? body.replace(/\s+/g, " ").trim().slice(0, 400)) || `HTTP ${response.status}`, response.status);
  return body;
}

export function parseJson<T>(carrier: string, body: string): T {
  try {
    return JSON.parse(body) as T;
  } catch {
    throw new CarrierError(carrier, "answered with something that is not JSON.");
  }
}

export const kg = (grams: number) => Math.max(0.01, Math.round(grams / 10) / 100);
export const cm = (mm: number | null | undefined) => (mm ? Math.max(1, Math.round(mm / 10)) : null);
export const amount = (cents: number) => Math.round(cents) / 100;
export const toCents = (value: unknown) => Math.round(Number(value) * 100);
export const basicAuth = (user: string, secret: string) => `Basic ${Buffer.from(`${user}:${secret}`).toString("base64")}`;
