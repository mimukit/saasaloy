import { useChat } from "@ai-sdk/react";
import {
  DefaultChatTransport,
  lastAssistantMessageIsCompleteWithApprovalResponses,
} from "ai";
import { useMemo } from "react";

import { AiChat } from "@repo/ui/blocks/ai-chat";
import type { AiChatCopy, AiChatStatus } from "@repo/ui/blocks/ai-chat";

import { API_CREDENTIALS } from "@app/lib/api";
import {
  approvalIdFor,
  toBlockError,
  toBlockMessages,
} from "@app/lib/ai-chat-messages";
import { apiBaseUrl } from "@app/lib/auth";

export interface AiChatIslandProps {
  /** The chat route's path on the api, such as `/chat`. It must answer with `streamChat`. */
  api?: string;
  /** Keeps two chats on one page apart. */
  id?: string;
  title?: string;
  description?: string;
  copy?: Partial<AiChatCopy>;
  className?: string;
}

/** The chat block wired to an api route through the AI SDK's `useChat`. */
export function AiChatIsland({
  api = "/chat",
  id,
  title,
  description,
  copy,
  className,
}: AiChatIslandProps) {
  // The session cookie crosses origins (the app and the api run apart), as in `@app/lib/api`.
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: `${apiBaseUrl.replace(/\/+$/, "")}${api}`,
        credentials: API_CREDENTIALS,
      }),
    [api]
  );
  const {
    addToolApprovalResponse,
    error,
    messages,
    regenerate,
    sendMessage,
    status,
    stop,
  } = useChat({
    id,
    // After the last approval answer, the chat goes back to the route, which runs or skips each tool.
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
    transport,
  });

  const blockStatus: AiChatStatus =
    status === "submitted" || status === "streaming" ? status : "ready";

  return (
    <AiChat
      messages={toBlockMessages(messages)}
      status={blockStatus}
      error={toBlockError(error)}
      onSend={(text) => {
        void sendMessage({ text });
      }}
      onStop={() => {
        void stop();
      }}
      onRetry={() => {
        void regenerate();
      }}
      onApprove={(toolCallId, approved) => {
        const approvalId = approvalIdFor(messages, toolCallId);
        if (approvalId !== undefined) {
          void addToolApprovalResponse({ approved, id: approvalId });
        }
      }}
      title={title}
      description={description}
      copy={copy}
      className={className}
    />
  );
}
