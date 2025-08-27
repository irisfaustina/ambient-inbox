"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { createGmailFastAPIClient } from "@/lib/client";
import { toast } from "@/hooks/use-toast";
import { AgentInbox } from "../types";

interface GmailAuthDialogProps {
  children: React.ReactNode;
  onSuccess: (inbox: Partial<AgentInbox>) => void;
  gmailApiUrl?: string;
}

export function GmailAuthDialog({ 
  children, 
  onSuccess,
  gmailApiUrl = "http://localhost:8001"
}: GmailAuthDialogProps) {
  const [open, setOpen] = useState(false);
  const [emailAddress, setEmailAddress] = useState("");
  const [gmailToken, setGmailToken] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!emailAddress || !gmailToken) {
      toast({
        title: "Missing Information",
        description: "Please provide both email address and Gmail token.",
        variant: "destructive",
      });
      return;
    }

    setIsSubmitting(true);
    
    try {
      // Create client and register user
      const client = createGmailFastAPIClient(gmailApiUrl);
      await client.registerUser(emailAddress, gmailToken);
      
      // Check health to ensure connection works
      await client.healthCheck();
      
      // Create inbox configuration
      const newInbox: Partial<AgentInbox> = {
        id: `gmail-${emailAddress}-${Date.now()}`,
        graphId: "gmail-assistant",
        deploymentUrl: gmailApiUrl,
        name: `Gmail: ${emailAddress}`,
        selected: false,
        inboxType: "gmail-fastapi",
        gmailConfig: {
          emailAddress,
          gmailToken,
          isAuthenticated: true,
        },
        createdAt: new Date().toISOString(),
      };

      onSuccess(newInbox);
      setOpen(false);
      setEmailAddress("");
      setGmailToken("");
      
      toast({
        title: "Gmail Account Connected",
        description: `Successfully connected ${emailAddress} to your Gmail assistant.`,
      });
      
    } catch (error) {
      console.error("Gmail authentication failed:", error);
      toast({
        title: "Connection Failed",
        description: error instanceof Error ? error.message : "Failed to connect to Gmail assistant.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {children}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Connect Gmail Account</DialogTitle>
          <DialogDescription>
            Connect your Gmail account to enable email processing with your personal Gmail assistant.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="email" className="text-right">
                Email
              </Label>
              <Input
                id="email"
                type="email"
                value={emailAddress}
                onChange={(e) => setEmailAddress(e.target.value)}
                className="col-span-3"
                placeholder="your.email@gmail.com"
                required
              />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="token" className="text-right">
                Gmail Token
              </Label>
              <Input
                id="token"
                type="password"
                value={gmailToken}
                onChange={(e) => setGmailToken(e.target.value)}
                className="col-span-3"
                placeholder="Your Gmail API token"
                required
              />
            </div>
            <div className="text-sm text-muted-foreground">
              <p>
                You need a Gmail API token to connect your account. 
                <a 
                  href="https://developers.google.com/gmail/api/quickstart" 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:text-blue-800 underline ml-1"
                >
                  Get your token here
                </a>
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Connecting..." : "Connect Gmail"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}