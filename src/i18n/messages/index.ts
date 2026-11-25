import type { Language } from "../config";
import { de } from "./de";
import { en, type Messages } from "./en";
import { es } from "./es";
import { fr } from "./fr";
import { it } from "./it";
import { ja } from "./ja";
import { ko } from "./ko";
import { nl } from "./nl";
import { zh } from "./zh";

/** Every language's interface text. Each file is typed against English, so none can lack a key. */
export const MESSAGES: Record<Language, Messages> = { en, de, nl, fr, it, es, ko, zh, ja };
export type { Messages };
