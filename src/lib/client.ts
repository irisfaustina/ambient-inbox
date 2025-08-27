import { Client } from "@langchain/langgraph-sdk";

export type ClientType = "langgraph" | "gmail-fastapi";

export interface GmailFastAPIClient {
  type: "gmail-fastapi";
  baseUrl: string;
  registerUser: (email: string, gmailToken: string) => Promise<any>;
  processEmail: (email: string, emailData?: any, autoFetch?: boolean) => Promise<any>;
  listUsers: () => Promise<any>;
  getUserStatus: (email: string) => Promise<any>;
  removeUser: (email: string) => Promise<any>;
  healthCheck: () => Promise<any>;
}

export interface LangGraphClient {
  type: "langgraph";
  client: Client;
}

export type UnifiedClient = LangGraphClient | GmailFastAPIClient;

export const createClient = ({
  deploymentUrl,
  langchainApiKey,
  clientType = "langgraph",
}: {
  deploymentUrl: string;
  langchainApiKey: string | undefined;
  clientType?: ClientType;
}): UnifiedClient => {
  if (clientType === "gmail-fastapi") {
    return createGmailFastAPIClient(deploymentUrl);
  }
  
  return {
    type: "langgraph",
    client: new Client({
      apiUrl: deploymentUrl,
      defaultHeaders: {
        ...(langchainApiKey && { "x-api-key": langchainApiKey }),
      },
    }),
  };
};

export const createGmailFastAPIClient = (baseUrl: string): GmailFastAPIClient => {
  const apiCall = async (endpoint: string, options: RequestInit = {}) => {
    const response = await fetch(`${baseUrl}${endpoint}`, {
      headers: {
        "Content-Type": "application/json",
        ...options.headers,
      },
      ...options,
    });
    
    if (!response.ok) {
      throw new Error(`API call failed: ${response.status} ${response.statusText}`);
    }
    
    return response.json();
  };

  return {
    type: "gmail-fastapi",
    baseUrl,
    registerUser: async (email: string, gmailToken: string) => {
      return apiCall("/register", {
        method: "POST",
        body: JSON.stringify({
          email_address: email,
          gmail_token: gmailToken,
        }),
      });
    },
    processEmail: async (email: string, emailData?: any, autoFetch: boolean = true) => {
      return apiCall("/process-email", {
        method: "POST",
        body: JSON.stringify({
          email_address: email,
          email_data: emailData,
          auto_fetch: autoFetch,
        }),
      });
    },
    listUsers: async () => {
      return apiCall("/users");
    },
    getUserStatus: async (email: string) => {
      return apiCall(`/status/${encodeURIComponent(email)}`);
    },
    removeUser: async (email: string) => {
      return apiCall(`/users/${encodeURIComponent(email)}`, {
        method: "DELETE",
      });
    },
    healthCheck: async () => {
      return apiCall("/health");
    },
  };
};
