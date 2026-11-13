import Link from "next/link";
import { Badge, Card, Check, Field, Flash, Page, Stat, Submit, Table, TextArea, cellLink, dateTime } from "@/components/admin/ui";
import { adminCtx } from "@/server/adminSession";
import { assistantOverview } from "@/server/assistantAdmin";
import { can } from "@/server/permissions";
import { saveAssistant } from "../actions";

export const metadata = { title: "Customer assistant" };

const dollars = (micros: number) => `$${(micros / 1_000_000).toFixed(2)}`;

export default async function AssistantPage({ searchParams }: PageProps<"/admin/assistant">) {
  const ctx = await adminCtx();
  if (!ctx.admin) return null;
  const [data, params] = await Promise.all([assistantOverview(ctx), searchParams]);
  const mayChange = can(ctx.admin.role, "ADMINISTRATOR", "assistant");
  const rated = data.month.helpful + data.month.notHelpful;

  return (
    <Page title="Customer assistant" eyebrow="The AI chat on the shop">
      <Flash params={params} />
      <p className={data.state.available ? "border-l-2 border-olive-700 bg-olive-700/10 px-4 py-3 text-olive-900" : "border-l-2 border-terracotta-700 bg-terracotta-500/10 px-4 py-3 text-terracotta-700"}>
        {data.stateText}
        {data.state.model ? ` Model: ${data.state.model}.` : ""}
      </p>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Estimated cost this month" value={dollars(data.state.spentMicros)} note={data.state.budgetCents ? `of a $${(data.state.budgetCents / 100).toFixed(2)} budget. An estimate from token counts; the provider's invoice is the real figure.` : "No budget set."} />
        <Stat label="Conversations this month" value={String(data.month.conversations)} note={`${data.month.messages} customer messages`} />
        <Stat label="Passed to a person" value={String(data.month.handovers)} note="See Support requests" />
        <Stat label="Rated helpful" value={rated ? `${data.month.helpful} of ${rated}` : "—"} note={rated ? `${data.month.notHelpful} rated not helpful` : "No customer has rated a conversation yet."} />
      </div>

      <Card
        title="Settings"
        description="The assistant answers only while it is connected, switched on, and under its monthly budget. When the budget is used up it stops and the shop is emailed; it never spends beyond it. Administrators only."
      >
        <form action={saveAssistant} className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <Check label="Show the assistant on the shop" name="customerEnabled" defaultChecked={data.settings.customerEnabled} disabled={!mayChange} />
            <Check label="Let staff use the staff assistant" name="staffEnabled" defaultChecked={data.settings.staffEnabled} disabled={!mayChange} />
            <Field label="Monthly budget (US dollars)" name="monthlyBudgetDollars" inputMode="decimal" defaultValue={data.settings.monthlyBudgetCents ? (data.settings.monthlyBudgetCents / 100).toFixed(2) : ""} placeholder="50" disabled={!mayChange} hint="The provider bills in dollars. Counted across the calendar month." />
          </div>
          <TextArea
            label="A note from you to the assistant (optional)"
            name="extraInstructions"
            rows={4}
            maxLength={2000}
            defaultValue={data.settings.extraInstructions ?? ""}
            disabled={!mayChange}
            hint="Added to its standing instructions below; it cannot override them. Use it for things like “we are closed 24 December to 2 January”. Do not put health claims, prices or stock here: the assistant reads those from the shop's data."
          />
          {mayChange && <Submit>Save settings</Submit>}
        </form>
      </Card>

      <Card title="Conversations" description="The most recent, newest first. Guest conversations are deleted after 90 days. Customers are told that conversations are kept.">
        <Table head={["Last message", "Opened with", "Language", "Turns", "Tools", "Cost", "State"]} empty={data.recent.length === 0 ? "No conversation yet." : undefined}>
          {data.recent.map((conversation) => (
            <tr key={conversation.id}>
              <td className="whitespace-nowrap">
                <Link href={`/admin/assistant/${conversation.id}`} className={cellLink}>
                  {dateTime(conversation.updatedAt)}
                </Link>
              </td>
              <td className="max-w-80">{conversation.opening || "—"}</td>
              <td>{conversation.locale}</td>
              <td className="tabular-nums">{conversation.turns}</td>
              <td className="tabular-nums">{conversation.toolCalls}</td>
              <td className="tabular-nums">{dollars(conversation.costMicros)}</td>
              <td>
                {conversation.status === "HANDED_OVER" ? <Badge tone="UNPAID">Passed to a person</Badge> : <Badge tone="PAID">Open</Badge>}
                {conversation.rating !== null && <span className="text-small block text-stone-700">{conversation.rating > 0 ? "Rated helpful" : "Rated not helpful"}</span>}
              </td>
            </tr>
          ))}
        </Table>
      </Card>

      <div className="grid gap-8 xl:grid-cols-2">
        <Card title="What it can do" description="This is the complete list. The assistant has no other way to read or change anything, and none of these takes money, places an order or changes an address.">
          <Table head={["Tool", "Used this month", "Refused or failed"]}>
            {data.tools.map((tool) => {
              const usage = data.toolUsage.find((entry) => entry.name === tool.name);
              return (
                <tr key={tool.name}>
                  <td>
                    <span className="font-mono text-[0.8125rem]">{tool.name}</span>
                    <span className="text-small block text-stone-700">{tool.description}</span>
                  </td>
                  <td className="tabular-nums">{usage?.ok ?? 0}</td>
                  <td className="tabular-nums">{usage?.failed ?? 0}</td>
                </tr>
              );
            })}
          </Table>
        </Card>

        <Card title="Errors" description="Times the model provider could not answer. The customer was shown an apology and nothing else.">
          <Table head={["When", "What happened"]} empty={data.errors.length === 0 ? "No errors recorded." : undefined}>
            {data.errors.map((error) => (
              <tr key={error.id}>
                <td className="whitespace-nowrap">
                  <Link href={`/admin/assistant/${error.conversationId}`} className={cellLink}>
                    {dateTime(error.createdAt)}
                  </Link>
                </td>
                <td>{error.error}</td>
              </tr>
            ))}
          </Table>
        </Card>
      </div>

      <Card
        title="Staff assistant: every proposal"
        description={`The staff assistant cannot change money, stock or an order; it can only propose, and a person approves. This is every proposal it has made, to anyone. This month: ${data.staff.conversations} conversation(s), estimated cost $${(data.staff.spentMicros / 1_000_000).toFixed(2)}. ${data.staff.state.available ? "It is answering staff." : "It is not answering staff."}`}
      >
        <Table head={["When", "Ref", "Made to", "What", "State", "Outcome"]} empty={data.staff.proposals.length === 0 ? "No proposal has been made." : undefined}>
          {data.staff.proposals.map((proposal) => (
            <tr key={proposal.id}>
              <td className="whitespace-nowrap">
                <Link href={`/admin/assistant/${proposal.conversationId}`} className={cellLink}>
                  {dateTime(proposal.createdAt)}
                </Link>
              </td>
              <td className="whitespace-nowrap">{proposal.reference}</td>
              <td>{proposal.madeTo}</td>
              <td className="min-w-[18rem]">{proposal.summary}</td>
              <td className="whitespace-nowrap">{proposal.status}</td>
              <td>{proposal.result ?? "—"}</td>
            </tr>
          ))}
        </Table>
      </Card>

      <Card title="Its standing instructions" description="Exactly what the model is told before every conversation. These are part of the application and are changed by a developer, so that a rule such as “never invent a laboratory value” cannot be edited away from this screen.">
        <pre className="max-h-[32rem] overflow-auto whitespace-pre-wrap border border-ink/10 bg-stone-300/20 p-4 font-sans text-[0.875rem] leading-relaxed">{data.instructions}</pre>
      </Card>
    </Page>
  );
}
