"use client";

import React, { useRef, useState, useCallback, useEffect } from "react";
import { ArrowUp, Plus, Mic, ChevronUp, Check } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { useChatStore } from "@/stores/useChatStore";
import { Spinner } from "@/components/ui/spinner";
import { useModelSettingsStore, ALL_MODELS } from "@/stores/useModelSettingsStore";
import { motion, AnimatePresence } from "framer-motion";

const ModelSelector = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const { getSelectedModel, setSelectedModel } = useModelSettingsStore();
  const selectedModel = getSelectedModel();
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Fix hydration mismatch by tracking mount
  useEffect(() => {
    setMounted(true);
  }, []);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const defaultModel = ALL_MODELS.find(m => m.id === "gemini-3.5-flash");
  const displayName = mounted 
    ? (selectedModel?.name || "Select Model") 
    : (defaultModel?.name || "Select Model");

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1.5 px-2 py-1 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50 rounded-lg transition-colors whitespace-nowrap"
      >
        {displayName}
        <ChevronUp className="w-3 h-3" />
      </button>
      
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            transition={{ duration: 0.15 }}
            className="absolute bottom-full left-0 mb-2 w-64 bg-background border border-border shadow-xl rounded-xl p-1 z-50 max-h-[300px] overflow-y-auto flex flex-col gap-0.5"
          >
            {ALL_MODELS.filter(m => !m.isDisabled).map(model => (
              <button
                key={model.id}
                onClick={() => {
                  setSelectedModel(model.id);
                  setIsOpen(false);
                }}
                className={`flex items-center justify-between w-full text-left px-3 py-2 text-xs rounded-lg transition-colors ${
                  selectedModel?.id === model.id
                    ? "bg-primary/10 text-primary font-medium"
                    : "hover:bg-muted/50 text-foreground"
                }`}
              >
                {model.name}
                {selectedModel?.id === model.id && <Check className="w-3 h-3" />}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export const ChatInput = ({ isSplit = false }: { isSplit?: boolean }) => {
  const [value, setValue] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const recognitionRef = useRef<any>(null);
  const originalValueRef = useRef("");
  
  const { sendMessage, isLoading } = useChatStore();

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setValue(e.target.value);
    // Auto-resize textarea
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 150)}px`;
    }
  };

  const toggleRecording = useCallback(() => {
    if (isRecording) {
      recognitionRef.current?.stop();
      setIsRecording(false);
      return;
    }

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert("Speech recognition is not supported in this browser. Please use Chrome or Edge.");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = "en-IN";
    recognition.interimResults = true;
    recognition.continuous = true;

    // Store the text that was already in the input before we started speaking
    originalValueRef.current = value ? value.trim() + " " : "";

    recognition.onresult = (event: any) => {
      let interimTranscript = "";
      let finalTranscript = "";

      for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) {
          finalTranscript += event.results[i][0].transcript;
        } else {
          interimTranscript += event.results[i][0].transcript;
        }
      }
      
      if (finalTranscript) {
        originalValueRef.current += finalTranscript + " ";
        setValue(originalValueRef.current + interimTranscript);
      } else {
        setValue(originalValueRef.current + interimTranscript);
      }
      
      if (textareaRef.current) {
        textareaRef.current.style.height = "auto";
        textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 150)}px`;
      }
    };

    recognition.onerror = (event: any) => {
      if (event.error === 'no-speech') {
        // Ignore "no-speech" errors as they just mean the user was silent
        setIsRecording(false);
        return;
      }
      console.error("Speech recognition error:", event.error);
      setIsRecording(false);
    };

    recognition.onend = () => {
      setIsRecording(false);
    };

    recognitionRef.current = recognition;
    recognition.start();
    setIsRecording(true);
  }, [isRecording, value]);

  // Clean up recognition on unmount
  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
    };
  }, []);

  const handleSubmit = useCallback(async () => {
    if (isRecording) {
      recognitionRef.current?.stop();
      setIsRecording(false);
    }

    const trimmed = value.trim();
    if (!trimmed || isLoading) return;

    setValue("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }

    await sendMessage(trimmed);
  }, [value, isLoading, sendMessage, isRecording]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const canSubmit = value.trim().length > 0 && !isLoading;

  return (
    <div className="w-full z-20 pointer-events-none px-2 pb-2">
      <div className={`relative flex flex-col w-full rounded-[20px] bg-background border ${isRecording ? 'border-red-500/50 shadow-red-500/10' : 'border-border/50'} shadow-md focus-within:shadow-lg focus-within:border-border pointer-events-auto p-2 transition-all`}>
        
        {/* Input */}
        <Textarea
          ref={textareaRef}
          value={value}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          placeholder={isRecording ? "Listening..." : "Message Mapsense..."}
          className="w-full min-h-[40px] max-h-[150px] border-0 focus-visible:ring-0 shadow-none resize-none py-1.5 px-2 text-[13px] bg-transparent !ring-0 !outline-none"
          rows={1}
          disabled={isLoading}
          style={{ overflowY: value.split("\n").length > 4 ? "auto" : "hidden" }}
        />

        {/* Bottom Actions Row */}
        <div className="flex items-center justify-between w-full mt-1">
          {/* Left side actions */}
          <div className="flex items-center gap-1">
            <button
              type="button"
              title="Attach file"
              className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted/50 rounded-full transition-colors shrink-0"
            >
              <Plus className="w-4 h-4" />
            </button>

            <ModelSelector />
          </div>

          {/* Right side actions */}
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={toggleRecording}
              title={isRecording ? "Stop recording" : "Voice input"}
              className={`p-1.5 rounded-full transition-colors shrink-0 flex items-center justify-center ${
                isRecording 
                  ? "bg-red-500/10 text-red-500 hover:bg-red-500/20 animate-pulse" 
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
              }`}
            >
              <Mic className="w-4 h-4" />
            </button>

            <button
              onClick={handleSubmit}
              disabled={!canSubmit}
              type="button"
              className={`p-1.5 rounded-full transition-colors shrink-0 flex items-center justify-center h-8 w-8 ${
                canSubmit 
                  ? "bg-primary text-primary-foreground hover:bg-primary/90" 
                  : "bg-muted text-muted-foreground"
              }`}
            >
              {isLoading ? (
                <Spinner className="w-4 h-4" />
              ) : (
                <ArrowUp className="w-4 h-4" />
              )}
            </button>
          </div>
        </div>
      </div>

      <div className="text-center mt-1 text-[10px] text-muted-foreground/70 pointer-events-auto">
        Mapsense AI can make mistakes. Verify important geospatial data.
      </div>
    </div>
  );
};
