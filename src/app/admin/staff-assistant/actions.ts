"use server";

import { updateTag } from "next/cache";
import { adminCtx } from "@/server/adminSession";
import { decideProposal, type ProposalView } from "@/server/ai/proposals";
import { closeStaffConversation, staffMessage, type StaffReply } from "@/server/ai/staffAssistant";
import { AppError } from "@/server/errors";

/**
 * Server actions for the staff assistant's page. Unlike the panel's forms
 * they answer in place, so the conversation stays on screen. Next.js rejects
 * server-action requests from other origins; every service checks the
 * session and the role again.
 */

const failure = (error: unknown): { error: string } => {
  if (!(error instanceof AppError)) console.error("[admin] staff assistant", error);
  return { error: error instanceof AppError ? error.message : "Something went wrong. Nothing was changed." };
};

export async function ask(conversationId: string | null, message: string): Promise<StaffReply | { error: string }> {
  try {
    return await staffMessage(await adminCtx(), { conversationId, message: String(message) });
  } catch (error) {
    return failure(error);
  }
}

export async function decide(proposalId: string, approve: boolean): Promise<{ proposal: ProposalView } | { error: string }> {
  try {
    const proposal = await decideProposal(await adminCtx(), String(proposalId), approve === true);
    // Stock shown on the shop may have changed.
    if (proposal.status === "EXECUTED" && proposal.kind !== "support_status") updateTag("catalog");
    return { proposal };
  } catch (error) {
    return failure(error);
  }
}

export async function startOver(conversationId: string): Promise<void> {
  try {
    await closeStaffConversation(await adminCtx(), String(conversationId));
  } catch (error) {
    failure(error);
  }
}
