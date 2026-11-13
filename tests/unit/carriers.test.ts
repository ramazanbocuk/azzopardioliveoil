import { describe, expect, it } from "vitest";
import { bpostOrderXml, createBpost, splitStreet, xml } from "@/server/shipping/bpost";
import { CarrierError, type CarrierTransport, type ShipmentRequest, type ShippingCarrier } from "@/server/shipping/carriers";
import { createDhlExpress, dhlDateTime } from "@/server/shipping/dhl";
import { createFedex } from "@/server/shipping/fedex";
import { createUps } from "@/server/shipping/ups";

/**
 * These tests pin the requests each adapter sends and how it reads the
 * carrier's documented response shapes. They do NOT prove a carrier accepts
 * the request: that needs a real call in the carrier's test environment.
 */

type Call = { url: string; method: string; headers: Record<string, string>; body?: string };
function fake(responses: (string | { status: number; body: string })[]) {
  const calls: Call[] = [];
  const transport: CarrierTransport = async (url, init) => {
    calls.push({ url, ...init });
    const next = responses.shift();
    if (next === undefined) throw new Error(`unexpected call to ${url}`);
    const { status, body } = typeof next === "string" ? { status: 200, body: next } : next;
    return { ok: status < 400, status, text: async () => body };
  };
  return { transport, calls };
}
const carrier = (result: ShippingCarrier | { missing: string[] }) => {
  if ("missing" in result) throw new Error(`missing ${result.missing}`);
  return result;
};

const sender = { name: "Azzopardi Olive Oil", company: "Azzopardi BV", line1: "Olijfstraat 12", postalCode: "1000", city: "Brussels", countryCode: "BE", phone: "+3221234567", email: "ship@example.test" };
const request = (over: Partial<ShipmentRequest> = {}): ShipmentRequest => ({
  reference: "AZZ-1001-1",
  sender,
  recipient: { name: "Ada Buyer", line1: "Hoofdstraat 5 bus 2", postalCode: "2000", city: "Antwerp", countryCode: "BE", email: "ada@example.test", phone: "+32470000000" },
  boxes: [{ weightGrams: 1250, lengthMm: 300, widthMm: 200, heightMm: 150 }],
  commodities: [{ description: "Extra Virgin Olive Oil 500 ml", quantity: 2, unitValueCents: 1800, unitWeightGrams: 950, hsCode: "150920", originCountry: "IT" }],
  currency: "EUR",
  declaredValueCents: 3600,
  customs: false,
  shipDate: new Date("2026-11-13T09:00:00Z"),
  labelFormat: "THERMAL",
  ...over,
});
const abroad = { name: "Sam Smith", line1: "12 High Street", postalCode: "SW1A 1AA", city: "London", countryCode: "GB", email: "sam@example.test", phone: "+447000000000" };
const PDF = Buffer.from("%PDF-1.4 test label").toString("base64");

describe("carrier registry rules", () => {
  it("reports exactly which credentials are missing, and never builds a half-configured carrier", () => {
    expect(createDhlExpress({ DHL_EXPRESS_API_KEY: "k" }, fake([]).transport)).toEqual({ missing: ["DHL_EXPRESS_API_SECRET", "DHL_EXPRESS_ACCOUNT_NUMBER"] });
    expect(createFedex({}, fake([]).transport)).toEqual({ missing: ["FEDEX_CLIENT_ID", "FEDEX_CLIENT_SECRET", "FEDEX_ACCOUNT_NUMBER"] });
    expect(createBpost({ BPOST_ACCOUNT_ID: "1" }, fake([]).transport)).toEqual({ missing: ["BPOST_PASSPHRASE"] });
  });
});

