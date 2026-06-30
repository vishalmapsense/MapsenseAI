"use client";

import React, { useRef, useState, useCallback, useEffect } from "react";
import { ArrowUp, Paperclip } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { useChatStore } from "@/stores/useChatStore";
import { Spinner } from "@/components/ui/spinner";

export const ChatInput = ({ isSplit = false }: { isSplit?: boolean }) => {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { sendMessage, isLoading } = useChatStore();

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setValue(e.target.value);

    // Auto-resize textarea
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
    }
  };

  const handleSubmit = useCallback(async () => {
    const trimmed = value.trim();
    if (!trimmed || isLoading) return;

    setValue("");
    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }

    await sendMessage(trimmed);
  }, [value, isLoading, sendMessage]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  // Focus textarea on mount
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const canSubmit = value.trim().length > 0 && !isLoading;

  return (
    <div className="w-full z-20 pointer-events-none">
      <div className="relative flex items-end w-full rounded-3xl bg-background border shadow-lg overflow-hidden transition-shadow focus-within:shadow-xl focus-within:border-ring/50 pointer-events-auto">
        <button
          className="p-3 text-muted-foreground hover:text-foreground transition-colors rounded-full mb-1 ml-1"
          title="Attach file"
          type="button"
        >
          <Paperclip className="w-5 h-5" />
        </button>

        <Textarea
          ref={textareaRef}
          value={value}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          placeholder="Ask anything about the map..."
          className="flex-1 min-h-[56px] max-h-[200px] border-0 focus-visible:ring-0 shadow-none resize-none py-4 px-2 text-base bg-transparent"
          rows={1}
          disabled={isLoading}
          style={{ overflowY: value.split("\n").length > 5 ? "auto" : "hidden" }}
        />

        <button
          onClick={handleSubmit}
          disabled={!canSubmit}
          type="button"
          className="p-2 m-2 mb-2 rounded-full bg-primary text-primary-foreground disabled:bg-muted disabled:text-muted-foreground transition-colors hover:bg-primary/90 flex items-center justify-center"
        >
          {isLoading ? (
            <Spinner className="w-5 h-5" />
          ) : (
            <ArrowUp className="w-5 h-5" />
          )}
        </button>
      </div>

      <div className="text-center mt-0.5 text-[10px] text-muted-foreground/70">
        Mapsense AI can make mistakes. Verify important geospatial data.
      </div>
    </div>
  );
};
