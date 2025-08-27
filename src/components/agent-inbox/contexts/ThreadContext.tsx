"use client";

import {
  AgentInbox,
  HumanResponse,
  ThreadData,
  ThreadStatusWithAll,
} from "@/components/agent-inbox/types";
import { useToast, type ToastInput } from "@/hooks/use-toast";
import { createClient } from "@/lib/client";
import { Run, Thread, ThreadStatus } from "@langchain/langgraph-sdk";
import { END } from "@langchain/langgraph/web";
import React from "react";
import { useQueryParams } from "../hooks/use-query-params";
import {
  INBOX_PARAM,
  LIMIT_PARAM,
  OFFSET_PARAM,
  LANGCHAIN_API_KEY_LOCAL_STORAGE_KEY,
  IMPROPER_SCHEMA,
} from "../constants";
import {
  getInterruptFromThread,
  getThreadFilterMetadata,
  processInterruptedThread,
  processThreadWithoutInterrupts,
} from "./utils";
import { useLocalStorage } from "../hooks/use-local-storage";
import { useInboxes } from "../hooks/use-inboxes";
import { logger } from "../utils/logger";
import { fetchGmailThreads } from "../components/gmail-threads-handler";

type ThreadContentType<
  ThreadValues extends Record<string, any> = Record<string, any>,
> = {
  loading: boolean;
  threadData: ThreadData<ThreadValues>[];
  hasMoreThreads: boolean;
  agentInboxes: AgentInbox[];
  deleteAgentInbox: (id: string) => void;
  changeAgentInbox: (graphId: string, replaceAll?: boolean) => void;
  addAgentInbox: (agentInbox: AgentInbox) => void;
  updateAgentInbox: (updatedInbox: AgentInbox) => void;
  ignoreThread: (threadId: string) => Promise<void>;
  fetchThreads: (inbox: ThreadStatusWithAll) => Promise<void>;
  clearThreadData: () => void;
  sendHumanResponse: <TStream extends boolean = false>(
    threadId: string,
    response: HumanResponse[],
    options?: {
      stream?: TStream;
    }
  ) => TStream extends true
    ?
        | AsyncGenerator<{
            event: Record<string, any>;
            data: any;
          }>
        | undefined
    : Promise<Run> | undefined;
  fetchSingleThread: (
    threadId: string
  ) => Promise<ThreadData<ThreadValues> | undefined>;
};

const ThreadsContext = React.createContext<ThreadContentType | undefined>(
  undefined
);

interface GetClientArgs {
  agentInboxes: AgentInbox[];
  getItem: (key: string) => string | null | undefined;
  toast: (input: ToastInput) => void;
}

const getClient = ({ agentInboxes, getItem, toast }: GetClientArgs) => {
  if (agentInboxes.length === 0) {
    toast({
      title: "Error",
      description: "Agent inbox not found. Please add an inbox in settings. (",
      variant: "destructive",
      duration: 3000,
    });
    return;
  }
  
  const selectedInbox = agentInboxes.find((i) => i.selected);
  if (!selectedInbox) {
    toast({
      title: "Error",
      description: "No inbox selected. Please select an inbox.",
      variant: "destructive",
      duration: 5000,
    });
    return;
  }

  const deploymentUrl = selectedInbox.deploymentUrl;
  if (!deploymentUrl) {
    toast({
      title: "Error",
      description:
        "Please ensure your selected agent inbox has a deployment URL.",
      variant: "destructive",
      duration: 5000,
    });
    return;
  }

  // Handle Gmail FastAPI inboxes
  if (selectedInbox.inboxType === "gmail-fastapi") {
    return createClient({ 
      deploymentUrl, 
      langchainApiKey: undefined,
      clientType: "gmail-fastapi"
    });
  }

  // Handle LangGraph inboxes
  const langchainApiKeyLS =
    getItem(LANGCHAIN_API_KEY_LOCAL_STORAGE_KEY) || undefined;
  // Only show this error if the deployment URL is for a deployed LangGraph instance.
  // Local graphs do NOT require an API key.
  if (!langchainApiKeyLS && deploymentUrl.includes("us.langgraph.app")) {
    toast({
      title: "Error",
      description: "Please add your LangSmith API key in settings.",
      variant: "destructive",
      duration: 5000,
    });
    return;
  }

  return createClient({ 
    deploymentUrl, 
    langchainApiKey: langchainApiKeyLS,
    clientType: "langgraph"
  });
};

