/**
 * Shipping carriers.
 *
 * Every carrier is an adapter behind this one interface, so bpost, DHL, UPS
 * or an aggregator such as Sendcloud can be added without touching orders,
 * checkout or the admin screens.
 *
 * STATUS: only the "manual" carrier exists. Staff type the carrier name and
 * tracking details when an order ships (see markShipped in admin.ts).
 * No carrier API is connected and none is simulated: creating labels and
 * reading tracking events needs a contract and credentials with the carrier.
 *
 *   bpost       Shipping Manager account + API credentials     not built
 *   DHL         DHL Parcel / eCommerce business account + key  not built
 *   UPS         UPS account + OAuth client                     not built
 *   Sendcloud   Sendcloud account + API key (covers the above) not built — recommended first
 */

export type ParcelRequest = {
  orderNumber: string;
  recipient: { name: string; line1: string; line2?: string | null; postalCode: string; city: string; countryCode: string; email: string; phone?: string | null };
  weightGrams: number;
  /** Required for destinations outside the EU customs union. */
  customs?: { description: string; hsCode: string; originCountry: string; valueCents: number; currency: string };
};

export type Label = { trackingNumber: string; trackingUrl: string; labelPdfUrl: string };
export type TrackingEvent = { at: Date; status: "IN_TRANSIT" | "DELIVERED" | "RETURNED" | "FAILED"; description: string };

export interface ShippingCarrier {
  readonly key: string;
  readonly name: string;
  /** Books a parcel and returns its label. */
  createLabel(parcel: ParcelRequest): Promise<Label>;
  /** Current tracking history for a parcel. */
  track(trackingNumber: string): Promise<TrackingEvent[]>;
}

export class CarrierNotConnected extends Error {
  constructor(carrier: string) {
    super(`${carrier} is not connected. Enter tracking details by hand, or connect the carrier first.`);
    this.name = "CarrierNotConnected";
  }
}

const registry = new Map<string, ShippingCarrier>();

/** Adapters register themselves here once implemented and configured. */
export function registerCarrier(carrier: ShippingCarrier) {
  registry.set(carrier.key, carrier);
}

export function getCarrier(key: string): ShippingCarrier {
  const carrier = registry.get(key);
  if (!carrier) throw new CarrierNotConnected(key);
  return carrier;
}

export function connectedCarriers(): ShippingCarrier[] {
  return [...registry.values()];
}