describe("DHL Express", () => {
  const env = { DHL_EXPRESS_API_KEY: "key", DHL_EXPRESS_API_SECRET: "secret", DHL_EXPRESS_ACCOUNT_NUMBER: "123456789" };

  it("formats ship dates in Belgian local time, as MyDHL requires", () => {
    expect(dhlDateTime(new Date("2026-11-13T09:00:00Z"))).toBe("2026-11-13T10:00:00 GMT+01:00");
    expect(dhlDateTime(new Date("2026-07-01T09:00:00Z"))).toBe("2026-07-01T11:00:00 GMT+02:00");
  });

  it("asks the test host for account rates and reads the billing-currency price", async () => {
    const { transport, calls } = fake([JSON.stringify({ products: [{ productCode: "U", productName: "EXPRESS WORLDWIDE", totalPrice: [{ currencyType: "BILLC", priceCurrency: "EUR", price: 21.4 }, { currencyType: "BASEC", priceCurrency: "USD", price: 23 }], deliveryCapabilities: { estimatedDeliveryDateAndTime: "2026-11-14T12:00:00" } }, { productCode: "X", productName: "No price", totalPrice: [{ currencyType: "BILLC", priceCurrency: "EUR", price: 0 }] }] })]);
    const quotes = await carrier(createDhlExpress(env, transport)).rates!(request());
    expect(quotes).toEqual([{ carrier: "dhl", carrierName: "DHL Express", service: "U", serviceName: "EXPRESS WORLDWIDE", priceCents: 2140, currency: "EUR", estimatedDelivery: new Date("2026-11-14T12:00:00") }]);
    expect(calls[0].url).toBe("https://express.api.dhl.com/mydhlapi/test/rates");
    expect(calls[0].headers.authorization).toBe(`Basic ${Buffer.from("key:secret").toString("base64")}`);
    expect(JSON.parse(calls[0].body!)).toMatchObject({ accounts: [{ typeCode: "shipper", number: "123456789" }], unitOfMeasurement: "metric", isCustomsDeclarable: false, packages: [{ weight: 1.25, dimensions: { length: 30, width: 20, height: 15 } }] });
  });

  it("books a shipment with a customs declaration and returns the carrier's tracking number and label", async () => {
    const { transport, calls } = fake([JSON.stringify({ shipmentTrackingNumber: "1234567890", packages: [{ trackingNumber: "JD0146000001" }], documents: [{ imageFormat: "PDF", content: PDF, typeCode: "label" }] })]);
    const booked = await carrier(createDhlExpress({ ...env, DHL_EXPRESS_ENV: "production" }, transport)).book(request({ recipient: abroad, customs: true }), "P");
    expect(booked).toMatchObject({ carrierRef: "1234567890", trackingNumber: "1234567890", boxTrackingNumbers: ["JD0146000001"], costCents: null });
    expect(booked.labels[0].mime).toBe("application/pdf");
    expect(booked.labels[0].data.toString()).toBe("%PDF-1.4 test label");
    expect(calls[0].url).toBe("https://express.api.dhl.com/mydhlapi/shipments");
    const body = JSON.parse(calls[0].body!);
    expect(body).toMatchObject({ productCode: "P", pickup: { isRequested: false }, outputImageProperties: { encodingFormat: "pdf" }, content: { isCustomsDeclarable: true, declaredValue: 36, declaredValueCurrency: "EUR", incoterm: "DAP" } });
    expect(body.content.exportDeclaration.lineItems[0]).toMatchObject({ price: 18, quantity: { value: 2 }, commodityCodes: [{ typeCode: "outbound", value: "150920" }], manufacturerCountry: "IT" });
    expect(body.customerDetails.receiverDetails.postalAddress).toMatchObject({ postalCode: "SW1A 1AA", cityName: "London", countryCode: "GB" });
  });

  it("passes DHL's own error on, and refuses a response without a label", async () => {
    const refused = fake([{ status: 422, body: JSON.stringify({ detail: "Invalid postal code", additionalDetails: ["receiverDetails.postalCode"] }) }]);
    await expect(carrier(createDhlExpress(env, refused.transport)).book(request(), "N")).rejects.toThrow("DHL Express: Invalid postal code — receiverDetails.postalCode");
    const empty = fake([JSON.stringify({ shipmentTrackingNumber: "1" })]);
    await expect(carrier(createDhlExpress(env, empty.transport)).book(request(), "N")).rejects.toBeInstanceOf(CarrierError);
    expect(carrier(createDhlExpress(env, empty.transport)).cancel).toBeNull(); // MyDHL has no cancel-shipment operation
  });

  it("reads tracking events and delivery", async () => {
    const { transport } = fake([JSON.stringify({ shipments: [{ status: "Success", events: [{ date: "2026-11-13", time: "18:00:00", description: "Shipment picked up", serviceArea: [{ description: "Brussels" }] }, { date: "2026-11-14", time: "11:30:00", description: "Delivered" }] }] })]);
    const tracking = await carrier(createDhlExpress(env, transport)).track("1234567890");
    expect(tracking.status).toBe("DELIVERED");
    expect(tracking.events).toHaveLength(2);
    expect(tracking.deliveredAt).toEqual(new Date("2026-11-14T11:30:00"));
  });
});

