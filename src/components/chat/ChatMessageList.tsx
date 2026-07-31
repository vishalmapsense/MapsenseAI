import React, { useEffect, useRef, useState } from "react";
import { MarkdownRenderer } from "./MarkdownRenderer";
import { ChatMessage } from "@/types/mcp.types";
import { cn } from "@/lib/utils";
import { User, Map, Bot, Pencil, X, Check, Loader2, CheckCircle2, Zap, Sparkles } from "lucide-react";
import { useChatStore } from "@/stores/useChatStore";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { AgentEventInfo } from "@/types/mcp.types";

interface ChatMessageListProps {
  messages: ChatMessage[];
  aiName: string;
}

const extractOptionButtons = (text: string): string[] => {
  if (!text) return [];
  const options: string[] = [];

  // 1. Explicit [OPTION: label] pattern
  const optionRegex = /\[OPTION:\s*([^\]]+)\]/gi;
  let match;
  while ((match = optionRegex.exec(text)) !== null) {
    const optText = match[1]?.trim();
    if (optText && !options.includes(optText)) {
      options.push(optText);
    }
  }

  // 2. Fallback: Bulleted options if text asks a clarifying choice/question
  if (options.length === 0 && /(choose|select|which|confirm|options|did you mean)/i.test(text)) {
    const lines = text.split("\n");
    for (const line of lines) {
      const bulletMatch = line.match(/^[\s*-·•\d+.]+\s*(?:\[|\()?([^\]\)\n]{2,60})(?:\]|\))?$/);
      if (bulletMatch && bulletMatch[1]) {
        const cleaned = bulletMatch[1].replace(/^\*\*|\*\*$/g, "").trim();
        if (cleaned && !cleaned.toLowerCase().startsWith("http") && !options.includes(cleaned)) {
          options.push(cleaned);
        }
      }
    }
  }

  return options.slice(0, 6);
};

const renderAgentEvents = (events: AgentEventInfo[] | undefined, isLoading: boolean = false) => {
  if (!events || events.length === 0) return null;
  
  const timelineEvents: any[] = [];
  events.forEach(evt => {
    if (evt.type === "completion") {
      const lastCall = timelineEvents.slice().reverse().find(e => e.agentName === evt.agentName);
      if (lastCall) {
        lastCall.tokens = evt.tokens;
        lastCall.isCompleted = true;
      } else {
        timelineEvents.push({ ...evt, isCompleted: true, description: "Finished thinking" });
      }
    } else {
      timelineEvents.push({ ...evt, isCompleted: false });
    }
  });

  if (!isLoading) {
    timelineEvents.forEach(e => e.isCompleted = true);
  }

  const renderTimelineItem = (evt: any, i: number, isLast: boolean, compact: boolean = false) => (
    <div key={i} className="relative flex items-start gap-2 mb-2 last:mb-0">
      {!isLast && (
        <div className="absolute left-[5px] top-4 bottom-[-10px] w-[2px] bg-border/50" />
      )}
      
      <div className="relative z-10 flex items-center justify-center bg-background rounded-full mt-0.5">
        {!evt.isCompleted && isLoading ? (
          <Loader2 className={cn("text-primary opacity-70 animate-spin", compact ? "w-3 h-3" : "w-3.5 h-3.5")} />
        ) : (
          <CheckCircle2 className={cn("text-green-500 opacity-80", compact ? "w-3 h-3" : "w-3.5 h-3.5")} />
        )}
      </div>

      <div className="flex flex-col flex-1 w-full overflow-hidden">
        <div className="flex items-center gap-1.5 w-full">
          <span className={cn("font-semibold text-primary shrink-0", compact ? "text-[10px]" : "text-[11px]")}>{evt.agentName}</span>
          <span className={cn("opacity-80 text-foreground/80 truncate", compact ? "text-[10px]" : "text-[11px]")} title={evt.description}>
            {evt.description}
          </span>
          {evt.tokens && (
            <span className={cn("ml-auto flex items-center gap-0.5 font-medium px-1.5 py-0.5 rounded-full bg-green-500/10 text-green-600 dark:text-green-400 border border-green-500/20 whitespace-nowrap shrink-0", compact ? "text-[8px]" : "text-[9px]")}>
              <Zap className={compact ? "w-2 h-2" : "w-2.5 h-2.5"} />
              {evt.tokens}
            </span>
          )}
        </div>
      </div>
    </div>
  );

  if (isLoading) {
    return (
      <div className="flex flex-col w-full transition-all pl-1 pt-1 mb-2">
        {timelineEvents.map((evt, i) => renderTimelineItem(evt, i, i === timelineEvents.length - 1, false))}
      </div>
    );
  }

  return (
    <details className="mb-3 text-[10px] text-muted-foreground opacity-90 border border-border/50 rounded-md bg-background/20 group">
      <summary className="font-semibold text-foreground/70 cursor-pointer flex items-center gap-1.5 select-none hover:text-foreground/90 transition-colors list-none p-1.5 [&::-webkit-details-marker]:hidden">
        <span className="text-[7px] transition-transform group-open:rotate-90">▶</span>
        Agent Trace ({timelineEvents.length} events)
      </summary>
      <div className="flex flex-col p-1.5 pt-0 border-t border-border/30 mt-1 pl-2">
        {timelineEvents.map((evt, i) => renderTimelineItem(evt, i, i === timelineEvents.length - 1, true))}
      </div>
    </details>
  );
};

