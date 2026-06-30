import { useState, useRef, useEffect, useCallback } from "react";
import { Send, Loader2, Bot, BookOpen } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

interface Message {
  role: "user" | "assistant";
  content: string;
  sources?: string[];
}

const QUICK_PROMPTS = [
  "Water heater pilot won't stay lit",
  "How do I explain a slab leak to a homeowner?",
  "P-trap sizing for a kitchen sink",
  "Tripped breaker keeps tripping",
];

export default function TechChatTab() {
  const [messages, setMessages]   = useState<Message[]>([]);
  const [input, setInput]         = useState("");
  const [loading, setLoading]     = useState(false);
  const bottomRef                 = useRef<HTMLDivElement>(null);
  const textareaRef               = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sendMessage = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || loading) return;

    const userMsg: Message = { role: "user", content: trimmed };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setLoading(true);

    try {
      const { data, error } = await supabase.functions.invoke("tech-assistant", {
        body: {
          message: trimmed,
          history: messages.slice(-6).map((m) => ({ role: m.role, content: m.content })),
        },
      });

      if (error) throw error;

      const resp = data as { answer: string; sources_used?: string[] };
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: resp.answer ?? "No response.",
          sources: resp.sources_used?.length ? resp.sources_used : undefined,
        },
      ]);
    } catch (e) {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: `Error: ${(e as Error).message}` },
      ]);
    } finally {
      setLoading(false);
    }
  }, [messages, loading]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void sendMessage(input);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-3 border-b border-line bg-paper flex items-center gap-2">
        <Bot className="h-4 w-4 text-ai" />
        <span className="font-semibold text-sm text-ink">Tech Assistant</span>
        <span className="ml-auto text-xs text-ink-muted">AI + manuals</span>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 bg-bone">
        {messages.length === 0 && !loading && (
          <div className="py-4 space-y-4">
            <p className="text-sm text-ink-muted text-center">
              Ask about troubleshooting, installs, or how to explain something to a homeowner.
            </p>
            <div className="space-y-2">
              {QUICK_PROMPTS.map((p) => (
                <button
                  key={p}
                  onClick={() => void sendMessage(p)}
                  className="w-full text-xs text-left px-3 py-2.5 rounded-xl bg-paper border border-line hover:bg-raised transition-colors text-ink"
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div
            key={i}
            className={cn("flex flex-col gap-1", msg.role === "user" ? "items-end" : "items-start")}
          >
            <div
              className={cn(
                "rounded-2xl px-4 py-3 text-sm leading-relaxed max-w-[92%] whitespace-pre-wrap",
                msg.role === "user"
                  ? "bg-ink text-paper rounded-tr-sm"
                  : "bg-paper border border-line text-ink rounded-tl-sm",
              )}
            >
              {msg.content}
            </div>
            {msg.sources && msg.sources.length > 0 && (
              <div className="flex items-center gap-1 text-xs text-ink-muted px-1">
                <BookOpen className="h-3 w-3" />
                <span>{msg.sources.join(", ")}</span>
              </div>
            )}
          </div>
        ))}

        {loading && (
          <div className="flex items-start">
            <div className="bg-paper border border-line rounded-2xl rounded-tl-sm px-4 py-3">
              <Loader2 className="h-4 w-4 animate-spin text-ink-muted" />
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="border-t border-line px-3 py-2.5 flex gap-2 items-end bg-paper">
        <Textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask a field question… (Enter to send)"
          className="resize-none text-sm min-h-[52px] max-h-[140px]"
          rows={2}
        />
        <Button
          size="sm"
          className="h-9 w-9 p-0 flex-shrink-0"
          disabled={!input.trim() || loading}
          onClick={() => void sendMessage(input)}
        >
          <Send className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
