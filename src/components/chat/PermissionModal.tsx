import React from "react";
import { useChatStore } from "@/stores/useChatStore";
import { ShieldAlert, X } from "lucide-react";
import { cn } from "@/lib/utils";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export const PermissionModal: React.FC = () => {
  const { permissionRequest, clearPermissionRequest, sendMessage, isLoading } = useChatStore();

  if (!permissionRequest) return null;

  const handleOptionClick = (option: string) => {
    clearPermissionRequest();
    sendMessage(option);
  };

  const handleCancel = () => {
    clearPermissionRequest();
  };

  return (
    <div className="absolute inset-0 z-50 flex items-end justify-center p-3 pb-20 bg-background/30 backdrop-blur-[2px] animate-in fade-in duration-200">
      <div className="bg-card border border-border/40 shadow-lg rounded-lg w-[calc(100%-1.5rem)] flex flex-col overflow-hidden animate-in slide-in-from-bottom-4 duration-300">
        {/* Header */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-border/20 bg-muted/10">
          <h3 className="font-medium text-sm flex items-center gap-1.5 text-foreground/90">
            <ShieldAlert className="w-4 h-4 text-amber-500" />
            {permissionRequest.title || "Permission Required"}
          </h3>
          <button
            onClick={handleCancel}
            className="p-1 rounded hover:bg-foreground/10 transition-colors text-muted-foreground"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Body — rendered markdown */}
        <div className="px-4 py-3 permission-modal-body">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              p: ({ children }) => (
                <p className="text-[13px] leading-relaxed text-foreground/75 my-1 first:mt-0 last:mb-0">
                  {children}
                </p>
              ),
              strong: ({ children }) => (
                <strong className="font-semibold text-foreground/90">{children}</strong>
              ),
              em: ({ children }) => (
                <em className="italic text-foreground/70">{children}</em>
              ),
              ul: ({ children }) => (
                <ul className="list-disc list-inside text-[13px] text-foreground/75 my-1 space-y-0.5">
                  {children}
                </ul>
              ),
              ol: ({ children }) => (
                <ol className="list-decimal list-inside text-[13px] text-foreground/75 my-1 space-y-0.5">
                  {children}
                </ol>
              ),
              li: ({ children }) => (
                <li className="text-[13px] leading-relaxed">{children}</li>
              ),
              code: ({ children }) => (
                <code className="text-[12px] bg-muted/40 px-1 py-0.5 rounded font-mono text-primary/80">
                  {children}
                </code>
              ),
            }}
          >
            {permissionRequest.message}
          </ReactMarkdown>
        </div>

        {/* Action buttons */}
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border/20 bg-muted/5">
          {permissionRequest.options?.map((option, idx) => {
            const isNegative = /no|cancel|deny|reject/i.test(option);
            return (
              <button
                key={idx}
                disabled={isLoading}
                onClick={() => handleOptionClick(option)}
                className={cn(
                  "px-3 py-1.5 text-xs font-medium rounded transition-all duration-150 border",
                  isNegative
                    ? "bg-transparent text-muted-foreground border-border/30 hover:bg-muted/30"
                    : "bg-primary/10 text-primary border-primary/20 hover:bg-primary hover:text-primary-foreground",
                  "disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.97]"
                )}
              >
                {option}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};
