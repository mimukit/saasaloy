"use client";

import {
  BanIcon,
  ChevronRightIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  LoaderCircleIcon,
  MessageCircleMoreIcon,
  SendIcon,
  ShieldQuestionIcon,
  SparklesIcon,
  SquareIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode, SubmitEvent } from "react";

import { Badge } from "@repo/ui/components/badge";
import { Button } from "@repo/ui/components/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@repo/ui/components/collapsible";
import { Skeleton } from "@repo/ui/components/skeleton";
import { Textarea } from "@repo/ui/components/textarea";
import { externalLinkProps, newTabHint } from "@repo/ui/lib/external-link";
import { cn } from "@repo/ui/lib/utils";

// The ai module's chat block. It knows no AI framework and no network: an island in the
// app maps its framework's messages onto these props and supplies the four callbacks.

/** Where a tool call stands. `approval` waits for the user's Approve or Deny. */
export type AiChatToolState =
  "running" | "approval" | "finished" | "error" | "denied";

export type AiChatPart =
  | { type: "text"; text: string }
  | { type: "reasoning"; text: string; streaming?: boolean }
  | {
      type: "tool";
      toolCallId: string;
      name: string;
      state: AiChatToolState;
      input?: unknown;
      output?: unknown;
      errorText?: string;
    }
  | { type: "source"; id: string; title?: string; url?: string };

export interface AiChatMessage {
  id: string;
  role: "user" | "assistant";
  parts: AiChatPart[];
}

/** `submitted` waits for the first token, `streaming` reads the reply. */
export type AiChatStatus = "ready" | "submitted" | "streaming";

export interface AiChatError {
  message: string;
  /** Shows the Retry button when true. */
  retryable: boolean;
}

/** Every word the block shows. Pass any subset to the `copy` prop. */
export interface AiChatCopy {
  emptyTitle: string;
  suggestions: string[];
  placeholder: string;
  inputLabel: string;
  send: string;
  stop: string;
  retry: string;
  reasoning: string;
  thinking: string;
  input: string;
  output: string;
  approve: string;
  deny: string;
  approvalRequired: string;
  finished: string;
  failed: string;
  denied: string;
  sources: string;
  running: (tool: string) => string;
}

export const AI_CHAT_COPY: AiChatCopy = {
  approvalRequired: "Approval required",
  approve: "Approve",
  denied: "Denied",
  deny: "Deny",
  emptyTitle: "Ask anything about your workspace",
  failed: "Failed",
  finished: "Finished",
  input: "Input",
  inputLabel: "Message",
  output: "Output",
  placeholder: "Message the assistant…",
  reasoning: "Reasoning",
  retry: "Retry",
  running: (tool) => `Running ${tool}…`,
  send: "Send",
  sources: "Sources",
  stop: "Stop",
  suggestions: [
    "Summarize what changed this week",
    "Find a recent record",
    "Explain a setting",
  ],
  thinking: "Thinking",
};

export interface AiChatProps {
  messages: AiChatMessage[];
  status: AiChatStatus;
  error?: AiChatError | null;
  onSend: (text: string) => void;
  onStop: () => void;
  onRetry: () => void;
  onApprove: (toolCallId: string, approved: boolean) => void;
  /** A heading above the chat, for a side panel. A full page leaves it out. */
  title?: string;
  description?: string;
  copy?: Partial<AiChatCopy>;
  className?: string;
}

