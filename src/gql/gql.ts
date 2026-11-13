/* eslint-disable */
import * as types from './graphql';
import type { TypedDocumentNode as DocumentNode } from '@graphql-typed-document-node/core';

/**
 * Map of all GraphQL operations in the project.
 *
 * This map has several performance disadvantages:
 * 1. It is not tree-shakeable, so it will include all operations in the project.
 * 2. It is not minifiable, so the string of a GraphQL query will be multiple times inside the bundle.
 * 3. It does not support dead code elimination, so it will add unused operations.
 *
 * Therefore it is highly recommended to use the babel or swc plugin for production.
 * Learn more about it here: https://the-guild.dev/graphql/codegen/plugins/presets/preset-client#reducing-bundle-size
 */
type Documents = {
    "\n  fragment CartFields on Cart {\n    itemCount\n    subtotalCents\n    discountCents\n    discountCode\n    freeShippingDiscount\n    lines {\n      sku\n      quantity\n      unitPriceCents\n      lineTotalCents\n      enoughStock\n      backorderQuantity\n      variant {\n        label\n        volumeMl\n      }\n      product {\n        slug\n        name\n      }\n    }\n  }\n": typeof types.CartFieldsFragmentDoc,
    "\n  query Cart {\n    cart {\n      ...CartFields\n    }\n  }\n": typeof types.CartDocument,
    "\n  mutation CartAdd($sku: String!, $quantity: Int!) {\n    cartAdd(sku: $sku, quantity: $quantity) {\n      ...CartFields\n    }\n  }\n": typeof types.CartAddDocument,
    "\n  mutation CartSetQuantity($sku: String!, $quantity: Int!) {\n    cartSetQuantity(sku: $sku, quantity: $quantity) {\n      ...CartFields\n    }\n  }\n": typeof types.CartSetQuantityDocument,
    "\n  mutation CartRemove($sku: String!) {\n    cartRemove(sku: $sku) {\n      ...CartFields\n    }\n  }\n": typeof types.CartRemoveDocument,
    "\n  mutation CartApplyDiscount($code: String!) {\n    cartApplyDiscount(code: $code) {\n      ...CartFields\n    }\n  }\n": typeof types.CartApplyDiscountDocument,
    "\n  mutation CartRemoveDiscount {\n    cartRemoveDiscount {\n      ...CartFields\n    }\n  }\n": typeof types.CartRemoveDiscountDocument,
    "\n  query ShippingOptions($countryCode: String!) {\n    shippingOptions(countryCode: $countryCode) {\n      id\n      name\n      estimate\n      priceCents\n    }\n    paymentAvailable\n  }\n": typeof types.ShippingOptionsDocument,
    "\n  mutation Checkout($input: CheckoutInput!) {\n    checkout(input: $input) {\n      number\n      accessToken\n    }\n  }\n": typeof types.CheckoutDocument,
    "\n  mutation StartPayment($number: String!, $token: String!) {\n    startPayment(number: $number, token: $token)\n  }\n": typeof types.StartPaymentDocument,
    "\n  fragment OrderFields on Order {\n    number\n    status\n    paymentStatus\n    email\n    placedAt\n    subtotalCents\n    discountCents\n    shippingCents\n    taxCents\n    totalCents\n    shippingRateName\n    shipName\n    shipLines\n    shipCountryCode\n    canRequestReturn\n    items {\n      sku\n      productName\n      variantLabel\n      lotNumber\n      quantity\n      lineTotalCents\n      shippedQuantity\n      cancelledQuantity\n      toFollow\n      awaitingStock\n    }\n    events {\n      kind\n      message\n      at\n    }\n    shipments {\n      carrier\n      status\n      trackingNumber\n      trackingUrl\n      shippedAt\n      deliveredAt\n      items {\n        sku\n        productName\n        variantLabel\n        quantity\n        lotNumber\n      }\n    }\n  }\n": typeof types.OrderFieldsFragmentDoc,
    "\n  query OrderByToken($number: String!, $token: String!) {\n    orderByToken(number: $number, token: $token) {\n      ...OrderFields\n    }\n    paymentAvailable\n  }\n": typeof types.OrderByTokenDocument,
    "\n  query TrackOrder($number: String!, $email: String!) {\n    order(number: $number, email: $email) {\n      ...OrderFields\n    }\n  }\n": typeof types.TrackOrderDocument,
    "\n  query Lot($lotNumber: String!) {\n    lot(lotNumber: $lotNumber) {\n      productName\n      productSlug\n      lot {\n        lotNumber\n        harvestYear\n        harvestDate\n        grove\n        mill\n        milledAt\n        bottledAt\n        bestBefore\n      }\n      documents {\n        kind\n        title\n        url\n      }\n      labResults {\n        measure\n        label\n        value\n        unit\n        decimals\n        laboratory\n        testedAt\n      }\n    }\n  }\n": typeof types.LotDocument,
    "\n  query Me {\n    me {\n      id\n      email\n      firstName\n      lastName\n      orders {\n        ...OrderFields\n      }\n    }\n  }\n": typeof types.MeDocument,
    "\n  mutation Login($email: String!, $password: String!) {\n    login(email: $email, password: $password) {\n      id\n    }\n  }\n": typeof types.LoginDocument,
    "\n  mutation Register($input: RegisterInput!) {\n    register(input: $input) {\n      id\n    }\n  }\n": typeof types.RegisterDocument,
    "\n  mutation Logout {\n    logout\n  }\n": typeof types.LogoutDocument,
    "\n  mutation RequestReturn($number: String!, $reason: String!) {\n    requestReturn(number: $number, reason: $reason)\n  }\n": typeof types.RequestReturnDocument,
    "\n  mutation SendContactMessage($name: String!, $email: String!, $reference: String, $message: String!) {\n    sendContactMessage(name: $name, email: $email, reference: $reference, message: $message)\n  }\n": typeof types.SendContactMessageDocument,
    "\n  mutation SubscribeNewsletter($email: String!) {\n    subscribeNewsletter(email: $email)\n  }\n": typeof types.SubscribeNewsletterDocument,
    "\n  mutation SetLanguage($locale: String!) {\n    setLanguage(locale: $locale)\n  }\n": typeof types.SetLanguageDocument,
    "\n  mutation RequestPasswordReset($email: String!) {\n    requestPasswordReset(email: $email)\n  }\n": typeof types.RequestPasswordResetDocument,
    "\n  mutation ResetPassword($id: String!, $exp: String!, $sig: String!, $password: String!) {\n    resetPassword(id: $id, exp: $exp, sig: $sig, password: $password)\n  }\n": typeof types.ResetPasswordDocument,
    "\n  query MyData {\n    myData\n  }\n": typeof types.MyDataDocument,
    "\n  mutation DeleteMyAccount($password: String!) {\n    deleteMyAccount(password: $password)\n  }\n": typeof types.DeleteMyAccountDocument,
};
const documents: Documents = {
    "\n  fragment CartFields on Cart {\n    itemCount\n    subtotalCents\n    discountCents\n    discountCode\n    freeShippingDiscount\n    lines {\n      sku\n      quantity\n      unitPriceCents\n      lineTotalCents\n      enoughStock\n      backorderQuantity\n      variant {\n        label\n        volumeMl\n      }\n      product {\n        slug\n        name\n      }\n    }\n  }\n": types.CartFieldsFragmentDoc,
    "\n  query Cart {\n    cart {\n      ...CartFields\n    }\n  }\n": types.CartDocument,
    "\n  mutation CartAdd($sku: String!, $quantity: Int!) {\n    cartAdd(sku: $sku, quantity: $quantity) {\n      ...CartFields\n    }\n  }\n": types.CartAddDocument,
    "\n  mutation CartSetQuantity($sku: String!, $quantity: Int!) {\n    cartSetQuantity(sku: $sku, quantity: $quantity) {\n      ...CartFields\n    }\n  }\n": types.CartSetQuantityDocument,
    "\n  mutation CartRemove($sku: String!) {\n    cartRemove(sku: $sku) {\n      ...CartFields\n    }\n  }\n": types.CartRemoveDocument,
    "\n  mutation CartApplyDiscount($code: String!) {\n    cartApplyDiscount(code: $code) {\n      ...CartFields\n    }\n  }\n": types.CartApplyDiscountDocument,
    "\n  mutation CartRemoveDiscount {\n    cartRemoveDiscount {\n      ...CartFields\n    }\n  }\n": types.CartRemoveDiscountDocument,
    "\n  query ShippingOptions($countryCode: String!) {\n    shippingOptions(countryCode: $countryCode) {\n      id\n      name\n      estimate\n      priceCents\n    }\n    paymentAvailable\n  }\n": types.ShippingOptionsDocument,
    "\n  mutation Checkout($input: CheckoutInput!) {\n    checkout(input: $input) {\n      number\n      accessToken\n    }\n  }\n": types.CheckoutDocument,
    "\n  mutation StartPayment($number: String!, $token: String!) {\n    startPayment(number: $number, token: $token)\n  }\n": types.StartPaymentDocument,
    "\n  fragment OrderFields on Order {\n    number\n    status\n    paymentStatus\n    email\n    placedAt\n    subtotalCents\n    discountCents\n    shippingCents\n    taxCents\n    totalCents\n    shippingRateName\n    shipName\n    shipLines\n    shipCountryCode\n    canRequestReturn\n    items {\n      sku\n      productName\n      variantLabel\n      lotNumber\n      quantity\n      lineTotalCents\n      shippedQuantity\n      cancelledQuantity\n      toFollow\n      awaitingStock\n    }\n    events {\n      kind\n      message\n      at\n    }\n    shipments {\n      carrier\n      status\n      trackingNumber\n      trackingUrl\n      shippedAt\n      deliveredAt\n      items {\n        sku\n        productName\n        variantLabel\n        quantity\n        lotNumber\n      }\n    }\n  }\n": types.OrderFieldsFragmentDoc,
    "\n  query OrderByToken($number: String!, $token: String!) {\n    orderByToken(number: $number, token: $token) {\n      ...OrderFields\n    }\n    paymentAvailable\n  }\n": types.OrderByTokenDocument,
    "\n  query TrackOrder($number: String!, $email: String!) {\n    order(number: $number, email: $email) {\n      ...OrderFields\n    }\n  }\n": types.TrackOrderDocument,
    "\n  query Lot($lotNumber: String!) {\n    lot(lotNumber: $lotNumber) {\n      productName\n      productSlug\n      lot {\n        lotNumber\n        harvestYear\n        harvestDate\n        grove\n        mill\n        milledAt\n        bottledAt\n        bestBefore\n      }\n      documents {\n        kind\n        title\n        url\n      }\n      labResults {\n        measure\n        label\n        value\n        unit\n        decimals\n        laboratory\n        testedAt\n      }\n    }\n  }\n": types.LotDocument,
    "\n  query Me {\n    me {\n      id\n      email\n      firstName\n      lastName\n      orders {\n        ...OrderFields\n      }\n    }\n  }\n": types.MeDocument,
    "\n  mutation Login($email: String!, $password: String!) {\n    login(email: $email, password: $password) {\n      id\n    }\n  }\n": types.LoginDocument,
    "\n  mutation Register($input: RegisterInput!) {\n    register(input: $input) {\n      id\n    }\n  }\n": types.RegisterDocument,
    "\n  mutation Logout {\n    logout\n  }\n": types.LogoutDocument,
    "\n  mutation RequestReturn($number: String!, $reason: String!) {\n    requestReturn(number: $number, reason: $reason)\n  }\n": types.RequestReturnDocument,
    "\n  mutation SendContactMessage($name: String!, $email: String!, $reference: String, $message: String!) {\n    sendContactMessage(name: $name, email: $email, reference: $reference, message: $message)\n  }\n": types.SendContactMessageDocument,
    "\n  mutation SubscribeNewsletter($email: String!) {\n    subscribeNewsletter(email: $email)\n  }\n": types.SubscribeNewsletterDocument,
    "\n  mutation SetLanguage($locale: String!) {\n    setLanguage(locale: $locale)\n  }\n": types.SetLanguageDocument,
    "\n  mutation RequestPasswordReset($email: String!) {\n    requestPasswordReset(email: $email)\n  }\n": types.RequestPasswordResetDocument,
    "\n  mutation ResetPassword($id: String!, $exp: String!, $sig: String!, $password: String!) {\n    resetPassword(id: $id, exp: $exp, sig: $sig, password: $password)\n  }\n": types.ResetPasswordDocument,
    "\n  query MyData {\n    myData\n  }\n": types.MyDataDocument,
    "\n  mutation DeleteMyAccount($password: String!) {\n    deleteMyAccount(password: $password)\n  }\n": types.DeleteMyAccountDocument,
};

