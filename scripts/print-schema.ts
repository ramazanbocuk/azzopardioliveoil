/** Writes both GraphQL schemas as SDL into docs/, the reference for API consumers. */
import { writeFileSync } from "node:fs";
import { lexicographicSortSchema, printSchema } from "graphql";
import { adminSchema } from "../src/graphql/admin";
import { storefrontSchema } from "../src/graphql/storefront";

writeFileSync("docs/schema.storefront.graphql", printSchema(lexicographicSortSchema(storefrontSchema)) + "\n");
writeFileSync("docs/schema.admin.graphql", printSchema(lexicographicSortSchema(adminSchema)) + "\n");
console.log("Wrote docs/schema.storefront.graphql and docs/schema.admin.graphql");
