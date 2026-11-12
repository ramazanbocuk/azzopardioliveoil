import type { CodegenConfig } from "@graphql-codegen/cli";

/**
 * Generates typed documents for every storefront operation in src/lib/operations.ts.
 * Run `npm run codegen` after changing the schema or an operation.
 */
const config: CodegenConfig = {
  schema: "docs/schema.storefront.graphql",
  documents: ["src/lib/operations.ts"],
  generates: {
    "src/gql/": {
      preset: "client",
      presetConfig: { fragmentMasking: false },
      config: { useTypeImports: true, enumsAsTypes: true },
    },
  },
};

export default config;