describe("FedEx", () => {
  const env = { FEDEX_CLIENT_ID: "id", FEDEX_CLIENT_SECRET: "secret", FEDEX_ACCOUNT_NUMBER: "740561073" };
  const token = JSON.stringify({ access_token: "tok", expires_in: 3600 });

  it("fetches one OAuth token, reuses it, and reads account rates", async () => {
    const rates = JSON.stringify({ output: { rateReplyDetails: [{ serviceType: "FEDEX_INTERNATIONAL_PRIORITY", serviceName: "FedEx International Priority", ratedShipmentDetails: [{ rateType: "LIST", totalNetCharge: 60, currency: "EUR" }, { rateType: "ACCOUNT", totalNetCharge: 41.35, currency: "EUR" }], commit: { dateDetail: { dayFormat: "2026-11-16T12:00:00" } } }] } });
    const { transport, calls } = fake([token, rates, rates]);
    const fedex = carrier(createFedex(env, transport));
    const quotes = await fedex.rates!(request({ recipient: abroad, customs: true }));
    await fedex.rates!(request({ recipient: abroad, customs: true }));
    expect(quotes).toMatchObject([{ carrier: "fedex", service: "FEDEX_INTERNATIONAL_PRIORITY", priceCents: 4135, currency: "EUR" }]);
    expect(calls.map((call) => call.url)).toEqual(["https://apis-sandbox.fedex.com/oauth/token", "https://apis-sandbox.fedex.com/rate/v1/rates/quotes", "https://apis-sandbox.fedex.com/rate/v1/rates/quotes"]);
    expect(calls[0].body).toBe("grant_type=client_credentials&client_id=id&client_secret=secret");
    expect(calls[1].headers.authorization).toBe("Bearer tok");
    expect(JSON.parse(calls[1].body!)).toMatchObject({ accountNumber: { value: "740561073" }, requestedShipment: { rateRequestType: ["ACCOUNT"], requestedPackageLineItems: [{ weight: { units: "KG", value: 1.25 }, dimensions: { length: 30, width: 20, height: 15, units: "CM" } }] } });
  });

  it("books with an inline PDF label, then cancels by tracking number", async () => {
    const ship = JSON.stringify({ output: { transactionShipments: [{ masterTrackingNumber: "794644790138", pieceResponses: [{ trackingNumber: "794644790138", packageDocuments: [{ encodedLabel: PDF, contentType: "LABEL" }] }], completedShipmentDetail: { shipmentRating: { shipmentRateDetails: [{ totalNetCharge: 41.35 }] } } }] } });
    const { transport, calls } = fake([token, ship, JSON.stringify({ output: { cancelledShipment: true } })]);
    const fedex = carrier(createFedex(env, transport));
    const booked = await fedex.book(request({ recipient: abroad, customs: true }), "FEDEX_INTERNATIONAL_PRIORITY");
    expect(booked).toMatchObject({ trackingNumber: "794644790138", boxTrackingNumbers: ["794644790138"], costCents: 4135 });
    expect(booked.labels).toHaveLength(1);
    const body = JSON.parse(calls[1].body!);
    expect(calls[1].url).toBe("https://apis-sandbox.fedex.com/ship/v1/shipments");
    expect(body).toMatchObject({ labelResponseOptions: "LABEL", shipAction: "CONFIRM", accountNumber: { value: "740561073" }, requestedShipment: { serviceType: "FEDEX_INTERNATIONAL_PRIORITY", labelSpecification: { imageType: "PDF" }, shippingChargesPayment: { paymentType: "SENDER" } } });
    expect(body.requestedShipment.customsClearanceDetail.commodities[0]).toMatchObject({ harmonizedCode: "150920", countryOfManufacture: "IT", quantity: 2, customsValue: { amount: 36, currency: "EUR" } });

    await fedex.cancel!({ carrierRef: "794644790138", trackingNumber: "794644790138", recipientCountryCode: "GB" });
    expect([calls[2].method, calls[2].url]).toEqual(["PUT", "https://apis-sandbox.fedex.com/ship/v1/shipments/cancel"]);
    expect(JSON.parse(calls[2].body!)).toMatchObject({ trackingNumber: "794644790138", accountNumber: { value: "740561073" } });
  });

  it("passes FedEx's own errors on", async () => {
    const { transport } = fake([token, { status: 400, body: JSON.stringify({ errors: [{ code: "SHIPPER.POSTALCODE.INVALID", message: "Shipper postal code is invalid." }] }) }]);
    await expect(carrier(createFedex(env, transport)).book(request(), "PRIORITY_OVERNIGHT")).rejects.toThrow("FedEx: SHIPPER.POSTALCODE.INVALID: Shipper postal code is invalid.");
  });

  it("reads tracking scans and the delivery time", async () => {
    const { transport } = fake([token, JSON.stringify({ output: { completeTrackResults: [{ trackResults: [{ latestStatusDetail: { code: "DL" }, scanEvents: [{ date: "2026-11-16T10:00:00+00:00", eventDescription: "Delivered", scanLocation: { city: "LONDON", countryCode: "GB" } }, { date: "2026-11-14T08:00:00+01:00", eventDescription: "Picked up" }], dateAndTimes: [{ type: "ACTUAL_DELIVERY", dateTime: "2026-11-16T10:00:00+00:00" }] }] }] } })]);
    const tracking = await carrier(createFedex(env, transport)).track("794644790138");
    expect(tracking).toMatchObject({ status: "DELIVERED", deliveredAt: new Date("2026-11-16T10:00:00Z") });
    expect(tracking.events.map((event) => event.description)).toEqual(["Picked up", "Delivered"]);
  });
});

