"use client";

import React, { useRef, useState } from "react";
import { ArrowUp, Paperclip } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";

export const ChatInput = () => {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setValue(e.target.value);
    
    // Auto-resize textarea
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
    }
  };

  return (
    <div className="absolute bottom-6 left-1/2 -translate-x-1/2 w-full max-w-3xl px-4 z-20">
      <div className="relative flex items-end w-full rounded-3xl bg-background border shadow-lg overflow-hidden transition-shadow focus-within:shadow-xl focus-within:border-ring/50">
        <button className="p-3 text-muted-foreground hover:text-foreground transition-colors rounded-full mb-1 ml-1">
          <Paperclip className="w-5 h-5" />
        </button>
        
        <Textarea
          ref={textareaRef}
          value={value}
          onChange={handleInput}
          placeholder="Ask anything about the map..."
          className="flex-1 min-h-[56px] max-h-[200px] border-0 focus-visible:ring-0 shadow-none resize-none py-4 px-2 text-base bg-transparent"
          rows={1}
          style={{ overflowY: value.split('\n').length > 5 ? 'auto' : 'hidden' }}
        />
        
        <button 
          disabled={!value.trim()}
          className="p-2 m-2 mb-2 rounded-full bg-primary text-primary-foreground disabled:bg-muted disabled:text-muted-foreground transition-colors hover:bg-primary/90"
        >
          <ArrowUp className="w-5 h-5" />
        </button>
      </div>
      
      <div className="text-center mt-2 text-xs text-muted-foreground font-medium">
        Mapsense AI can make mistakes. Verify important geospatial data.
      </div>
    </div>
  );
};
