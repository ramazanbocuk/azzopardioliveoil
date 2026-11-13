import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Card, LinkButton, Page, Table, cellLink, dateTime } from "@/components/admin/ui";
import { adminCtx } from "@/server/adminSession";
import { getConversation } from "@/server/assistantAdmin";
import { AppError } from "@/server/errors";

export const metadata = { title: "Conversation" };

export default async function ConversationPage({ params }: PageProps<"/admin/assistant/[id]">) {
  const ctx = await adminCtx();
  if (!ctx.admin) return null;
  const { id } = await params;
  const conversation = await getConversation(ctx, id).catch((error) => {
    if (error instanceof AppError && error.code === "NOT_FOUND") notFound();
    throw error;
  });

  return (
    <Page title="Conversation" eyebrow={`Started ${dateTime(conversation.createdAt)} · ${conversation.locale} · estimated cost $${(conversation.costMicros / 1_000_000).toFixed(4)}`} actions={<LinkButton href="/admin/assistant">All conversations</LinkButton>}>
      <div className="flex flex-wrap items-center gap-3">
        <Badge tone={conversation.status === "HANDED_OVER" ? "UNPAID" : "PAID"}>{conversation.status === "HANDED_OVER" ? "Passed to a person" : conversation.status}</Badge>
        {conversation.rating !== null && <span className="text-small text-stone-700">The customer rated it {conversation.rating > 0 ? "helpful" : "not helpful"}.</span>}
        <span className="text-small text-stone-700">
          {conversation.customer ? (
            <>
              Signed-in customer:{" "}
              <Link href={`/admin/customers/${conversation.customer.id}`} className={cellLink}>
                {conversation.customer.firstName} {conversation.customer.lastName}
              </Link>
            </>
          ) : (
            "Guest (not signed in)"
          )}
        </span>
      </div>

      {conversation.supportRequests.length > 0 && (
        <Card title="Passed to the team">
          {conversation.supportRequests.map((request) => (
            <p key={request.id}>
              <Link href="/admin/support" className={cellLink}>
                {request.reference}
              </Link>{" "}
              · {request.subject} · {request.status.toLowerCase()}
            </p>
          ))}
        </Card>
      )}

      <Card title="What was said">
        <ol className="space-y-5">
          {conversation.turns.map((turn) => (
            <li key={turn.id} className={turn.role === "user" ? "border-l-2 border-ink/30 pl-4" : turn.role === "error" ? "border-l-2 border-terracotta-700 pl-4 text-terracotta-700" : "border-l-2 border-olive-700 pl-4"}>
              <p className="text-small text-stone-700">
                {turn.role === "user" ? "Customer" : turn.role === "error" ? "Could not answer" : "Assistant"} · {dateTime(turn.at)}
                {turn.model ? ` · ${turn.model}` : ""}
                {turn.costMicros ? ` · $${(turn.costMicros / 1_000_000).toFixed(4)}` : ""}
                {turn.stopReason === "refusal" ? " · the model declined" : ""}
              </p>
              <p className="mt-1 whitespace-pre-wrap">{turn.text}</p>
            </li>
          ))}
        </ol>
      </Card>

      <Card title="What it looked up" description="Every tool the assistant used in this conversation, with what it asked for. “Refused” means the tool said no, for example a product that does not exist.">
        <Table head={["When", "Tool", "Asked for", "Result", "Took"]} empty={conversation.toolCalls.length === 0 ? "It used no tool." : undefined}>
          {conversation.toolCalls.map((call) => (
            <tr key={call.id}>
              <td className="whitespace-nowrap">{dateTime(call.createdAt)}</td>
              <td className="font-mono text-[0.8125rem]">{call.name}</td>
              <td className="max-w-96 break-words font-mono text-[0.75rem] text-stone-700">{JSON.stringify(call.input)}</td>
              <td>{call.ok ? "Answered" : `Refused: ${call.error}`}</td>
              <td className="whitespace-nowrap tabular-nums">{call.durationMs} ms</td>
            </tr>
          ))}
        </Table>
      </Card>
    </Page>
  );
}
