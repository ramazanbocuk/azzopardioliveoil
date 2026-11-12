import { after } from "next/server";

/**
 * Runs work after the HTTP response has been sent. Outside a Next.js request
 * (tests, scripts) there is no response to wait for, so the work starts now.
 */
export function afterResponse(work: () => Promise<unknown>, label: string) {
  const safe = () => work().catch((error) => console.error(`[jobs] ${label} failed`, error));
  try {
    after(safe);
  } catch {
    void safe();
  }
}