export function AiChat({
  messages,
  status,
  error,
  onSend,
  onStop,
  onRetry,
  onApprove,
  title,
  description,
  copy: copyOverrides,
  className,
}: AiChatProps) {
  const copy = { ...AI_CHAT_COPY, ...copyOverrides };
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const busy = status !== "ready";
  const waiting = status === "submitted" && messages.at(-1)?.role === "user";

  // Keeps the newest token in view while a reply streams in. The effect reads only the
  // ref, so it lists the props that grow the transcript, and typing in the composer does
  // not pull a reader back to the bottom.
  useEffect(() => {
    const node = scrollRef.current;
    if (node) {
      node.scrollTop = node.scrollHeight;
    }
    // oxlint-disable-next-line react/exhaustive-effect-dependencies
  }, [messages, status, error]);

  function send(text: string) {
    const trimmed = text.trim();
    if (trimmed.length === 0 || busy) {
      return;
    }
    onSend(trimmed);
    setDraft("");
  }

  function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    send(draft);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends and Shift+Enter breaks the line; an IME composition keeps its Enter.
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault();
      send(draft);
    }
  }

  return (
    <section
      className={cn(
        "bg-background text-foreground flex h-full min-h-0 w-full flex-col",
        className
      )}
    >
      {title !== undefined && (
        <header className="border-border flex flex-col gap-1 border-b px-4 py-3">
          <h2 className="text-base font-semibold">{title}</h2>
          {description !== undefined && (
            <p className="text-muted-foreground text-sm">{description}</p>
          )}
        </header>
      )}
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto px-4 py-6"
        aria-live="polite"
      >
        {messages.length === 0 && !waiting ? (
          <EmptyState copy={copy} disabled={busy} onPick={send} />
        ) : (
          <ol className="mx-auto flex w-full max-w-3xl flex-col gap-6">
            {messages.map((message) => (
              <li key={message.id}>
                {message.role === "user" ? (
                  <UserMessage message={message} />
                ) : (
                  <AssistantMessage
                    message={message}
                    copy={copy}
                    onApprove={onApprove}
                  />
                )}
              </li>
            ))}
            {waiting && (
              <li>
                <AssistantRow>
                  <span className="sr-only">{copy.thinking}</span>
                  <Skeleton className="h-4 w-48" />
                  <Skeleton className="h-4 w-32" />
                </AssistantRow>
              </li>
            )}
            {error && (
              <li>
                <ErrorBanner error={error} copy={copy} onRetry={onRetry} />
              </li>
            )}
          </ol>
        )}
      </div>
      <form
        onSubmit={handleSubmit}
        className="mx-auto flex w-full max-w-3xl items-end gap-2 px-4 pt-2 pb-4"
      >
        <label htmlFor="ai-chat-input" className="sr-only">
          {copy.inputLabel}
        </label>
        <Textarea
          id="ai-chat-input"
          rows={1}
          value={draft}
          placeholder={copy.placeholder}
          onChange={(event) => {
            setDraft(event.target.value);
          }}
          onKeyDown={handleKeyDown}
          className="max-h-40 min-h-9 flex-1 resize-none"
        />
        {busy ? (
          <Button type="button" size="lg" onClick={onStop}>
            <SquareIcon data-icon="inline-start" className="fill-current" />
            {copy.stop}
          </Button>
        ) : (
          <Button type="submit" size="lg" disabled={draft.trim().length === 0}>
            <SendIcon data-icon="inline-start" />
            {copy.send}
          </Button>
        )}
      </form>
    </section>
  );
}

