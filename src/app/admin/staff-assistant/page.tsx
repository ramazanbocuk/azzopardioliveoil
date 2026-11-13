import { Card, LinkButton, Page, Table } from "@/components/admin/ui";
import { StaffAssistant } from "@/components/admin/StaffAssistant";
import { adminCtx } from "@/server/adminSession";
import { listMyProposals } from "@/server/ai/proposals";
import { STAFF_LIMITS, latestStaffConversation, staffAssistantState } from "@/server/ai/staffAssistant";
import { STAFF_TOOLS, TIER_TEXT, type Tier } from "@/server/ai/staffTools";
import { can } from "@/server/permissions";

export const metadata = { title: "Staff assistant" };

const WHY_NOT: Record<string, string> = {
  not_connected: "Not connected: no ANTHROPIC_API_KEY is set on the server.",
  switched_off: "Switched off. An administrator can switch it on under Customer assistant → Settings.",
  no_budget: "No monthly budget is set, so it does not answer.",
  budget_spent: "This month's budget for the assistants is used up. It starts again next month, or when an administrator raises the budget.",
};
const TIERS: { tier: Tier; title: string }[] = [
  { tier: "read", title: "Look up" },
  { tier: "draft", title: "Draft" },
  { tier: "propose", title: "Propose, for your approval" },
];

export default async function StaffAssistantPage() {
  const ctx = await adminCtx();
  if (!ctx.admin) return null;
  const [state, conversation, proposals] = await Promise.all([staffAssistantState(ctx.db), latestStaffConversation(ctx), listMyProposals(ctx)]);

  return (
    <Page title="Staff assistant" eyebrow="Finds things, drafts text and suggests changes for you to approve" actions={can(ctx.admin.role, "VIEW", "assistant") ? <LinkButton href="/admin/assistant">Settings and log</LinkButton> : undefined}>
      {!state.available && <Card title="The assistant is not answering">{WHY_NOT[state.reason] ?? "It is not available."} Proposals already made can still be approved or rejected below.</Card>}
      <p className="text-small text-stone-700">
        It is an AI and can be wrong: check what matters against the record it links to. It works with your own permissions and cannot do anything your role does not allow. What you write, and the order and customer details it looks up for you, are sent to the AI provider (Anthropic) to produce the answer. Conversations are kept for a year.
      </p>
      <StaffAssistant initial={conversation} waiting={proposals.waiting} decided={proposals.decided} maxChars={STAFF_LIMITS.messageChars} />
      <Card title="What it can do" description="This list is complete. There is no way for it to delete anything, change prices, tax, shipping rates, staff accounts, roles or settings, change a customer's address or payment details, publish anything, send a message, or book or cancel a shipment.">
        <div className="space-y-6">
          {TIERS.map(({ tier, title }) => (
            <div key={tier}>
              <h3 className="font-medium">{title}</h3>
              <p className="text-small mb-3 text-stone-700">{TIER_TEXT[tier]}</p>
              <Table head={["Tool", "What it does"]}>
                {STAFF_TOOLS.filter((tool) => tool.tier === tier).map((tool) => (
                  <tr key={tool.spec.name}>
                    <td className="whitespace-nowrap align-top font-mono text-[0.8125rem]">{tool.spec.name}</td>
                    <td className="align-top">{tool.spec.description}</td>
                  </tr>
                ))}
              </Table>
            </div>
          ))}
        </div>
      </Card>
    </Page>
  );
}
