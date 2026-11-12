import { exportCustomersCsv, exportNewsletterCsv, exportOrdersCsv } from "@/server/admin";
import { adminCtx } from "@/server/adminSession";
import { AppError } from "@/server/errors";

const EXPORTS = { customers: exportCustomersCsv, orders: exportOrdersCsv, newsletter: exportNewsletterCsv } as const;

/** CSV downloads. Each export checks the role itself and is written to the audit log. */
export async function GET(_request: Request, { params }: RouteContext<"/admin/export/[kind]">) {
  const { kind } = await params;
  const exporter = EXPORTS[kind as keyof typeof EXPORTS];
  if (!exporter) return new Response("Not found", { status: 404 });
  try {
    const csv = await exporter(await adminCtx());
    return new Response(`﻿${csv}`, {
      headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="azzopardi-${kind}-${new Date().toISOString().slice(0, 10)}.csv"`, "cache-control": "no-store" },
    });
  } catch (error) {
    if (error instanceof AppError) return new Response(error.message, { status: error.code === "UNAUTHENTICATED" ? 401 : 403 });
    throw error;
  }
}