function EmptyState({
  copy,
  disabled,
  onPick,
}: {
  copy: AiChatCopy;
  disabled: boolean;
  onPick: (text: string) => void;
}) {
  return (
    <div className="mx-auto flex h-full w-full max-w-md flex-col items-center justify-center gap-6 text-center">
      <span className="bg-muted text-muted-foreground flex size-12 items-center justify-center rounded-xl">
        <MessageCircleMoreIcon className="size-6" />
      </span>
      <h3 className="text-2xl font-semibold tracking-tight text-balance">
        {copy.emptyTitle}
      </h3>
      {copy.suggestions.length > 0 && (
        <ul className="flex w-full flex-col gap-2">
          {copy.suggestions.map((suggestion) => (
            <li key={suggestion}>
              <button
                type="button"
                disabled={disabled}
                onClick={() => {
                  onPick(suggestion);
                }}
                className="border-border hover:bg-muted focus-visible:ring-ring/50 flex w-full items-center justify-between gap-3 rounded-xl border px-4 py-3 text-left text-sm transition-colors outline-none focus-visible:ring-3 disabled:opacity-50"
              >
                {suggestion}
                <ChevronRightIcon className="text-muted-foreground size-4 shrink-0" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function UserMessage({ message }: { message: AiChatMessage }) {
  const text = message.parts
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("");
  return (
    <div className="flex justify-end">
      <p className="bg-muted max-w-[85%] rounded-xl px-4 py-2.5 text-sm whitespace-pre-wrap">
        {text}
      </p>
    </div>
  );
}

function AssistantRow({ children }: { children: ReactNode }) {
  return (
    <div className="flex gap-3">
      <span className="bg-primary text-primary-foreground flex size-7 shrink-0 items-center justify-center rounded-lg">
        <SparklesIcon className="size-4" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-3">{children}</div>
    </div>
  );
}

function AssistantMessage({
  message,
  copy,
  onApprove,
}: {
  message: AiChatMessage;
  copy: AiChatCopy;
  onApprove: (toolCallId: string, approved: boolean) => void;
}) {
  const sources = message.parts.filter(
    (part): part is Extract<AiChatPart, { type: "source" }> =>
      part.type === "source"
  );
  return (
    <AssistantRow>
      {message.parts.map((part, index) => {
        const key = `${message.id}-${String(index)}`;
        switch (part.type) {
          case "text": {
            return part.text.length > 0 ? (
              <p key={key} className="text-sm/6 whitespace-pre-wrap">
                {part.text}
              </p>
            ) : null;
          }
          case "reasoning": {
            return (
              <Reasoning
                key={key}
                text={part.text}
                streaming={part.streaming === true}
                copy={copy}
              />
            );
          }
          case "tool": {
            return part.state === "approval" ? (
              <ApprovalCard
                key={key}
                part={part}
                copy={copy}
                onApprove={onApprove}
              />
            ) : (
              <ToolCall key={key} part={part} copy={copy} />
            );
          }
          default: {
            return null;
          }
        }
      })}
      {sources.length > 0 && (
        <ul aria-label={copy.sources} className="flex flex-wrap gap-2">
          {sources.map((source, index) => (
            <li key={source.id}>
              <SourceChip
                number={index + 1}
                title={source.title ?? source.url ?? source.id}
                url={source.url}
              />
            </li>
          ))}
        </ul>
      )}
    </AssistantRow>
  );
}

function Disclosure({
  label,
  children,
  defaultOpen = false,
}: {
  label: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <Collapsible
      defaultOpen={defaultOpen}
      className="bg-muted/50 border-border rounded-lg border"
    >
      <CollapsibleTrigger className="group/disclosure focus-visible:ring-ring/50 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-medium outline-none focus-visible:ring-3">
        <ChevronRightIcon className="text-muted-foreground size-4 transition-transform group-data-[panel-open]/disclosure:rotate-90" />
        {label}
      </CollapsibleTrigger>
      <CollapsibleContent className="px-3 pb-3">{children}</CollapsibleContent>
    </Collapsible>
  );
}

function Reasoning({
  text,
  streaming,
  copy,
}: {
  text: string;
  streaming: boolean;
  copy: AiChatCopy;
}) {
  return (
    <Disclosure
      label={
        <span className="flex items-center gap-2">
          {copy.reasoning}
          {streaming && (
            <LoaderCircleIcon className="text-muted-foreground size-3.5 animate-spin" />
          )}
        </span>
      }
    >
      <p className="text-muted-foreground text-sm/6 whitespace-pre-wrap">
        {text}
      </p>
    </Disclosure>
  );
}

function Json({ value }: { value: unknown }) {
  const text =
    typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return (
    <pre className="bg-background border-border max-h-64 overflow-auto rounded-md border p-2 font-mono text-xs whitespace-pre-wrap">
      {text}
    </pre>
  );
}

type ToolPart = Extract<AiChatPart, { type: "tool" }>;

function ToolCall({ part, copy }: { part: ToolPart; copy: AiChatCopy }) {
  if (part.state === "running") {
    return (
      <div className="border-border flex items-center gap-3 rounded-xl border px-4 py-3 text-sm">
        <LoaderCircleIcon className="text-muted-foreground size-4 animate-spin" />
        {copy.running(part.name)}
      </div>
    );
  }
  const badge = {
    approval: copy.approvalRequired,
    denied: copy.denied,
    error: copy.failed,
    finished: copy.finished,
  }[part.state];
  return (
    <div className="border-border flex flex-col gap-2 rounded-xl border p-3">
      <div className="flex items-center gap-2">
        {part.state === "finished" && (
          <CircleCheckIcon className="text-foreground size-4" />
        )}
        {part.state === "error" && (
          <CircleAlertIcon className="text-destructive size-4" />
        )}
        {part.state === "denied" && (
          <BanIcon className="text-muted-foreground size-4" />
        )}
        <span className="min-w-0 flex-1 truncate font-mono text-sm font-medium">
          {part.name}
        </span>
        <Badge variant={part.state === "error" ? "destructive" : "secondary"}>
          {badge}
        </Badge>
      </div>
      {part.input !== undefined && (
        <Disclosure label={copy.input}>
          <Json value={part.input} />
        </Disclosure>
      )}
      {part.state === "finished" && part.output !== undefined && (
        <Disclosure label={copy.output}>
          <Json value={part.output} />
        </Disclosure>
      )}
      {part.state === "error" && part.errorText !== undefined && (
        <p className="text-destructive text-sm">{part.errorText}</p>
      )}
    </div>
  );
}

function ApprovalCard({
  part,
  copy,
  onApprove,
}: {
  part: ToolPart;
  copy: AiChatCopy;
  onApprove: (toolCallId: string, approved: boolean) => void;
}) {
  return (
    <div className="border-border flex flex-col gap-3 rounded-xl border p-4">
      <div className="flex items-start gap-3">
        <span className="bg-muted text-muted-foreground flex size-8 shrink-0 items-center justify-center rounded-lg">
          <ShieldQuestionIcon className="size-4" />
        </span>
        <div className="flex min-w-0 flex-col gap-1.5">
          <span className="truncate font-mono text-sm font-semibold">
            {part.name}
          </span>
          <Badge className="bg-warning/10 text-warning-foreground">
            {copy.approvalRequired}
          </Badge>
        </div>
      </div>
      {part.input !== undefined && (
        <Disclosure label={copy.input}>
          <Json value={part.input} />
        </Disclosure>
      )}
      <div className="grid grid-cols-2 gap-2">
        <Button
          type="button"
          size="lg"
          onClick={() => {
            onApprove(part.toolCallId, true);
          }}
        >
          {copy.approve}
        </Button>
        <Button
          type="button"
          size="lg"
          variant="outline"
          onClick={() => {
            onApprove(part.toolCallId, false);
          }}
        >
          {copy.deny}
        </Button>
      </div>
    </div>
  );
}

function SourceChip({
  number,
  title,
  url,
}: {
  number: number;
  title: string;
  url?: string;
}) {
  const body = (
    <>
      <span className="bg-muted text-muted-foreground flex size-5 items-center justify-center rounded-md font-mono text-xs">
        {number}
      </span>
      <span className="max-w-48 truncate">{title}</span>
    </>
  );
  const chip =
    "border-border inline-flex items-center gap-2 rounded-lg border py-1 pr-3 pl-1 text-sm";
  return url === undefined ? (
    <span className={chip}>{body}</span>
  ) : (
    <a
      href={url}
      {...externalLinkProps(url)}
      className={cn(
        chip,
        "hover:bg-muted focus-visible:ring-ring/50 transition-colors outline-none focus-visible:ring-3"
      )}
    >
      {body}
      {newTabHint(url)}
    </a>
  );
}

function ErrorBanner({
  error,
  copy,
  onRetry,
}: {
  error: AiChatError;
  copy: AiChatCopy;
  onRetry: () => void;
}) {
  return (
    <div
      role="alert"
      className="border-destructive/30 bg-destructive/10 flex items-center gap-3 rounded-xl border px-4 py-3"
    >
      <TriangleAlertIcon className="text-destructive size-4 shrink-0" />
      <p className="text-destructive flex-1 text-sm">{error.message}</p>
      {error.retryable && (
        <Button type="button" size="sm" onClick={onRetry}>
          {copy.retry}
        </Button>
      )}
    </div>
  );
}
