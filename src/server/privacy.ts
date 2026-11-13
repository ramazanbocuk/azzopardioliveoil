import type { Db } from "./db";

/**
 * GDPR erasure, shared by the customer's own "delete my account" and the
 * administrator's erasure tool. Personal data is removed from the account,
 * its sessions, addresses, favourites and reviews. Orders are kept, because
 * invoices must be retained by law, but are detached from the account.
 */
export async function eraseCustomerData(db: Db, id: string): Promise<void> {
  await db.$transaction([
    db.customerSession.deleteMany({ where: { customerId: id } }),
    db.address.deleteMany({ where: { customerId: id } }),
    db.favourite.deleteMany({ where: { customerId: id } }),
    db.review.deleteMany({ where: { customerId: id } }),
    db.cart.deleteMany({ where: { customerId: id } }),
    db.customerNote.deleteMany({ where: { customerId: id } }),
    // Conversations with the assistant go with the account; a request staff are still answering keeps its text but loses the link.
    db.aiConversation.deleteMany({ where: { customerId: id } }),
    db.supportRequest.updateMany({ where: { customerId: id }, data: { customerId: null, email: `erased-${id}@invalid`, name: null } }),
    db.order.updateMany({ where: { customerId: id }, data: { customerId: null } }),
    db.customer.update({ where: { id }, data: { email: `erased-${id}@invalid`, firstName: "Erased", lastName: "Customer", phone: null, passwordHash: "erased", marketingOptIn: false, erasedAt: new Date(), tags: [], wholesaleStatus: "NONE", companyName: null, companyVatNumber: null, wholesaleDiscountBps: 0, wholesaleNote: null } }),
  ]);
}

/** Everything held about a customer, in a portable form (GDPR right of access and portability). */
export async function exportCustomerData(db: Db, id: string) {
  const customer = await db.customer.findUniqueOrThrow({
    where: { id },
    include: { notes: { orderBy: { createdAt: "asc" } }, addresses: true, favourites: { include: { variant: { select: { sku: true } } } }, reviews: true, orders: { include: { items: true, shipments: true }, orderBy: { placedAt: "desc" } } },
  });
  const newsletter = await db.newsletterSubscriber.findUnique({ where: { email: customer.email } });
  const [conversations, supportRequests] = await Promise.all([
    db.aiConversation.findMany({ where: { customerId: id }, orderBy: { createdAt: "asc" }, include: { messages: { where: { role: { in: ["user", "assistant"] }, NOT: { text: "" } }, orderBy: { createdAt: "asc" }, select: { role: true, text: true, createdAt: true } } } }),
    db.supportRequest.findMany({ where: { customerId: id }, orderBy: { createdAt: "asc" } }),
  ]);
  return {
    exportedAt: new Date().toISOString(),
    account: { email: customer.email, firstName: customer.firstName, lastName: customer.lastName, phone: customer.phone, language: customer.locale, marketingOptIn: customer.marketingOptIn, createdAt: customer.createdAt },
    newsletter: newsletter ? { status: newsletter.status, consentAt: newsletter.consentAt } : null,
    addresses: customer.addresses.map((a) => ({ firstName: a.firstName, lastName: a.lastName, line1: a.line1, line2: a.line2, postalCode: a.postalCode, city: a.city, region: a.region, countryCode: a.countryCode, phone: a.phone })),
    // What the shop has recorded about the person, beyond what they entered themselves.
    tags: customer.tags,
    wholesale: customer.wholesaleStatus === "NONE" ? null : { status: customer.wholesaleStatus, companyName: customer.companyName, companyVatNumber: customer.companyVatNumber, discountPercent: customer.wholesaleDiscountBps / 100 },
    staffNotes: customer.notes.map((note) => ({ body: note.body, createdAt: note.createdAt })),
    // Conversations with the AI assistant, as written, and questions passed to the team.
    assistantConversations: conversations.map((conversation) => ({ startedAt: conversation.createdAt, language: conversation.locale, messages: conversation.messages.map((message) => ({ from: message.role === "user" ? "you" : "assistant", text: message.text, at: message.createdAt })) })),
    supportRequests: supportRequests.map((request) => ({ subject: request.subject, body: request.body, orderNumber: request.orderNumber, status: request.status, createdAt: request.createdAt })),
    favouriteSkus: customer.favourites.map((favourite) => favourite.variant.sku),
    reviews: customer.reviews.map((review) => ({ rating: review.rating, title: review.title, body: review.body, status: review.status, createdAt: review.createdAt })),
    orders: customer.orders.map((order) => ({
      number: order.number,
      placedAt: order.placedAt,
      status: order.status,
      paymentStatus: order.paymentStatus,
      totalCents: order.totalCents,
      currency: order.currency,
      deliveryAddress: [`${order.shipFirstName} ${order.shipLastName}`, order.shipLine1, order.shipLine2, `${order.shipPostalCode} ${order.shipCity}`, order.shipCountryCode].filter(Boolean),
      items: order.items.map((item) => ({ sku: item.sku, name: `${item.productName} ${item.variantLabel}`, quantity: item.quantity, lineTotalCents: item.lineTotalCents, lot: item.lotNumber })),
      shipments: order.shipments.map((shipment) => ({ carrier: shipment.carrier, trackingNumber: shipment.trackingNumber, shippedAt: shipment.shippedAt })),
    })),
  };
}
