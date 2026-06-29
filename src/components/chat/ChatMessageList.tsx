import React, { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import "highlight.js/styles/github-dark.css";
import { ChatMessage } from "@/types/mcp.types";
import { cn } from "@/lib/utils";
import { User, Map, Bot, Pencil, X, Check } from "lucide-react";
import { useChatStore } from "@/stores/useChatStore";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface ChatMessageListProps {
  messages: ChatMessage[];
  aiName: string;
}

export const ChatMessageList: React.FC<ChatMessageListProps> = ({ messages, aiName }) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const { editAndResendMessage } = useChatStore();
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
                <div className="flex items-center gap-1 h-5">
                  <div className="w-1.5 h-1.5 rounded-full bg-current opacity-50 animate-bounce" style={{ animationDelay: "0ms" }} />
                  <div className="w-1.5 h-1.5 rounded-full bg-current opacity-50 animate-bounce" style={{ animationDelay: "150ms" }} />
                  <div className="w-1.5 h-1.5 rounded-full bg-current opacity-50 animate-bounce" style={{ animationDelay: "300ms" }} />
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
                <div className="prose prose-sm dark:prose-invert max-w-none prose-p:leading-relaxed prose-pre:p-0 prose-pre:bg-transparent">
                  <ReactMarkdown rehypePlugins={[rehypeHighlight]}>
                    {message.content || "*(No text provided)*"}
                  </ReactMarkdown>
                </div>
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
                    <TooltipTrigger asChild>
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
