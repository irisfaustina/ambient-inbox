import { ThreadData, AgentInbox, ThreadStatusWithAll } from "../types";
import { GmailFastAPIClient } from "@/lib/client";

/**
 * Fetch Gmail threads and convert them to ThreadData format
 */
export async function fetchGmailThreads<
  ThreadValues extends Record<string, any>,
>(
  client: GmailFastAPIClient,
  selectedInbox: AgentInbox,
  _inbox: ThreadStatusWithAll,
  _limit: number,
  _offset: number
): Promise<ThreadData<ThreadValues>[]> {
  try {
    if (!selectedInbox.gmailConfig?.emailAddress) {
      throw new Error("Gmail email address not configured");
    }

    // Get users to see if the selected email is registered
    const users = await client.listUsers();
    const userExists = users.users?.some(
      (user: any) =>
        user.email_address === selectedInbox.gmailConfig?.emailAddress
    );

    if (!userExists) {
      throw new Error(
        `Gmail account ${selectedInbox.gmailConfig.emailAddress} is not registered`
      );
    }

    // Check Gmail agent status first
    const healthCheck = await client.healthCheck();
    console.log("Gmail agent health:", healthCheck);

    // Process email for this user (this will fetch and process recent emails)
    const result = await client.processEmail(
      selectedInbox.gmailConfig.emailAddress,
      undefined,
      true // auto_fetch = true
    );

    console.log("Gmail processing result:", result);

    // Convert Gmail API response to ThreadData format
    const mockThreadData: ThreadData<ThreadValues>[] = [];

    if (result.status === "success") {
      // Check if the result has interrupts (indicating human intervention needed)
      const hasInterrupts =
        result.result?.__interrupt__ && result.result.__interrupt__.length > 0;
      const threadStatus = hasInterrupts ? "interrupted" : "idle";

      // Create a thread representing the email processing result
      const thread = {
        thread_id: `gmail-${selectedInbox.gmailConfig.emailAddress}-${Date.now()}`,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        metadata: {
          email_address: selectedInbox.gmailConfig.emailAddress,
          source: "gmail-agent",
          email_subject: result.result?.email_input?.subject || "Email",
          email_from: result.result?.email_input?.from || "Unknown Sender",
        },
        status: threadStatus,
        config: {},
        values: result.result as ThreadValues,
      };

      // Extract interrupts from Gmail agent response
      const interrupts = hasInterrupts
        ? result.result.__interrupt__[0].value.map((interrupt: any) => ({
            action_request: interrupt.action_request,
            config: interrupt.config,
            description:
              interrupt.description ||
              `Email requires human review: ${result.result?.email_input?.subject || "Email"}`,
          }))
        : undefined;

      mockThreadData.push({
        status: threadStatus,
        thread: thread as any,
        interrupts: interrupts,
        invalidSchema: false,
      } as ThreadData<ThreadValues>);
    } else if (result.status === "no_emails") {
      // Create an informational thread to show the Gmail agent is working
      const infoThread = {
        thread_id: `gmail-info-${selectedInbox.gmailConfig.emailAddress}-${Date.now()}`,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        metadata: {
          email_address: selectedInbox.gmailConfig.emailAddress,
          source: "gmail-agent",
          info_type: "no_emails",
        },
        status: "idle",
        config: {},
        values: {
          message:
            "Gmail agent is monitoring your inbox. No new emails to process at this time.",
          email_address: selectedInbox.gmailConfig.emailAddress,
          last_checked: new Date().toISOString(),
        } as unknown as ThreadValues,
      };

      mockThreadData.push({
        status: "idle",
        thread: infoThread as any,
        interrupts: undefined,
        invalidSchema: false,
      } as ThreadData<ThreadValues>);
    }

    return mockThreadData;
  } catch (error) {
    console.error("Error fetching Gmail threads:", error);

    // Create an error thread to show what went wrong
    const emailAddress = selectedInbox.gmailConfig?.emailAddress || "unknown";
    const errorThread = {
      thread_id: `gmail-error-${emailAddress}-${Date.now()}`,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      metadata: {
        email_address: emailAddress,
        source: "gmail-agent",
        error_type: "processing_error",
      },
      status: "error",
      config: {},
      values: {
        error_message:
          error instanceof Error ? error.message : "Unknown error occurred",
        email_address: emailAddress,
        timestamp: new Date().toISOString(),
        troubleshooting:
          "Check Gmail agent logs and verify Gmail API token is valid",
      } as unknown as ThreadValues,
    };

    return [
      {
        status: "error" as any,
        thread: errorThread as any,
        interrupts: [
          {
            action_request: {
              action: "troubleshoot_gmail",
              args: {
                error: error instanceof Error ? error.message : String(error),
                email_address: emailAddress,
              },
            },
            config: {
              allow_ignore: true,
              allow_respond: false,
              allow_edit: false,
              allow_accept: false,
            },
            description: "Gmail integration error - check agent configuration",
          },
        ],
        invalidSchema: false,
      } as ThreadData<ThreadValues>,
    ];
  }
}