/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 *
 *
 * @example
 * ```ts
 * const query = graphql(`query GetUser($id: ID!) { user(id: $id) { name } }`);
 * ```
 *
 * The query argument is unknown!
 * Please regenerate the types.
 */
export function graphql(source: string): unknown;

/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  fragment CartFields on Cart {\n    itemCount\n    subtotalCents\n    discountCents\n    discountCode\n    freeShippingDiscount\n    lines {\n      sku\n      quantity\n      unitPriceCents\n      lineTotalCents\n      enoughStock\n      backorderQuantity\n      variant {\n        label\n        volumeMl\n      }\n      product {\n        slug\n        name\n      }\n    }\n  }\n"): (typeof documents)["\n  fragment CartFields on Cart {\n    itemCount\n    subtotalCents\n    discountCents\n    discountCode\n    freeShippingDiscount\n    lines {\n      sku\n      quantity\n      unitPriceCents\n      lineTotalCents\n      enoughStock\n      backorderQuantity\n      variant {\n        label\n        volumeMl\n      }\n      product {\n        slug\n        name\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query Cart {\n    cart {\n      ...CartFields\n    }\n  }\n"): (typeof documents)["\n  query Cart {\n    cart {\n      ...CartFields\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation CartAdd($sku: String!, $quantity: Int!) {\n    cartAdd(sku: $sku, quantity: $quantity) {\n      ...CartFields\n    }\n  }\n"): (typeof documents)["\n  mutation CartAdd($sku: String!, $quantity: Int!) {\n    cartAdd(sku: $sku, quantity: $quantity) {\n      ...CartFields\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation CartSetQuantity($sku: String!, $quantity: Int!) {\n    cartSetQuantity(sku: $sku, quantity: $quantity) {\n      ...CartFields\n    }\n  }\n"): (typeof documents)["\n  mutation CartSetQuantity($sku: String!, $quantity: Int!) {\n    cartSetQuantity(sku: $sku, quantity: $quantity) {\n      ...CartFields\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation CartRemove($sku: String!) {\n    cartRemove(sku: $sku) {\n      ...CartFields\n    }\n  }\n"): (typeof documents)["\n  mutation CartRemove($sku: String!) {\n    cartRemove(sku: $sku) {\n      ...CartFields\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation CartApplyDiscount($code: String!) {\n    cartApplyDiscount(code: $code) {\n      ...CartFields\n    }\n  }\n"): (typeof documents)["\n  mutation CartApplyDiscount($code: String!) {\n    cartApplyDiscount(code: $code) {\n      ...CartFields\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation CartRemoveDiscount {\n    cartRemoveDiscount {\n      ...CartFields\n    }\n  }\n"): (typeof documents)["\n  mutation CartRemoveDiscount {\n    cartRemoveDiscount {\n      ...CartFields\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query ShippingOptions($countryCode: String!) {\n    shippingOptions(countryCode: $countryCode) {\n      id\n      name\n      estimate\n      priceCents\n    }\n    paymentAvailable\n  }\n"): (typeof documents)["\n  query ShippingOptions($countryCode: String!) {\n    shippingOptions(countryCode: $countryCode) {\n      id\n      name\n      estimate\n      priceCents\n    }\n    paymentAvailable\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation Checkout($input: CheckoutInput!) {\n    checkout(input: $input) {\n      number\n      accessToken\n    }\n  }\n"): (typeof documents)["\n  mutation Checkout($input: CheckoutInput!) {\n    checkout(input: $input) {\n      number\n      accessToken\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation StartPayment($number: String!, $token: String!) {\n    startPayment(number: $number, token: $token)\n  }\n"): (typeof documents)["\n  mutation StartPayment($number: String!, $token: String!) {\n    startPayment(number: $number, token: $token)\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  fragment OrderFields on Order {\n    number\n    status\n    paymentStatus\n    email\n    placedAt\n    subtotalCents\n    discountCents\n    shippingCents\n    taxCents\n    totalCents\n    shippingRateName\n    shipName\n    shipLines\n    shipCountryCode\n    canRequestReturn\n    items {\n      sku\n      productName\n      variantLabel\n      lotNumber\n      quantity\n      lineTotalCents\n      shippedQuantity\n      cancelledQuantity\n      toFollow\n      awaitingStock\n    }\n    events {\n      kind\n      message\n      at\n    }\n    shipments {\n      carrier\n      status\n      trackingNumber\n      trackingUrl\n      shippedAt\n      deliveredAt\n      items {\n        sku\n        productName\n        variantLabel\n        quantity\n        lotNumber\n      }\n    }\n  }\n"): (typeof documents)["\n  fragment OrderFields on Order {\n    number\n    status\n    paymentStatus\n    email\n    placedAt\n    subtotalCents\n    discountCents\n    shippingCents\n    taxCents\n    totalCents\n    shippingRateName\n    shipName\n    shipLines\n    shipCountryCode\n    canRequestReturn\n    items {\n      sku\n      productName\n      variantLabel\n      lotNumber\n      quantity\n      lineTotalCents\n      shippedQuantity\n      cancelledQuantity\n      toFollow\n      awaitingStock\n    }\n    events {\n      kind\n      message\n      at\n    }\n    shipments {\n      carrier\n      status\n      trackingNumber\n      trackingUrl\n      shippedAt\n      deliveredAt\n      items {\n        sku\n        productName\n        variantLabel\n        quantity\n        lotNumber\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query OrderByToken($number: String!, $token: String!) {\n    orderByToken(number: $number, token: $token) {\n      ...OrderFields\n    }\n    paymentAvailable\n  }\n"): (typeof documents)["\n  query OrderByToken($number: String!, $token: String!) {\n    orderByToken(number: $number, token: $token) {\n      ...OrderFields\n    }\n    paymentAvailable\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query TrackOrder($number: String!, $email: String!) {\n    order(number: $number, email: $email) {\n      ...OrderFields\n    }\n  }\n"): (typeof documents)["\n  query TrackOrder($number: String!, $email: String!) {\n    order(number: $number, email: $email) {\n      ...OrderFields\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query Lot($lotNumber: String!) {\n    lot(lotNumber: $lotNumber) {\n      productName\n      productSlug\n      lot {\n        lotNumber\n        harvestYear\n        harvestDate\n        grove\n        mill\n        milledAt\n        bottledAt\n        bestBefore\n      }\n      documents {\n        kind\n        title\n        url\n      }\n      labResults {\n        measure\n        label\n        value\n        unit\n        decimals\n        laboratory\n        testedAt\n      }\n    }\n  }\n"): (typeof documents)["\n  query Lot($lotNumber: String!) {\n    lot(lotNumber: $lotNumber) {\n      productName\n      productSlug\n      lot {\n        lotNumber\n        harvestYear\n        harvestDate\n        grove\n        mill\n        milledAt\n        bottledAt\n        bestBefore\n      }\n      documents {\n        kind\n        title\n        url\n      }\n      labResults {\n        measure\n        label\n        value\n        unit\n        decimals\n        laboratory\n        testedAt\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query Me {\n    me {\n      id\n      email\n      firstName\n      lastName\n      orders {\n        ...OrderFields\n      }\n    }\n  }\n"): (typeof documents)["\n  query Me {\n    me {\n      id\n      email\n      firstName\n      lastName\n      orders {\n        ...OrderFields\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation Login($email: String!, $password: String!) {\n    login(email: $email, password: $password) {\n      id\n    }\n  }\n"): (typeof documents)["\n  mutation Login($email: String!, $password: String!) {\n    login(email: $email, password: $password) {\n      id\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation Register($input: RegisterInput!) {\n    register(input: $input) {\n      id\n    }\n  }\n"): (typeof documents)["\n  mutation Register($input: RegisterInput!) {\n    register(input: $input) {\n      id\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation Logout {\n    logout\n  }\n"): (typeof documents)["\n  mutation Logout {\n    logout\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation RequestReturn($number: String!, $reason: String!) {\n    requestReturn(number: $number, reason: $reason)\n  }\n"): (typeof documents)["\n  mutation RequestReturn($number: String!, $reason: String!) {\n    requestReturn(number: $number, reason: $reason)\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation SendContactMessage($name: String!, $email: String!, $reference: String, $message: String!) {\n    sendContactMessage(name: $name, email: $email, reference: $reference, message: $message)\n  }\n"): (typeof documents)["\n  mutation SendContactMessage($name: String!, $email: String!, $reference: String, $message: String!) {\n    sendContactMessage(name: $name, email: $email, reference: $reference, message: $message)\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation SubscribeNewsletter($email: String!) {\n    subscribeNewsletter(email: $email)\n  }\n"): (typeof documents)["\n  mutation SubscribeNewsletter($email: String!) {\n    subscribeNewsletter(email: $email)\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation SetLanguage($locale: String!) {\n    setLanguage(locale: $locale)\n  }\n"): (typeof documents)["\n  mutation SetLanguage($locale: String!) {\n    setLanguage(locale: $locale)\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation RequestPasswordReset($email: String!) {\n    requestPasswordReset(email: $email)\n  }\n"): (typeof documents)["\n  mutation RequestPasswordReset($email: String!) {\n    requestPasswordReset(email: $email)\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation ResetPassword($id: String!, $exp: String!, $sig: String!, $password: String!) {\n    resetPassword(id: $id, exp: $exp, sig: $sig, password: $password)\n  }\n"): (typeof documents)["\n  mutation ResetPassword($id: String!, $exp: String!, $sig: String!, $password: String!) {\n    resetPassword(id: $id, exp: $exp, sig: $sig, password: $password)\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query MyData {\n    myData\n  }\n"): (typeof documents)["\n  query MyData {\n    myData\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation DeleteMyAccount($password: String!) {\n    deleteMyAccount(password: $password)\n  }\n"): (typeof documents)["\n  mutation DeleteMyAccount($password: String!) {\n    deleteMyAccount(password: $password)\n  }\n"];

export function graphql(source: string) {
  return (documents as any)[source] ?? {};
}

export type DocumentType<TDocumentNode extends DocumentNode<any, any>> = TDocumentNode extends DocumentNode<  infer TType,  any>  ? TType  : never;