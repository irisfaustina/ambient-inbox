import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Plus, Mail, Workflow } from "lucide-react";
import { AddAgentInboxDialog } from "./add-agent-inbox-dialog";
import { GmailAuthDialog } from "./gmail-auth-dialog";
import { useThreadsContext } from "../contexts/ThreadContext";
import { AgentInbox } from "../types";

export function AddInboxDropdown({
  langchainApiKey,
  handleChangeLangChainApiKey,
}: {
  langchainApiKey?: string;
  handleChangeLangChainApiKey?: (
    e: React.ChangeEvent<HTMLInputElement>
  ) => void;
}) {
  const { addAgentInbox } = useThreadsContext();

  const handleGmailSuccess = (inbox: Partial<AgentInbox>) => {
    // Convert to full AgentInbox and add it
    const fullInbox: AgentInbox = {
      ...inbox,
      id: inbox.id!,
      graphId: inbox.graphId!,
      deploymentUrl: inbox.deploymentUrl!,
      selected: inbox.selected!,
      createdAt: inbox.createdAt!,
    };

    addAgentInbox(fullInbox);

    // Force page reload to ensure the new inbox appears
    window.location.reload();
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline">
          <Plus className="mr-2 h-4 w-4" />
          Add Inbox
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-56">
        <AddAgentInboxDialog
          hideTrigger
          langchainApiKey={langchainApiKey}
          handleChangeLangChainApiKey={handleChangeLangChainApiKey}
        >
          <DropdownMenuItem onSelect={(e) => e.preventDefault()}>
            <Workflow className="mr-2 h-4 w-4" />
            <span>LangGraph Agent</span>
          </DropdownMenuItem>
        </AddAgentInboxDialog>

        <GmailAuthDialog onSuccess={handleGmailSuccess}>
          <DropdownMenuItem onSelect={(e) => e.preventDefault()}>
            <Mail className="mr-2 h-4 w-4" />
            <span>Gmail Assistant</span>
          </DropdownMenuItem>
        </GmailAuthDialog>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
