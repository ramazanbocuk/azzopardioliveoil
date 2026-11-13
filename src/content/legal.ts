/**
 * DRAFT LEGAL TEMPLATES — not legal advice and not ready to publish.
 *
 * These outline the sections each document normally needs for a Belgian
 * online shop selling food to EU consumers. Square brackets mark facts only
 * the business can supply. Every page must be completed and reviewed by a
 * qualified adviser before launch.
 */

export type LegalDoc = { title: string; intro: string; sections: { heading: string; body: string[]; list?: string[] }[] };

export const privacyPolicy: LegalDoc = {
  title: "Privacy policy",
  intro: "How Azzopardi Olive Oil collects, uses and protects personal data.",
  sections: [
    { heading: "Who is responsible", body: ["[Legal entity name], [registered address], enterprise number [number], is the controller of your personal data. Contact: [privacy email address]."] },
    {
      heading: "What we collect, and why",
      body: ["We collect only what is needed to run the shop:"],
      list: [
        "Order data (name, address, email, phone if given, items ordered) — to fulfil your contract with us.",
        "Payment status and transaction reference — to confirm payment. Card details are handled by our payment provider and never reach our servers.",
        "Account data (email, hashed password, saved addresses) — if you choose to create an account.",
        "Newsletter email address — only with your consent, which you can withdraw at any time.",
        "Technical logs — to keep the site secure.",
      ],
    },
    { heading: "Who receives your data", body: ["Service providers acting on our instructions: [payment provider], [carrier or shipping platform], [email provider], [hosting provider]. Order notifications are sent to the business by email and WhatsApp. We do not sell personal data."] },
    { heading: "How long we keep it", body: ["Order and invoice records are kept for the period required by Belgian accounting and tax law: [period]. Account data is kept until you delete your account. Newsletter data is kept until you unsubscribe."] },
    { heading: "Your rights", body: ["Under the GDPR you may ask to access, correct, export or delete your data, and to restrict or object to its use. You can do this from your account or by contacting us. You may also lodge a complaint with the Belgian Data Protection Authority."] },
    { heading: "Transfers outside the EEA", body: ["[State whether any provider processes data outside the EEA, and the safeguard used.]"] },
  ],
};

export const cookiePolicy: LegalDoc = {
  title: "Cookie policy",
  intro: "Which cookies and similar storage this site uses.",
  sections: [
    { heading: "Strictly necessary", body: ["These keep the shop working: your cart, your sign-in session and your cookie choice. They do not require consent."], list: ["Cart and favourites — stored in your browser.", "Session cookie — set when you sign in.", "Consent record — remembers your choice."] },
    { heading: "Analytics and marketing", body: ["None are in use at present. If any are added, they will be listed here by name, purpose and lifetime, and will only be set after you agree."] },
    { heading: "Changing your choice", body: ["There is currently nothing optional to accept or refuse. If optional cookies are ever added, this site will ask first, and you will be able to change your choice at any time."] },
  ],
};

export const terms: LegalDoc = {
  title: "Terms & conditions",
  intro: "The conditions that apply when you order from Azzopardi Olive Oil.",
  sections: [
    { heading: "Seller", body: ["[Legal entity name], [registered address], enterprise number [number], VAT [number]. Contact: [email], [phone]."] },
    { heading: "Products and prices", body: ["Prices are shown in euro. [State whether prices include VAT and how VAT is applied by destination.] Shipping costs are shown before you confirm an order."] },
    { heading: "Ordering and payment", body: ["An order is confirmed once payment has been received and you have been sent a confirmation email. Accepted payment methods: [list]."] },
    { heading: "Delivery", body: ["We deliver to the destinations listed at checkout. Delivery times are estimates. Risk passes to you when the parcel is delivered."] },
    { heading: "Right of withdrawal", body: ["Consumers in the EU generally have 14 days from delivery to withdraw from a distance purchase. [Set out the procedure, who pays return shipping, and any exceptions that apply to these goods — to be confirmed by a legal adviser.]"] },
    { heading: "Conformity and complaints", body: ["The legal guarantee of conformity applies. If a bottle arrives damaged or is not what you ordered, contact us with your order number and a photograph."] },
    { heading: "Governing law and disputes", body: ["[Governing law and competent courts.] Consumers may also use the EU online dispute resolution platform."] },
  ],
};

export const shippingReturns: LegalDoc = {
  title: "Shipping & returns",
  intro: "Where we send orders, what it costs, and how to return a bottle.",
  sections: [
    { heading: "Where we ship", body: ["At launch we plan to deliver to Belgium, Luxembourg, the Netherlands, France, Germany and Italy, with other EU destinations to follow. Destinations outside the EU are not offered until customs and food-import requirements have been confirmed for each."] },
    { heading: "Rates and delivery times", body: ["Rates depend on destination and parcel weight and are shown at checkout before you pay. [Insert the rate table and delivery estimates once carrier contracts are in place.] The figures currently shown on this site are placeholders."] },
    { heading: "Tracking", body: ["Every parcel is tracked. You receive a tracking link by email when your order is handed to the carrier, and you can follow it from the order tracking page."] },
    { heading: "Damaged or missing parcels", body: ["Glass travels well when packed properly, but accidents happen. If a bottle arrives broken, send us your order number and a photograph within [number] days and we will replace it or refund you."] },
    { heading: "Returns", body: ["[Set out the return window, the condition goods must be in, who pays return shipping, and how refunds are made.] Returns are requested from your account or by contacting us."] },
  ],
};