export const ChatMessageList: React.FC<ChatMessageListProps> = ({ messages, aiName }) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const { editAndResendMessage, sendMessage, isLoading: isChatLoading } = useChatStore();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  if (messages.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground opacity-70">
        <Map className="w-10 h-10 mb-3" />
        <p className="text-sm">Start a conversation with {aiName}</p>
      </div>
    );
  }

  return (
    <div ref={scrollRef} className="flex flex-col gap-4 p-4 overflow-y-auto h-full scroll-smooth">
      {messages.map((message) => {
        const isUser = message.role === "user";
        const options = !isUser ? extractOptionButtons(message.content) : [];

        return (
          <div
            key={message.id}
            className={cn(
              "group flex flex-col w-full max-w-[85%]",
              isUser ? "self-end items-end" : "self-start items-start"
            )}
          >
            {/* Sender Name */}
            <div className="flex items-center gap-1.5 mb-1 px-1 opacity-80">
              {isUser ? (
                <>
                  <span className="text-[10px] font-medium">You</span>
                  <User className="w-3 h-3" />
                </>
              ) : (
                <>
                  <Bot className="w-3 h-3" />
                  <span className="text-[10px] font-medium">{aiName}</span>
                </>
              )}
            </div>

            {/* Message Bubble */}
            <div
              className={cn(
                "px-3 py-2 rounded-2xl text-[13px] leading-relaxed shadow-sm",
                isUser
                  ? "bg-primary text-primary-foreground rounded-br-sm"
                  : "bg-muted/50 dark:bg-muted/30 border border-border/50 text-foreground rounded-bl-sm",
                message.isLoading ? "animate-pulse" : ""
              )}
            >
              {message.isLoading ? (
                <div className="flex flex-col gap-2 w-full">
                  {renderAgentEvents(message.agentEvents, true)}
                  {message.content && (
                    <div className="w-full opacity-100">
                      <MarkdownRenderer content={message.content} />
                    </div>
                  )}
                  {message.statusMessage && (
                    <div className="flex items-center gap-3 min-h-5 mt-1">
                      <div className="flex items-center gap-1">
                        <div className="w-1.5 h-1.5 rounded-full bg-current opacity-50 animate-bounce" style={{ animationDelay: "0ms" }} />
                        <div className="w-1.5 h-1.5 rounded-full bg-current opacity-50 animate-bounce" style={{ animationDelay: "150ms" }} />
                        <div className="w-1.5 h-1.5 rounded-full bg-current opacity-50 animate-bounce" style={{ animationDelay: "300ms" }} />
                      </div>
                      <span className="text-[12px] italic opacity-80">{message.statusMessage}</span>
                    </div>
                  )}
                </div>
              ) : isUser ? (
                editingId === message.id ? (
                  <div className="flex flex-col gap-2 min-w-[200px]">
                    <textarea
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      className="w-full bg-primary-foreground/10 text-primary-foreground placeholder:text-primary-foreground/50 rounded-md p-2 text-[13px] resize-none focus:outline-none border border-primary-foreground/20"
                      rows={3}
                      autoFocus
                    />
                    <div className="flex items-center justify-end gap-2 mt-1">
                      <button
                        onClick={() => setEditingId(null)}
                        className="flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded bg-primary-foreground/10 hover:bg-primary-foreground/20 transition-colors"
                      >
                        <X className="w-3 h-3" /> Cancel
                      </button>
                      <button
                        onClick={() => {
                          setEditingId(null);
                          editAndResendMessage(message.id, editValue);
                        }}
                        className="flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded bg-primary-foreground text-primary hover:bg-primary-foreground/90 transition-colors"
                      >
                        <Check className="w-3 h-3" /> Save & Resend
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="relative flex items-start gap-2">
                    <div className="whitespace-pre-wrap flex-1">{message.content}</div>
                    <button
                      onClick={() => {
                        setEditingId(message.id);
                        setEditValue(message.content);
                      }}
                      className="opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:bg-primary-foreground/20 rounded-md -mr-1"
                      title="Edit and resend"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )
              ) : (
                <>
                  {renderAgentEvents(message.agentEvents, false)}
                  <div className="w-full opacity-100 ">
                    <MarkdownRenderer content={message.content || "*(No text provided)*"} />
                  </div>

                  {/* Interactive Option / Confirmation Buttons */}
                  {options.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-2.5 pt-2 border-t border-border/40">
                      {options.map((opt, i) => (
                        <button
                          key={i}
                          disabled={isChatLoading}
                          onClick={() => sendMessage(opt)}
                          className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium rounded-xl bg-primary/10 text-primary border border-primary/30 hover:bg-primary hover:text-primary-foreground transition-all duration-150 shadow-sm active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          <Sparkles className="w-3.5 h-3.5 opacity-80" />
                          <span>{opt}</span>
                        </button>
                      ))}
                    </div>
                  )}

                  {message.executionMessages && (
                    <details className="mt-2 text-[9px] text-muted-foreground opacity-80 border-t border-border/50 pt-2 group">
                      <summary className="font-semibold text-foreground/70 cursor-pointer flex items-center gap-1.5 select-none hover:text-foreground/90 transition-colors list-none [&::-webkit-details-marker]:hidden">
                        <span className="text-[7px] transition-transform group-open:rotate-90">▶</span>
                        Map Actions ({message.executionMessages.length})
                      </summary>
                      <div className="flex flex-col gap-0.5 mt-1.5 pl-3 border-l-2 border-border/30 ml-1 py-0.5">
                        {message.executionMessages.map((msg, i) => (
                          <span key={i}>{msg}</span>
                        ))}
                      </div>
                    </details>
                  )}
                </>
              )}
            </div>

            {/* Tool Calls & Token Usage Display */}
            {!isUser && (message.toolCalls?.length || message.usage) && (
              <div className="flex flex-wrap items-center gap-1.5 mt-1.5 pl-1">
                {message.toolCalls?.map((tool, idx) => (
                  <span
                    key={idx}
                    className="text-[9px] font-medium px-1.5 py-0.5 rounded-md bg-secondary text-secondary-foreground opacity-80"
                  >
                    Used {tool.toolName}
                  </span>
                ))}

                {message.usage && (
                  <Tooltip>
                    <TooltipTrigger>
                      <span className="text-[9px] font-medium px-1.5 py-0.5 rounded-md bg-green-500/10 text-green-600 dark:text-green-400 border border-green-500/20 cursor-help">
                        {message.usage.totalTokenCount} Tokens
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="text-[11px] font-medium p-2">
                      <div className="flex flex-col gap-1">
                        <div>Prompt: <span className="font-semibold">{message.usage.promptTokenCount}</span></div>
                        <div>Output: <span className="font-semibold">{message.usage.candidatesTokenCount}</span></div>
                      </div>
                    </TooltipContent>
                  </Tooltip>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};