describe("bpost", () => {
  const env = { BPOST_ACCOUNT_ID: "123456", BPOST_PASSPHRASE: "pass" };

  it("splits street and house number, and refuses an address without one", () => {
    expect(splitStreet("Rue de la Loi 16")).toEqual({ street: "Rue de la Loi", number: "16", box: null });
    expect(splitStreet("Hoofdstraat 5 bus 2")).toEqual({ street: "Hoofdstraat", number: "5", box: "bus 2" });
    expect(splitStreet("Olijfstraat 12A")).toEqual({ street: "Olijfstraat", number: "12A", box: null });
    expect(() => splitStreet("Kasteel zonder nummer")).toThrow(CarrierError);
    expect(xml(`Tom & "Jerry" <b>`)).toBe("Tom &amp; &quot;Jerry&quot; &lt;b&gt;");
  });

  it("builds a national order and an international one with customs content", () => {
    const national = bpostOrderXml("123456", request(), "bpack 24h Pro");
    expect(national).toContain("<tns:accountId>123456</tns:accountId><tns:reference>AZZ-1001-1</tns:reference>");
    expect(national).toContain("<tns:nationalBox><atHome><product>bpack 24h Pro</product>");
    expect(national).toContain("<weight>1250</weight><receiver><common:name>Ada Buyer</common:name><common:address><common:streetName>Hoofdstraat</common:streetName><common:number>5</common:number><common:box>bus 2</common:box><common:postalCode>2000</common:postalCode>");
    expect(national).toContain('xmlns:tns="http://schema.post.be/shm/deepintegration/v5/"');

    const world = bpostOrderXml("123456", request({ recipient: { ...abroad, line1: "High Street 12" }, customs: true }), "bpack World Business");
    expect(world).toContain("<international:product>bpack World Business</international:product>");
    expect(world).toContain("<international:parcelWeight>1250</international:parcelWeight>");
    expect(world).toContain("<international:hsTariffCode>150920</international:hsTariffCode><international:originOfGoods>IT</international:originOfGoods>");
    expect(world).toContain("<international:shipmentType>GOODS</international:shipmentType>");

    expect(() => bpostOrderXml("123456", request(), "bpack World Business")).toThrow(/within Belgium/);
    expect(() => bpostOrderXml("123456", request({ recipient: { ...abroad, line1: "High Street 12" } }), "bpack 24h Pro")).toThrow(/Belgium only/);
  });

  it("creates the order, fetches its labels, and uses the barcode as the tracking number", async () => {
    const labels = `<labels xmlns="http://schema.post.be/shm/deepintegration/v3/"><label><barcode>323212345678901234567890</barcode><mimeType>APPLICATION_PDF</mimeType><bytes>${PDF}</bytes></label></labels>`;
    const { transport, calls } = fake(["", labels, ""]);
    const bpost = carrier(createBpost(env, transport));
    const booked = await bpost.book(request(), "bpack 24h Pro");
    expect(booked).toMatchObject({ carrierRef: "AZZ-1001-1", trackingNumber: "323212345678901234567890", boxTrackingNumbers: ["323212345678901234567890"], costCents: null });
    expect(booked.labels[0].data.toString()).toBe("%PDF-1.4 test label");
    expect(calls.map((call) => [call.method, call.url])).toEqual([["POST", "https://shm-rest.bpost.cloud/services/shm/123456/orders"], ["GET", "https://shm-rest.bpost.cloud/services/shm/123456/orders/AZZ-1001-1/labels/A6"]]);
    expect(calls[0].headers).toMatchObject({ authorization: `Basic ${Buffer.from("123456:pass").toString("base64")}`, "content-type": "application/vnd.bpost.shm-order-v5+XML" });
    expect(calls[1].headers.accept).toBe("application/vnd.bpost.shm-label-pdf-v3.4+XML");
    expect(bpost.rates).toBeNull();

    await bpost.cancel!({ carrierRef: "AZZ-1001-1", trackingNumber: "x", recipientCountryCode: "BE" });
    expect(calls[2]).toMatchObject({ method: "POST", url: "https://shm-rest.bpost.cloud/services/shm/123456/orders/AZZ-1001-1" });
    expect(calls[2].body).toContain("<status>CANCELLED</status>");
  });

  it("reads tracking states", async () => {
    const body = `<itemTracking><stateInfo><time>2026-11-13T18:00:00+01:00</time><stateCode>1</stateCode><stateDescription>Parcel received</stateDescription></stateInfo><stateInfo><time>2026-11-14T10:15:00+01:00</time><stateDescription>Delivered</stateDescription></stateInfo><deliveryTime>2026-11-14T10:15:00+01:00</deliveryTime></itemTracking>`;
    const { transport, calls } = fake([body]);
    const tracking = await carrier(createBpost(env, transport)).track("3232");
    expect(tracking).toMatchObject({ status: "DELIVERED", deliveredAt: new Date("2026-11-14T09:15:00Z") });
    expect(tracking.events).toHaveLength(2);
    expect(calls[0].url).toBe("https://api.parcel.bpost.cloud/services/trackedmail/item/3232/trackingInfo");
  });
});

