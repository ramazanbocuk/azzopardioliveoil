import localFont from "next/font/local";

/**
 * Both families are self-hosted (Indian Type Foundry Free Font License, see
 * src/fonts/LICENSE-FFL.txt) so no visitor request ever reaches a font CDN.
 */
export const zodiak = localFont({
  src: [
    { path: "../fonts/Zodiak-Variable.woff2", style: "normal", weight: "100 900" },
    { path: "../fonts/Zodiak-VariableItalic.woff2", style: "italic", weight: "100 900" },
  ],
  variable: "--font-zodiak",
  display: "swap",
});

export const switzer = localFont({
  src: [
    { path: "../fonts/Switzer-Variable.woff2", style: "normal", weight: "100 900" },
    { path: "../fonts/Switzer-VariableItalic.woff2", style: "italic", weight: "100 900" },
  ],
  variable: "--font-switzer",
  display: "swap",
});