export function ThreadsProvider<
  ThreadValues extends Record<string, any> = Record<string, any>,
>({ children }: { children: React.ReactNode }): React.ReactElement {
  const { getItem } = useLocalStorage();
  const { toast } = useToast();

  const { getSearchParam, searchParams } = useQueryParams();
  const [loading, setLoading] = React.useState(false);
  const [threadData, setThreadData] = React.useState<
    ThreadData<ThreadValues>[]
  >([]);
  const [hasMoreThreads, setHasMoreThreads] = React.useState(true);

  const {
    agentInboxes,
    addAgentInbox,
    deleteAgentInbox,
    changeAgentInbox,
    updateAgentInbox,
  } = useInboxes();

  const limitParam = searchParams.get(LIMIT_PARAM);
  const offsetParam = searchParams.get(OFFSET_PARAM);
  const inboxParam = searchParams.get(INBOX_PARAM);

  React.useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    if (!agentInboxes.length) {
      return;
    }
    const inboxSearchParam = getSearchParam(INBOX_PARAM) as ThreadStatusWithAll;
    if (!inboxSearchParam) {
      return;
    }
    try {
      fetchThreads(inboxSearchParam);
    } catch (e) {
      logger.error("Error occurred while fetching threads", e);
    }
  }, [limitParam, offsetParam, inboxParam, agentInboxes]);

  const fetchThreads = React.useCallback(
    async (inbox: ThreadStatusWithAll) => {
      setLoading(true);

      const client = getClient({
        agentInboxes,
        getItem,
        toast,
      });
      if (!client) {
        setLoading(false);
        return;
      }

      const selectedInbox = agentInboxes.find((i) => i.selected);
      if (!selectedInbox) {
        setLoading(false);
        return;
      }

      try {
        const limitQueryParam = getSearchParam(LIMIT_PARAM);
        if (!limitQueryParam) {
          throw new Error("Limit query param not found");
        }
        const offsetQueryParam = getSearchParam(OFFSET_PARAM);
        if (!offsetQueryParam) {
          throw new Error("Offset query param not found");
        }
        const limit = Number(limitQueryParam);
        const offset = Number(offsetQueryParam);

        if (limit > 100) {
          toast({
            title: "Error",
            description: "Cannot fetch more than 100 threads at a time",
            variant: "destructive",
            duration: 3000,
          });
          setLoading(false);
          return;
        }

        // Handle Gmail inboxes differently
        if (selectedInbox.inboxType === "gmail-fastapi" && client.type === "gmail-fastapi") {
          logger.log("Fetching Gmail threads for:", selectedInbox.gmailConfig?.emailAddress);
          try {
            const gmailThreads = await fetchGmailThreads<ThreadValues>(client, selectedInbox, inbox, limit, offset);
            logger.log("Gmail threads fetched:", gmailThreads.length, "threads");
            setThreadData(gmailThreads);
            setHasMoreThreads(gmailThreads.length === limit);
          } catch (error) {
            logger.error("Failed to fetch Gmail threads:", error);
            // Set empty state on error
            setThreadData([]);
            setHasMoreThreads(false);
          }
          setLoading(false);
          return;
        }

        // Handle LangGraph inboxes
        if (client.type === "langgraph") {
          // Handle inbox filtering differently based on type
          let statusInput: { status?: ThreadStatus } = {};
          if (inbox !== "all" && inbox !== "human_response_needed") {
            statusInput = { status: inbox as ThreadStatus };
          }

          const metadataInput = getThreadFilterMetadata(agentInboxes);

          const threadSearchArgs = {
            offset,
            limit,
            ...statusInput,
            ...(metadataInput ? { metadata: metadataInput } : {}),
          };

          const threads = await client.client.threads.search(threadSearchArgs);
          const processedData: ThreadData<ThreadValues>[] = [];

          // Process threads in batches with Promise.all for better performance
          const processPromises = threads.map(
            async (thread): Promise<ThreadData<ThreadValues>> => {
              const currentThread = thread as Thread<ThreadValues>;

              // Handle special cases for human_response_needed inbox
              if (
                inbox === "human_response_needed" &&
                currentThread.status !== "interrupted"
              ) {
                return {
                  status: "human_response_needed" as const,
                  thread: currentThread,
                  interrupts: undefined,
                  invalidSchema: undefined,
                };
              }

              if (currentThread.status === "interrupted") {
                // Try the faster processing method first
                const processedThreadData =
                  processInterruptedThread(currentThread);
                if (
                  processedThreadData &&
                  processedThreadData.interrupts?.length
                ) {
                  return processedThreadData as ThreadData<ThreadValues>;
                }

                // Only if necessary, do the more expensive thread state fetch
                try {
                  // Attempt to get interrupts from state only if necessary
                  const threadInterrupts = getInterruptFromThread(currentThread);
                  if (!threadInterrupts || threadInterrupts.length === 0) {
                    const state = await client.client.threads.getState<ThreadValues>(
                      currentThread.thread_id
                    );

                    return processThreadWithoutInterrupts(currentThread, {
                      thread_id: currentThread.thread_id,
                      thread_state: state,
                    }) as ThreadData<ThreadValues>;
                  }

                  // Return with the interrupts we found
                  return {
                    status: "interrupted" as const,
                    thread: currentThread,
                    interrupts: threadInterrupts,
                    invalidSchema: threadInterrupts.some(
                      (interrupt) =>
                        interrupt?.action_request?.action === IMPROPER_SCHEMA ||
                        !interrupt?.action_request?.action
                    ),
                  };
                } catch (_e) {
                  // If all else fails, mark as invalid schema
                  return {
                    status: "interrupted" as const,
                    thread: currentThread,
                    interrupts: undefined,
                    invalidSchema: true,
                  };
                }
              } else {
                // Non-interrupted threads are simple
                return {
                  status: currentThread.status,
                  thread: currentThread,
                  interrupts: undefined,
                  invalidSchema: undefined,
                } as ThreadData<ThreadValues>;
              }
            }
          );

          // Process all threads concurrently
          const results = await Promise.all(processPromises);
          processedData.push(...results);

          const sortedData = processedData.sort((a, b) => {
            return (
              new Date(b.thread.created_at).getTime() -
              new Date(a.thread.created_at).getTime()
            );
          });

          setThreadData(sortedData);
          setHasMoreThreads(threads.length === limit);
        }
      } catch (e) {
        logger.error("Failed to fetch threads", e);
      }
      setLoading(false);
    },
    [agentInboxes, getItem, getSearchParam, toast]
  );

  const fetchSingleThread = React.useCallback(
    async (threadId: string): Promise<ThreadData<ThreadValues> | undefined> => {
      const client = getClient({
        agentInboxes,
        getItem,
        toast,
      });
      if (!client) {
        return;
      }

      // Gmail clients don't support fetching individual threads
      if (client.type === "gmail-fastapi") {
        logger.warn("Gmail clients don't support fetchSingleThread");
        return undefined;
      }

      if (client.type === "langgraph") {
        const thread = await client.client.threads.get(threadId);
        const currentThread = thread as Thread<ThreadValues>;

        if (thread.status === "interrupted") {
          const threadInterrupts = getInterruptFromThread(currentThread);

          if (!threadInterrupts || !threadInterrupts.length) {
            const state = await client.client.threads.getState(threadId);
            const processedThread = processThreadWithoutInterrupts(
              currentThread,
              {
                thread_state: state,
                thread_id: threadId,
              }
            );

            if (processedThread) {
              return processedThread as ThreadData<ThreadValues>;
            }
          }

          // Return interrupted thread data
          return {
            thread: currentThread,
            status: "interrupted",
            interrupts: threadInterrupts,
            invalidSchema:
              !threadInterrupts ||
              threadInterrupts.length === 0 ||
              threadInterrupts.some(
                (interrupt) =>
                  interrupt?.action_request?.action === IMPROPER_SCHEMA ||
                  !interrupt?.action_request?.action
              ),
          };
        }

        // Check for special human_response_needed status
        const inbox = getSearchParam(INBOX_PARAM) as ThreadStatusWithAll;
        if (inbox === "human_response_needed") {
          return {
            thread: currentThread,
            status: "human_response_needed",
            interrupts: undefined,
            invalidSchema: undefined,
          };
        }

        // Normal non-interrupted thread
        return {
          thread: currentThread,
          status: currentThread.status,
          interrupts: undefined,
          invalidSchema: undefined,
        };
      }
      
      return undefined;
    },
    [agentInboxes, getItem, getSearchParam]
  );

  const ignoreThread = async (threadId: string) => {
    const client = getClient({
      agentInboxes,
      getItem,
      toast,
    });
    if (!client) {
      return;
    }

    try {
      if (client.type === "gmail-fastapi") {
        // For Gmail, we can't really "ignore" threads in the same way
        // Just remove from local state
        setThreadData((prev) => {
          return prev.filter((p) => p.thread.thread_id !== threadId);
        });
        toast({
          title: "Success",
          description: "Removed Gmail thread",
          duration: 3000,
        });
        return;
      }

      if (client.type === "langgraph") {
        await client.client.threads.updateState(threadId, {
          values: null,
          asNode: END,
        });

        setThreadData((prev) => {
          return prev.filter((p) => p.thread.thread_id !== threadId);
        });
        toast({
          title: "Success",
          description: "Ignored thread",
          duration: 3000,
        });
      }
    } catch (e) {
      logger.error("Error ignoring thread", e);
      toast({
        title: "Error",
        description: "Failed to ignore thread",
        variant: "destructive",
        duration: 3000,
      });
    }
  };

  const sendHumanResponse = <TStream extends boolean = false>(
    threadId: string,
    response: HumanResponse[],
    options?: {
      stream?: TStream;
    }
  ): TStream extends true
    ?
        | AsyncGenerator<{
            event: Record<string, any>;
            data: any;
          }>
        | undefined
    : Promise<Run> | undefined => {
    const graphId = agentInboxes.find((i) => i.selected)?.graphId;
    if (!graphId) {
      toast({
        title: "No assistant/graph ID found.",
        description:
          "Assistant/graph IDs are required to send responses. Please add an assistant/graph ID in the settings.",
        variant: "destructive",
      });
      return undefined;
    }

    const client = getClient({
      agentInboxes,
      getItem,
      toast,
    });
    if (!client) {
      return;
    }
    try {
      if (client.type === "gmail-fastapi") {
        // Gmail clients don't support runs/responses in the same way
        logger.warn("Gmail clients don't support sendHumanResponse");
        toast({
          title: "Not Supported",
          description: "Gmail clients don't support human responses yet",
          variant: "destructive",
          duration: 3000,
        });
        return undefined;
      }

      if (client.type === "langgraph") {
        if (options?.stream) {
          return client.client.runs.stream(threadId, graphId, {
            command: {
              resume: response,
            },
            streamMode: "events",
          }) as any; // Type assertion needed due to conditional return type
        }
        return client.client.runs.create(threadId, graphId, {
          command: {
            resume: response,
          },
        }) as any; // Type assertion needed due to conditional return type
      }
    } catch (e: any) {
      logger.error("Error sending human response", e);
      throw e;
    }
  };

  const clearThreadData = React.useCallback(() => {
    setThreadData([]);
  }, []);

  const contextValue: ThreadContentType = {
    loading,
    threadData,
    hasMoreThreads,
    agentInboxes,
    deleteAgentInbox,
    changeAgentInbox,
    addAgentInbox,
    updateAgentInbox,
    ignoreThread,
    sendHumanResponse,
    fetchThreads,
    fetchSingleThread,
    clearThreadData,
  };

  return (
    <ThreadsContext.Provider value={contextValue}>
      {children}
    </ThreadsContext.Provider>
  );
}

export function useThreadsContext<
  T extends Record<string, any> = Record<string, any>,
>() {
  const context = React.useContext(ThreadsContext) as ThreadContentType<T>;
  if (context === undefined) {
    throw new Error("useThreadsContext must be used within a ThreadsProvider");
  }
  return context;
}
