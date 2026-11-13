import { notFound } from "next/navigation";

/** Any address inside a locale that no page answers shows that locale's "not found" page. */
export default function Unmatched() {
  notFound();
}