describe("UPS", () => {
  const env = { UPS_CLIENT_ID: "id", UPS_CLIENT_SECRET: "secret", UPS_ACCOUNT_NUMBER: "A1B2C3" };
  const token = JSON.stringify({ access_token: "tok", expires_in: "14399", token_type: "Bearer" });
  const GIF = Buffer.from("GIF89a test label").toString("base64");

  it("is not built without all three credentials, and uses the test environment unless told otherwise", () => {
    expect(createUps({ UPS_CLIENT_ID: "id" }, fake([]).transport)).toEqual({ missing: ["UPS_CLIENT_SECRET", "UPS_ACCOUNT_NUMBER"] });
    expect(carrier(createUps(env, fake([]).transport)).environment).toBe("test");
    expect(carrier(createUps({ ...env, UPS_ENV: "production" }, fake([]).transport)).environment).toBe("production");
  });

  it("signs in once with the account number, then asks for the account's own prices", async () => {
    const rates = JSON.stringify({ RateResponse: { RatedShipment: [
      { Service: { Code: "11" }, TotalCharges: { CurrencyCode: "EUR", MonetaryValue: "19.80" }, NegotiatedRateCharges: { TotalCharge: { CurrencyCode: "EUR", MonetaryValue: "12.45" } }, TimeInTransit: { ServiceSummary: { EstimatedArrival: { Arrival: { Date: "20261117", Time: "233000" } } } } },
      { Service: { Code: "65" }, TotalCharges: { CurrencyCode: "EUR", MonetaryValue: "31.10" } },
      { Service: { Code: "07" }, TotalCharges: { CurrencyCode: "EUR", MonetaryValue: "0" } },
    ] } });
    const { transport, calls } = fake([token, rates, rates]);
    const ups = carrier(createUps(env, transport));
    const quotes = await ups.rates!(request({ recipient: abroad, customs: true }));
    await ups.rates!(request());

    expect(quotes).toEqual([
      { carrier: "ups", carrierName: "UPS", service: "11", serviceName: "UPS Standard", priceCents: 1245, currency: "EUR", estimatedDelivery: new Date("2026-11-17T23:30:00Z") },
      { carrier: "ups", carrierName: "UPS", service: "65", serviceName: "UPS Express Saver", priceCents: 3110, currency: "EUR", estimatedDelivery: null },
    ]); // the negotiated price where UPS gives one; a zero price is not an offer
    expect(calls.map((call) => [call.method, call.url])).toEqual([["POST", "https://wwwcie.ups.com/security/v1/oauth/token"], ["POST", "https://wwwcie.ups.com/api/rating/v2409/Shoptimeintransit"], ["POST", "https://wwwcie.ups.com/api/rating/v2409/Shoptimeintransit"]]);
    expect(calls[0].headers).toMatchObject({ authorization: `Basic ${Buffer.from("id:secret").toString("base64")}`, "x-merchant-id": "A1B2C3", "content-type": "application/x-www-form-urlencoded" });
    expect(calls[0].body).toBe("grant_type=client_credentials");
    expect(calls[1].headers).toMatchObject({ authorization: "Bearer tok", transactionSrc: "azzopardi" });
    expect(calls[1].headers.transId).toMatch(/^[0-9a-f]{32}$/);
    expect(calls[1].headers.transId).not.toBe(calls[2].headers.transId);
    const sent = JSON.parse(calls[1].body!).RateRequest.Shipment;
    expect(sent.Shipper).toMatchObject({ ShipperNumber: "A1B2C3", Address: { City: "Brussels", PostalCode: "1000", CountryCode: "BE" } });
    expect(sent.ShipmentRatingOptions).toEqual({ NegotiatedRatesIndicator: "Y" });
    expect(sent.Package).toEqual([{ PackagingType: { Code: "02" }, Dimensions: { UnitOfMeasurement: { Code: "CM" }, Length: "30", Width: "20", Height: "15" }, PackageWeight: { UnitOfMeasurement: { Code: "KGS" }, Weight: "1.25" } }]);
  });

  it("books a shipment, reads one label per box, and adds a commercial invoice only when the parcel leaves the EU", async () => {
    const shipped = JSON.stringify({ ShipmentResponse: { ShipmentResults: { ShipmentIdentificationNumber: "1Z999AA10123456784", ShipmentCharges: { TotalCharges: { CurrencyCode: "EUR", MonetaryValue: "25.00" } }, NegotiatedRateCharges: { TotalCharge: { CurrencyCode: "EUR", MonetaryValue: "17.30" } }, PackageResults: [{ TrackingNumber: "1Z999AA10123456784", ShippingLabel: { ImageFormat: { Code: "GIF" }, GraphicImage: GIF } }, { TrackingNumber: "1Z999AA10123456795", ShippingLabel: { ImageFormat: { Code: "GIF" }, GraphicImage: GIF } }] } } });
    const { transport, calls } = fake([token, shipped, shipped, JSON.stringify({ VoidShipmentResponse: { SummaryResult: { Status: { Code: "1", Description: "Voided" } } } })]);
    const ups = carrier(createUps(env, transport));
    const two = [{ weightGrams: 1250 }, { weightGrams: 900 }];
    const booked = await ups.book(request({ recipient: abroad, customs: true, boxes: two }), "65");

    expect(booked).toMatchObject({ carrierRef: "1Z999AA10123456784", trackingNumber: "1Z999AA10123456784", trackingUrl: "https://www.ups.com/track?tracknum=1Z999AA10123456784", boxTrackingNumbers: ["1Z999AA10123456784", "1Z999AA10123456795"], costCents: 1730, estimatedDelivery: null });
    expect(booked.labels.map((label) => [label.mime, label.data.toString(), label.trackingNumber])).toEqual([["image/gif", "GIF89a test label", "1Z999AA10123456784"], ["image/gif", "GIF89a test label", "1Z999AA10123456795"]]);
    expect(calls[1].url).toBe("https://wwwcie.ups.com/api/shipments/v2409/ship");
    const sent = JSON.parse(calls[1].body!).ShipmentRequest;
    expect(sent.LabelSpecification).toEqual({ LabelImageFormat: { Code: "GIF" }, LabelStockSize: { Height: "6", Width: "4" } });
    expect(sent.Shipment).toMatchObject({ Service: { Code: "65" }, Shipper: { ShipperNumber: "A1B2C3", Name: "Azzopardi BV", AttentionName: "Azzopardi Olive Oil" }, ShipTo: { Name: "Sam Smith", Address: { CountryCode: "GB" } }, PaymentInformation: { ShipmentCharge: [{ Type: "01", BillShipper: { AccountNumber: "A1B2C3" } }] } });
    expect(sent.Shipment.Package).toHaveLength(2);
    expect(sent.Shipment.ShipmentServiceOptions.InternationalForms).toMatchObject({ FormType: "01", ReasonForExport: "SALE", CurrencyCode: "EUR", InvoiceDate: "20261113", Product: [{ Description: "Extra Virgin Olive Oil 500 ml", Unit: { Number: "2", UnitOfMeasurement: { Code: "PCS" }, Value: "18" }, CommodityCode: "150920", OriginCountryCode: "IT" }] });

    await ups.book(request(), "11"); // within the EU: no customs paperwork is sent
    expect(JSON.parse(calls[2].body!).ShipmentRequest.Shipment.ShipmentServiceOptions).toBeUndefined();

    await ups.cancel!({ carrierRef: "1Z999AA10123456784", trackingNumber: "1Z999AA10123456784", recipientCountryCode: "GB" });
    expect([calls[3].method, calls[3].url, calls[3].body]).toEqual(["DELETE", "https://wwwcie.ups.com/api/shipments/v2409/void/cancel/1Z999AA10123456784", undefined]);
  });

  it("reads tracking in UTC, and tells a passing problem from a final outcome", async () => {
    const activity = (type: string, description: string, gmtDate: string, gmtTime: string, city = "Brussels") => ({ date: gmtDate, time: gmtTime, gmtDate, gmtTime, location: { address: { city, countryCode: "BE" } }, status: { type, description, code: type } });
    const answer = (currentType: string, currentText: string, activities: object[], extra: object = {}) => JSON.stringify({ trackResponse: { shipment: [{ package: [{ trackingNumber: "1Z", currentStatus: { type: currentType, description: currentText }, activity: activities, ...extra }] }] } });
    const label = activity("M", "Shipper created a label, UPS has not received the package yet. ", "20261113", "090000");
    const pickup = activity("P", "Pickup Scan", "20261113", "170000");
    const exception = activity("X", "The receiver was not available. A second attempt will be made.", "20261116", "101500", "London");
    const out = activity("O", "Out For Delivery Today", "20261117", "070000", "London");
    const done = activity("D", "DELIVERED ", "20261117", "113000", "London");
    const { transport, calls } = fake([token, answer("M", "Label created", [label]), answer("X", "The receiver was not available.", [exception, pickup, label]), answer("D", "Delivered", [done, out, exception, pickup, label], { deliveryDate: [{ type: "DEL", date: "20261117" }], deliveryTime: { type: "DEL", endTime: "113000" } }), answer("RS", "Returned to shipper", [activity("RS", "Returning to sender", "20261120", "080000")]), JSON.stringify({ trackResponse: { shipment: [{ warnings: [{ code: "TW0001", message: "Tracking Information Not Found" }] }] } })]);
    const ups = carrier(createUps(env, transport));

    expect(await ups.track("1Z")).toMatchObject({ status: null, problem: null, events: [{ kind: "INFO", code: "M" }] }); // a label is not a moving parcel
    const stuck = await ups.track("1Z");
    expect(stuck).toMatchObject({ status: "IN_TRANSIT", deliveredAt: null, problem: "The receiver was not available." });
    expect(stuck.events.map((event) => [event.at.toISOString(), event.kind, event.location])).toEqual([["2026-11-13T09:00:00.000Z", "INFO", "Brussels, BE"], ["2026-11-13T17:00:00.000Z", "INFO", "Brussels, BE"], ["2026-11-16T10:15:00.000Z", "EXCEPTION", "London, BE"]]);
    expect(await ups.track("1Z")).toMatchObject({ status: "DELIVERED", deliveredAt: new Date("2026-11-17T11:30:00Z"), problem: null });
    expect(await ups.track("1Z")).toMatchObject({ status: "RETURNED", events: [{ kind: "RETURNED" }] });
    await expect(ups.track("1Z")).rejects.toThrow("UPS: Tracking Information Not Found");
    expect(calls[1].url).toBe("https://wwwcie.ups.com/api/track/v1/details/1Z?locale=en_US&returnSignature=false");
    expect(calls[1].method).toBe("GET");
  });

  it("passes UPS's own errors on, and proves its credentials without booking anything", async () => {
    const refusedBooking = fake([token, { status: 400, body: JSON.stringify({ response: { errors: [{ code: "120100", message: "Missing or invalid shipper number" }] } }) }]);
    await expect(carrier(createUps(env, refusedBooking.transport)).book(request(), "11")).rejects.toThrow("UPS: 120100: Missing or invalid shipper number");

    const badSecret = fake([{ status: 401, body: JSON.stringify({ response: { errors: [{ code: "10401", message: "ClientId is Invalid" }] } }) }]);
    await expect(carrier(createUps(env, badSecret.transport)).ping!()).rejects.toThrow("UPS: 10401: ClientId is Invalid");
    const good = fake([token]);
    await carrier(createUps(env, good.transport)).ping!();
    expect(good.calls).toHaveLength(1); // one sign-in, nothing booked

    const empty = fake([token, JSON.stringify({ ShipmentResponse: { ShipmentResults: { ShipmentIdentificationNumber: "1Z" } } })]);
    await expect(carrier(createUps(env, empty.transport)).book(request(), "11")).rejects.toBeInstanceOf(CarrierError); // a booking with no label is not a booking
  });
});
