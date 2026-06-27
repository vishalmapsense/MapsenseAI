import React, { useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import "highlight.js/styles/github-dark.css";
import { ChatMessage } from "@/types/mcp.types";
import { cn } from "@/lib/utils";
import { User, Map, Bot } from "lucide-react";

interface ChatMessageListProps {
  messages: ChatMessage[];
  aiName: string;
}

export const ChatMessageList: React.FC<ChatMessageListProps> = ({ messages, aiName }) => {
  const scrollRef = useRef<HTMLDivElement>(null);

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
              "flex flex-col w-full max-w-[85%]",
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
                <div className="whitespace-pre-wrap">{message.content}</div>
              ) : (
                <div className="prose prose-sm dark:prose-invert max-w-none prose-p:leading-relaxed prose-pre:p-0 prose-pre:bg-transparent">
                  <ReactMarkdown rehypePlugins={[rehypeHighlight]}>
                    {message.content || "*(No text provided)*"}
                  </ReactMarkdown>
                </div>
              )}
            </div>

            {/* Tool Calls Display */}
            {!isUser && message.toolCalls && message.toolCalls.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1.5 pl-1">
                {message.toolCalls.map((tool, idx) => (
                  <span
                    key={idx}
                    className="text-[9px] font-medium px-1.5 py-0.5 rounded-md bg-secondary text-secondary-foreground opacity-80"
                  >
                    Used {tool.toolName}
                  </span>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};
