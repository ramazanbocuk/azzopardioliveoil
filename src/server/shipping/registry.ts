import { createBpost } from "./bpost";
import { CarrierNotConnected, defaultCarrierTransport, type CarrierTransport, type Env, type ShippingCarrier } from "./carriers";
import { createDhlExpress } from "./dhl";
import { createFedex } from "./fedex";
import { createUps } from "./ups";

/**
 * Which carriers exist and which are connected. A carrier is connected when
 * all of its credentials are in the server environment; nothing else makes it
 * appear, and nothing fakes one.
 */

const FACTORIES = [
  { key: "bpost", name: "bpost", create: createBpost },
  { key: "dhl", name: "DHL Express", create: createDhlExpress },
  { key: "ups", name: "UPS", create: createUps },
  { key: "fedex", name: "FedEx", create: createFedex },
] as const;

export type CarrierState = { key: string; name: string; connected: boolean; missing: string[]; environment: string | null; hasRates: boolean; canCancel: boolean; canTest: boolean };

let override: ShippingCarrier[] | null = null;
let cached: { env: Env; carriers: ShippingCarrier[]; states: CarrierState[] } | null = null;

/** Tests substitute fake carriers; production reads the environment. */
export function setCarriers(carriers: ShippingCarrier[] | null) {
  override = carriers;
}

function load(env: Env, transport: CarrierTransport) {
  if (cached && cached.env === env) return cached;
  const carriers: ShippingCarrier[] = [];
  const states: CarrierState[] = [];
  for (const factory of FACTORIES) {
    const result = factory.create(env, transport);
    if ("missing" in result) states.push({ key: factory.key, name: factory.name, connected: false, missing: result.missing, environment: null, hasRates: false, canCancel: false, canTest: false });
    else {
      carriers.push(result);
      states.push({ key: result.key, name: result.name, connected: true, missing: [], environment: result.environment, hasRates: result.rates !== null, canCancel: result.cancel !== null, canTest: !!result.ping });
    }
  }
  cached = { env, carriers, states };
  return cached;
}

export function connectedCarriers(env: Env = process.env, transport: CarrierTransport = defaultCarrierTransport): ShippingCarrier[] {
  return override ?? load(env, transport).carriers;
}

export function carrierStates(env: Env = process.env): CarrierState[] {
  if (override) return override.map((carrier) => ({ key: carrier.key, name: carrier.name, connected: true, missing: [], environment: carrier.environment, hasRates: carrier.rates !== null, canCancel: carrier.cancel !== null, canTest: !!carrier.ping }));
  return load(env, defaultCarrierTransport).states;
}

export function getCarrier(key: string): ShippingCarrier {
  const carrier = connectedCarriers().find((candidate) => candidate.key === key);
  if (!carrier) throw new CarrierNotConnected(FACTORIES.find((factory) => factory.key === key)?.name ?? key, carrierStates().find((state) => state.key === key)?.missing);
  return carrier;
}
