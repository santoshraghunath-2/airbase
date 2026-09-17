import { useState, useRef, useEffect } from "react";
import { Bot, Send, X, Minimize2, Maximize2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/lib/supabase";

interface Message {
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  pending_action?: { tool: string; input: Record<string, unknown>; description: string } | null;
}

export default function OperatorCommandPanel() {
  const [open, setOpen] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [chatId, setChatId] = useState<string | undefined>();
  const [pendingAction, setPendingAction] = useState<{
    tool: string;
    input: Record<string, unknown>;
    description: string;
  } | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function sendMessage(text: string, confirmedAction?: { tool: string; input: Record<string, unknown> }) {
    const userMessage: Message = { role: "user", content: text, timestamp: new Date().toISOString() };
    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setPendingAction(null);
    setLoading(true);

    try {
      const { data, error } = await supabase.functions.invoke("operator-agent", {
        body: {
          message: text,
          chat_id: chatId,
          confirmed_action: confirmedAction,
        },
      });

      if (error) throw error;

      if (!chatId && data.chat_id) setChatId(data.chat_id as string);

      const assistantMessage: Message = {
        role: "assistant",
        content: data.reply as string,
        timestamp: new Date().toISOString(),
        pending_action: data.pending_action as Message["pending_action"],
      };
      setMessages((prev) => [...prev, assistantMessage]);

      if (data.pending_action) {
        setPendingAction(data.pending_action as { tool: string; input: Record<string, unknown>; description: string });
      }
    } catch {
      toast.error("AI assistant error — try again");
      setMessages((prev) => prev.slice(0, -1)); // remove optimistic user message
    } finally {
      setLoading(false);
    }
  }

  function handleSubmit() {
    const text = input.trim();
    if (!text || loading) return;

    // If typing "yes", "confirm", "do it" and there's a pending action, execute it
    const confirmWords = ["yes", "confirm", "do it", "ok", "okay", "go ahead", "proceed"];
    if (pendingAction && confirmWords.some((w) => text.toLowerCase().includes(w))) {
      void sendMessage(text, pendingAction);
      return;
    }

    void sendMessage(text);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-full bg-blue-600 px-4 py-3 text-white shadow-lg hover:bg-blue-700 transition-colors"
      >
        <Bot className="h-5 w-5" />
        <span className="text-sm font-medium">Ask AI</span>
      </button>
    );
  }

  return (
    <div
      className={`fixed bottom-6 right-6 z-50 flex flex-col rounded-xl border bg-background shadow-2xl transition-all duration-200 ${
        minimized ? "h-14 w-80" : "h-[520px] w-[400px]"
      }`}
    >
      {/* Header */}
      <div className="flex items-center gap-2 rounded-t-xl border-b bg-blue-600 px-4 py-3 text-white">
        <Bot className="h-4 w-4" />
        <span className="text-sm font-semibold flex-1">Operator Assistant</span>
        <button onClick={() => setMinimized((m) => !m)} className="rounded p-0.5 hover:bg-blue-500">
          {minimized ? <Maximize2 className="h-3.5 w-3.5" /> : <Minimize2 className="h-3.5 w-3.5" />}
        </button>
        <button onClick={() => setOpen(false)} className="rounded p-0.5 hover:bg-blue-500">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {!minimized && (
        <>
          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {messages.length === 0 && (
              <div className="text-center text-sm text-muted-foreground mt-8 space-y-2">
                <Bot className="h-8 w-8 mx-auto opacity-30" />
                <p>Ask anything about your business.</p>
                <p className="text-xs opacity-60">
                  "What's my revenue this week?" · "Who's my busiest tech?" · "Show overdue invoices"
                </p>
              </div>
            )}

            {messages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm ${
                    msg.role === "user"
                      ? "bg-blue-600 text-white"
                      : "bg-muted text-foreground"
                  }`}
                >
                  <p className="whitespace-pre-wrap">{msg.content}</p>
                  {msg.pending_action && (
                    <div className="mt-2 rounded-lg bg-yellow-50 border border-yellow-200 p-2 text-xs text-yellow-800">
                      <p className="font-medium">Confirm action?</p>
                      <p>{msg.pending_action.description}</p>
                      <p className="mt-1 opacity-70">Reply "yes" to confirm or rephrase to cancel.</p>
                    </div>
                  )}
                </div>
              </div>
            ))}

            {loading && (
              <div className="flex justify-start">
                <div className="bg-muted rounded-2xl px-4 py-2.5">
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div className="border-t p-3 flex gap-2">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={pendingAction ? 'Type "yes" to confirm or ask something else' : "Ask anything..."}
              className="resize-none text-sm min-h-[40px] max-h-[100px]"
              rows={1}
              disabled={loading}
            />
            <Button
              size="icon"
              className="h-10 w-10 shrink-0 bg-blue-600 hover:bg-blue-700"
              onClick={handleSubmit}
              disabled={loading || !input.trim()}
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
