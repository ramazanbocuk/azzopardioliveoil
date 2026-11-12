import { exportCustomersCsv, exportNewsletterCsv, exportOrdersCsv } from "@/server/admin";
import { exportInventoryCsv, exportLotTraceCsv, exportSalesCsv, exportVatCsv } from "@/server/backoffice";
import { adminCtx } from "@/server/adminSession";
import type { Ctx } from "@/server/context";
import { AppError } from "@/server/errors";

const EXPORTS = { customers: exportCustomersCsv, orders: exportOrdersCsv, newsletter: exportNewsletterCsv, inventory: exportInventoryCsv, sales: exportSalesCsv, vat: exportVatCsv, lot: exportLotTraceCsv } as const;

/** CSV downloads. Each export checks the role itself and is written to the audit log. */
export async function GET(request: Request, { params }: RouteContext<"/admin/export/[kind]">) {
  const { kind } = await params;
  const exporter = EXPORTS[kind as keyof typeof EXPORTS];
  if (!exporter) return new Response("Not found", { status: 404 });
  try {
    // Exports honour the filters or period of the screen they were opened from.
    const query = Object.fromEntries(new URL(request.url).searchParams);
    const ctx = await adminCtx();
    const csv = kind === "orders" ? await exportOrdersCsv(ctx, query) : kind === "sales" ? await exportSalesCsv(ctx, query) : kind === "vat" ? await exportVatCsv(ctx, query) : kind === "lot" ? await exportLotTraceCsv(ctx, query.lot ?? "") : await (exporter as (context: Ctx) => Promise<string>)(ctx);
    return new Response(`﻿${csv}`, {
      headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="azzopardi-${kind}-${new Date().toISOString().slice(0, 10)}.csv"`, "cache-control": "no-store" },
    });
  } catch (error) {
    if (error instanceof AppError) return new Response(error.message, { status: error.code === "UNAUTHENTICATED" ? 401 : 403 });
    throw error;
  }
}
