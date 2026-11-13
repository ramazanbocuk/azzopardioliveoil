# Product intelligence

Phase 4 of the master platform brief. Built on 2026-11-14.

## What is recorded

| About | Where it is entered | Fields |
|---|---|---|
| The product | Admin → Products → a product → "Origin, varieties and tasting" | Country of origin, region, producer, single variety or blend, olive varieties with optional shares, harvesting method, extraction method, aroma, taste, bitterness and pungency (0 to 5), food pairings, packaging |
| The harvest batch (lot) | Admin → Harvest batches | Lot number, harvest year, harvest date, grove, mill, milling, bottling and best-before dates, producer of that batch, internal supplier |
| Documents of a batch | Admin → Harvest batches → "Documents and laboratory results" | PDF upload (analysis report, certification, award, other), up to 4 MB |
| Laboratory results of a batch | Same screen | Measure, value, method, laboratory, test date, the document the value was read from |
| Reference lists | Admin → Producers, Countries & regions, Olive varieties | |

A product can have many batches. Each batch has its own harvest year, documents and laboratory results. Stock per batch is not built yet: it belongs to Phase 5.

**Measures with a fixed unit:** total polyphenols (mg/kg), hydroxytyrosol and derivatives (mg/kg), free acidity (% oleic acid), peroxide value (meq O₂/kg), K232, K270, ΔK, oleic acid (%). Any other measure can be entered with its own name and unit.

## The rules

1. **Nothing is inferred.** Choosing a variety or a region fills in no other field. No value is ever suggested as "typical" for a variety. An empty field is shown to customers as a dash.
2. **A measured value is shown to customers only when all of these hold:** the value names the laboratory and the test date; it is attached to an uploaded report; a manager has verified that report; a manager has verified the value against it; the batch is published.
3. **Two roles.** Day-to-day staff upload documents and type values. Only a traceability manager (or above) verifies, withdraws or removes them.
4. **A value is never edited.** A wrong one is removed and entered again, so the record of who verified what stays true. Every step is in the audit log.
5. **Withdrawing takes effect at once.** Withdrawing a verification, removing a report, hiding the product or unpublishing the batch removes the value and the file from the shop. Removing a report un-verifies every value read from it.
6. **Plausibility limits** reject a slipped decimal point (free acidity of 21 instead of 0.21). They are not quality limits.
7. **Uploads are checked by content.** Only a real PDF is accepted, whatever the file is called.
8. **A producer is named on the shop only when marked public.** Suppliers are never shown.

## What customers see

- On the product page: country, region, producer, varieties, type, harvest year and methods under "Origin & harvest"; a "Tasting notes" section; a "Laboratory analysis" section with a table of verified values for the current lot (value, method, laboratory, date, link to the report), or a sentence saying none has been published.
- Bitterness and pungency are labelled as the house's own tasting judgement, not laboratory values.
- In the lot lookup: harvest year and the verified values of that lot.
- All labels exist in the six languages. Free text (aroma, taste, pairings, methods, packaging) is translated per product in Admin → Translations.

## What the platform does not do

- **It makes no health claim.** It shows measured values and nothing else. Whether a claim may be made about a polyphenol content (in the EU, the UK or the USA) is for a food-law adviser. No such wording should be typed into a description without that advice.
- It does not check that an uploaded report is genuine, or that a typed value matches it. A person does, and is recorded as having done so.
- "Cold extraction" and similar label terms are regulated; the form warns, it does not enforce.
- No producer or variety pages on the shop yet; names only.
- No real data has been entered. Producers, varieties, batches and reports must come from the business.

## For developers

- `src/server/provenance.ts`: all services, the list of measures, `publicLabResults` (the only path by which a value reaches customers).
- `src/app/media/certificate/[id]/route.ts`: public file route; `src/app/admin/lots/[id]/document/[documentId]/route.ts`: staff file route.
- `src/server/storefrontData.ts`: adds `profile` and `lab` to each product.
- Storefront API: `lot { harvestYear }` and `LotRecord.labResults`.
- Migration `20261114150000_product_intelligence` (additive).
