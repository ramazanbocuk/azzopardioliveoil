import Link from "next/link";
import { Badge, Card, Flash, LinkButton, Page, Submit, cellLink, dateTime } from "@/components/admin/ui";
import { adminCtx } from "@/server/adminSession";
import { listReviews } from "@/server/backoffice";
import { reviewStatus } from "../actions";

export const metadata = { title: "Reviews" };

export default async function ReviewsPage({ searchParams }: PageProps<"/admin/reviews">) {
  const ctx = await adminCtx();
  if (!ctx.admin) return null;
  const params = await searchParams;
  const status = typeof params.status === "string" ? params.status : "";
  const { rows, counts } = await listReviews(ctx, status);

  return (
    <Page title="Reviews" eyebrow={`${counts.PENDING} waiting for a decision`}>
      <Flash params={params} />
      <div className="flex flex-wrap gap-2">
        <LinkButton href="/admin/reviews" variant={status ? "secondary" : "primary"}>All ({counts.PENDING + counts.APPROVED + counts.REJECTED})</LinkButton>
        <LinkButton href="/admin/reviews?status=PENDING" variant={status === "PENDING" ? "primary" : "secondary"}>Pending ({counts.PENDING})</LinkButton>
        <LinkButton href="/admin/reviews?status=APPROVED" variant={status === "APPROVED" ? "primary" : "secondary"}>Published ({counts.APPROVED})</LinkButton>
        <LinkButton href="/admin/reviews?status=REJECTED" variant={status === "REJECTED" ? "primary" : "secondary"}>Rejected ({counts.REJECTED})</LinkButton>
      </div>
      <Card description="Only customers with a delivered order can review a product, once each. A review appears on the shop only after it is approved. Reviews are published or rejected as written: they are never edited.">
        {rows.length === 0 && <p className="py-6 text-center text-stone-700">No reviews here.</p>}
        <ul className="divide-y divide-ink/10">
          {rows.map((review) => (
            <li key={review.id} className="flex flex-wrap items-start justify-between gap-6 py-5">
              <div className="max-w-[70ch]">
                <p className="flex flex-wrap items-center gap-3">
                  <Badge tone={review.status === "APPROVED" ? "PAID" : review.status === "REJECTED" ? "FAILED" : "UNPAID"}>{review.status === "APPROVED" ? "PUBLISHED" : review.status}</Badge>
                  <span aria-label={`${review.rating} out of 5`} className="tracking-widest text-gold-700">
                    {"★".repeat(review.rating)}
                    <span className="text-ink/25">{"★".repeat(5 - review.rating)}</span>
                  </span>
                  <Link href={`/products/${review.product.slug}`} className={cellLink} target="_blank">
                    {review.product.name}
                  </Link>
                </p>
                {review.title && <p className="mt-3 font-medium">{review.title}</p>}
                <p className="mt-1 whitespace-pre-wrap">{review.body}</p>
                <p className="text-small mt-2 text-stone-700">
                  {review.customer.firstName} {review.customer.lastName} · {review.customer.email} · {dateTime(review.createdAt)} ·{" "}
                  <Link href={`/admin/orders/${review.orderId}`} className={cellLink}>
                    the order
                  </Link>
                </p>
              </div>
              <div className="flex gap-2">
                <form action={reviewStatus.bind(null, review.id, "APPROVED")}>
                  <Submit disabled={review.status === "APPROVED"}>Approve</Submit>
                </form>
                <form action={reviewStatus.bind(null, review.id, "REJECTED")}>
                  <Submit variant="danger" disabled={review.status === "REJECTED"}>Reject</Submit>
                </form>
              </div>
            </li>
          ))}
        </ul>
      </Card>
    </Page>
  );
}
