import type { Language } from "../config";
import { de } from "./de";
import { en, type Messages } from "./en";
import { es } from "./es";
import { fr } from "./fr";
import { it } from "./it";
import { nl } from "./nl";

/** Every language's interface text. Each file is typed against English, so none can lack a key. */
export const MESSAGES: Record<Language, Messages> = { en, de, nl, fr, it, es };
export type { Messages };
