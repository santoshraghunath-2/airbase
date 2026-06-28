import { useState, useRef, useEffect, useCallback } from "react";
import { MessageCircle, X, Send, Loader2, Sparkles } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

interface Message {
  role: "user" | "assistant";
  content: string;
}

const ANOMALY_PROMPT = "Check for any issues that need my attention right now.";

export default function OperatorChatPanel() {
  const [open, setOpen]           = useState(false);
  const [messages, setMessages]   = useState<Message[]>([]);
  const [input, setInput]         = useState("");
  const [loading, setLoading]     = useState(false);
  const [hasChecked, setHasChecked] = useState(false);
  const bottomRef                 = useRef<HTMLDivElement>(null);
  const textareaRef               = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Auto-run anomaly check on first open
  useEffect(() => {
    if (open && !hasChecked && messages.length === 0) {
      setHasChecked(true);
      void sendMessage(ANOMALY_PROMPT, true);
    }
    if (open) {
      setTimeout(() => textareaRef.current?.focus(), 100);
    }
  }, [open]);

  const sendMessage = useCallback(async (text: string, isAuto = false) => {
    const trimmed = text.trim();
    if (!trimmed || loading) return;

    const userMsg: Message = { role: "user", content: trimmed };
    const history = isAuto ? [] : messages;

    setMessages((prev) => isAuto ? [userMsg] : [...prev, userMsg]);
    setInput("");
    setLoading(true);

    try {
      const { data, error } = await supabase.functions.invoke("operator-agent", {
        body: { message: trimmed, history: history.slice(-8) },
      });

      if (error) throw error;

      const assistantMsg: Message = {
        role: "assistant",
        content: (data as { answer: string }).answer ?? "Sorry, I couldn't get a response.",
      };
      setMessages((prev) => [...prev, assistantMsg]);
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
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      void sendMessage(input);
    }
  };

  const QUICK_PROMPTS = [
    "How many jobs today?",
    "Who's available right now?",
    "Revenue this week?",
  ];

  return (
    <>
      {/* Floating trigger button */}
      <button
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "fixed bottom-6 right-6 z-50 h-14 w-14 rounded-full shadow-lg flex items-center justify-center transition-all",
          open
            ? "bg-slate-700 text-white hover:bg-slate-600"
            : "bg-blue-600 text-white hover:bg-blue-700",
        )}
        aria-label="Open operator assistant"
      >
        {open ? <X className="h-5 w-5" /> : <MessageCircle className="h-6 w-6" />}
      </button>

      {/* Chat panel */}
      {open && (
        <div className="fixed bottom-24 right-6 z-50 w-[360px] max-h-[520px] flex flex-col rounded-2xl shadow-2xl border bg-background overflow-hidden">
          {/* Header */}
          <div className="flex items-center gap-2 px-4 py-3 border-b bg-slate-950 text-white">
            <Sparkles className="h-4 w-4 text-blue-400" />
            <span className="font-semibold text-sm">Operator Assistant</span>
            <button
              onClick={() => setOpen(false)}
              className="ml-auto text-slate-400 hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 min-h-0">
            {messages.length === 0 && !loading && (
              <div className="text-center py-6 space-y-3">
                <p className="text-sm text-muted-foreground">
                  Ask anything about your business.
                </p>
                <div className="flex flex-col gap-1.5">
                  {QUICK_PROMPTS.map((p) => (
                    <button
                      key={p}
                      onClick={() => void sendMessage(p)}
                      className="text-xs text-left px-3 py-2 rounded-lg bg-muted hover:bg-muted/80 transition-colors"
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
                className={cn("flex", msg.role === "user" ? "justify-end" : "justify-start")}
              >
                <div
                  className={cn(
                    "rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed max-w-[88%] whitespace-pre-wrap",
                    msg.role === "user"
                      ? "bg-blue-600 text-white rounded-tr-sm"
                      : "bg-muted text-foreground rounded-tl-sm",
                  )}
                >
                  {msg.content}
                </div>
              </div>
            ))}

            {loading && (
              <div className="flex justify-start">
                <div className="bg-muted rounded-2xl rounded-tl-sm px-3.5 py-2.5">
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div className="border-t px-3 py-2.5 flex gap-2 items-end">
            <Textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask about jobs, revenue, techs… (⌘↵)"
              className="resize-none text-sm min-h-[60px] max-h-[120px]"
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
      )}
    </>
  );
}
