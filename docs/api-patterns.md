# Airbase — API & Edge Function Patterns

These are the canonical patterns for all backend code. Do not deviate without a documented reason.

---

## LLM Router

**File:** `/supabase/functions/_shared/llm-router.ts`

The single entry point for all AI calls in Airbase. All agent Edge Functions import from here — never call any provider SDK directly. The router normalises the request/response format across providers and handles model selection per tenant and per agent type.

### Supported Providers & Models

| Provider | Models | Best for |
|---|---|---|
| `anthropic` | `claude-sonnet-4-6` *(default)*, `claude-opus-4-6` | All agents; highest tool-use reliability |
| `openai` | `gpt-4o`, `gpt-4o-mini` | Fallback; cost optimisation |
| `deepseek` | `deepseek-chat` *(DeepSeek V3/V4)* | Cost-sensitive high-volume tasks (invoice drafting, SMS) |
| `kimi` | `moonshot-v1-8k`, `moonshot-v1-32k`, `moonshot-v1-128k` | Long-context tasks (manual ingestion, bulk analysis) |

### Model Selection Priority (per agent call)

1. **Call-time override** — `options.model` if explicitly passed (e.g. A/B test)
2. **Agent-type config** — `agent_config.model_id` for this tenant + agent type
3. **Tenant default** — `tenants.default_model_id`
4. **Platform default** — `claude-sonnet-4-6` (hardcoded fallback, never changes)

### Tool Use Compatibility

Tool use (structured function calling) is supported on all four providers. The router translates Anthropic's tool schema format into each provider's native format automatically — agents always declare tools in Anthropic format.

```typescript
// /supabase/functions/_shared/llm-router.ts

import Anthropic from "npm:@anthropic-ai/sdk";
import OpenAI from "npm:openai";

// ─── Types ───────────────────────────────────────────────────────────────────

export type ModelProvider = "anthropic" | "openai" | "deepseek" | "kimi";

export interface ModelConfig {
  provider: ModelProvider;
  modelId: string;
  displayName: string;
  maxTokensLimit: number;
  supportsTools: boolean;
  costTier: "low" | "medium" | "high";
}

// Registry of all supported models
export const MODEL_REGISTRY: Record<string, ModelConfig> = {
  // Anthropic
  "claude-sonnet-4-6": {
    provider: "anthropic",
    modelId: "claude-sonnet-4-6",
    displayName: "Claude Sonnet 4.6",
    maxTokensLimit: 8192,
    supportsTools: true,
    costTier: "medium",
  },
  "claude-opus-4-6": {
    provider: "anthropic",
    modelId: "claude-opus-4-6",
    displayName: "Claude Opus 4.6",
    maxTokensLimit: 8192,
    supportsTools: true,
    costTier: "high",
  },
  // OpenAI
  "gpt-4o": {
    provider: "openai",
    modelId: "gpt-4o",
    displayName: "GPT-4o",
    maxTokensLimit: 4096,
    supportsTools: true,
    costTier: "medium",
  },
  "gpt-4o-mini": {
    provider: "openai",
    modelId: "gpt-4o-mini",
    displayName: "GPT-4o Mini",
    maxTokensLimit: 4096,
    supportsTools: true,
    costTier: "low",
  },
  // DeepSeek (OpenAI-compatible API)
  "deepseek-chat": {
    provider: "deepseek",
    modelId: "deepseek-chat",
    displayName: "DeepSeek V4",
    maxTokensLimit: 4096,
    supportsTools: true,
    costTier: "low",
  },
  // Kimi / Moonshot (OpenAI-compatible API)
  "moonshot-v1-8k": {
    provider: "kimi",
    modelId: "moonshot-v1-8k",
    displayName: "Kimi K2.5 (8k)",
    maxTokensLimit: 8192,
    supportsTools: true,
    costTier: "low",
  },
  "moonshot-v1-32k": {
    provider: "kimi",
    modelId: "moonshot-v1-32k",
    displayName: "Kimi K2.5 (32k)",
    maxTokensLimit: 32768,
    supportsTools: true,
    costTier: "low",
  },
  "moonshot-v1-128k": {
    provider: "kimi",
    modelId: "moonshot-v1-128k",
    displayName: "Kimi K2.5 (128k)",
    maxTokensLimit: 131072,
    supportsTools: false, // use for long-context reading only, not tool calls
    costTier: "medium",
  },
};

export const PLATFORM_DEFAULT_MODEL = "claude-sonnet-4-6";

// ─── Normalised tool schema (always declare in Anthropic format) ──────────────

export interface NormalisedTool {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface AgentCallOptions {
  systemPrompt: string;
  userMessage: string;
  tools?: NormalisedTool[];
  maxTokens?: number;
  temperature?: number;
  model?: string; // optional call-time override
  tenantModelId?: string; // from agent_config or tenants.default_model_id
}

export interface ToolUse {
  id: string;
  name: string;
  input: unknown;
}

export interface AgentCallResult {
  text: string;
  toolUses: ToolUse[];
  stopReason: string;
  modelUsed: string;
  providerUsed: ModelProvider;
  usage: { inputTokens: number; outputTokens: number };
}

// ─── Provider clients (lazy-initialised) ─────────────────────────────────────

function getAnthropicClient() {
  return new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY")! });
}

function getOpenAIClient() {
  return new OpenAI({ apiKey: Deno.env.get("OPENAI_API_KEY")! });
}

function getDeepSeekClient() {
  return new OpenAI({
    apiKey: Deno.env.get("DEEPSEEK_API_KEY")!,
    baseURL: "https://api.deepseek.com/v1",
  });
}

function getKimiClient() {
  return new OpenAI({
    apiKey: Deno.env.get("KIMI_API_KEY")!,
    baseURL: "https://api.moonshot.cn/v1",
  });
}

// ─── Tool schema translation ──────────────────────────────────────────────────

// OpenAI/DeepSeek/Kimi all use OpenAI's function-calling format
function toOpenAITools(tools: NormalisedTool[]): OpenAI.ChatCompletionTool[] {
  return tools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema,
    },
  }));
}

function toAnthropicTools(tools: NormalisedTool[]): Anthropic.Tool[] {
  return tools as Anthropic.Tool[]; // identical format
}

// ─── Provider-specific call implementations ───────────────────────────────────

async function callAnthropic(
  modelId: string,
  options: AgentCallOptions
): Promise<AgentCallResult> {
  const client = getAnthropicClient();
  const tools = options.tools ? toAnthropicTools(options.tools) : undefined;

  const response = await client.messages.create({
    model: modelId,
    max_tokens: options.maxTokens ?? 1024,
    temperature: options.temperature ?? 0.2,
    system: options.systemPrompt,
    tools,
    messages: [{ role: "user", content: options.userMessage }],
  });

  const toolUses: ToolUse[] = response.content
    .filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use")
    .map((b) => ({ id: b.id, name: b.name, input: b.input }));

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");

  return {
    text,
    toolUses,
    stopReason: response.stop_reason,
    modelUsed: modelId,
    providerUsed: "anthropic",
    usage: {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    },
  };
}

async function callOpenAICompatible(
  client: OpenAI,
  provider: ModelProvider,
  modelId: string,
  options: AgentCallOptions
): Promise<AgentCallResult> {
  const tools = options.tools ? toOpenAITools(options.tools) : undefined;

  const response = await client.chat.completions.create({
    model: modelId,
    max_tokens: options.maxTokens ?? 1024,
    temperature: options.temperature ?? 0.2,
    tools,
    tool_choice: tools ? "auto" : undefined,
    messages: [
      { role: "system", content: options.systemPrompt },
      { role: "user", content: options.userMessage },
    ],
  });

  const choice = response.choices[0];
  const toolUses: ToolUse[] = (choice.message.tool_calls ?? []).map((tc) => ({
    id: tc.id,
    name: tc.function.name,
    input: JSON.parse(tc.function.arguments),
  }));

  return {
    text: choice.message.content ?? "",
    toolUses,
    stopReason: choice.finish_reason,
    modelUsed: modelId,
    providerUsed: provider,
    usage: {
      inputTokens: response.usage?.prompt_tokens ?? 0,
      outputTokens: response.usage?.completion_tokens ?? 0,
    },
  };
}

// ─── Main exported functions ──────────────────────────────────────────────────

/**
 * Resolve the model to use for this call.
 * Priority: call-time override → tenant agent config → tenant default → platform default
 */
export function resolveModel(options: {
  callTimeOverride?: string;
  tenantModelId?: string;
}): ModelConfig {
  const id =
    options.callTimeOverride ??
    options.tenantModelId ??
    PLATFORM_DEFAULT_MODEL;

  const config = MODEL_REGISTRY[id];
  if (!config) {
    console.warn(`Unknown model "${id}", falling back to platform default`);
    return MODEL_REGISTRY[PLATFORM_DEFAULT_MODEL];
  }
  return config;
}

/**
 * Single-turn agent call. Use for most agents.
 */
export async function callAgent(
  options: AgentCallOptions
): Promise<AgentCallResult> {
  const modelConfig = resolveModel({
    callTimeOverride: options.model,
    tenantModelId: options.tenantModelId,
  });

  switch (modelConfig.provider) {
    case "anthropic":
      return callAnthropic(modelConfig.modelId, options);
    case "openai":
      return callOpenAICompatible(
        getOpenAIClient(), "openai", modelConfig.modelId, options
      );
    case "deepseek":
      return callOpenAICompatible(
        getDeepSeekClient(), "deepseek", modelConfig.modelId, options
      );
    case "kimi":
      return callOpenAICompatible(
        getKimiClient(), "kimi", modelConfig.modelId, options
      );
  }
}

/**
 * Multi-turn agentic loop — handles tool calls automatically until end_turn.
 * Used by dispatch agent and operator agent.
 */
export async function runAgentLoop(
  options: AgentCallOptions & {
    toolHandlers: Record<string, (input: unknown) => Promise<unknown>>;
    maxIterations?: number;
  }
): Promise<{ finalText: string; toolCallCount: number; modelUsed: string }> {
  const { toolHandlers, maxIterations = 5, ...callOptions } = options;
  const modelConfig = resolveModel({
    callTimeOverride: options.model,
    tenantModelId: options.tenantModelId,
  });

  // Anthropic loop
  if (modelConfig.provider === "anthropic") {
    const client = getAnthropicClient();
    const messages: Anthropic.MessageParam[] = [
      { role: "user", content: callOptions.userMessage },
    ];
    let iteration = 0;
    let finalText = "";

    while (iteration < maxIterations) {
      const response = await client.messages.create({
        model: modelConfig.modelId,
        max_tokens: callOptions.maxTokens ?? 1024,
        system: callOptions.systemPrompt,
        tools: callOptions.tools
          ? toAnthropicTools(callOptions.tools)
          : undefined,
        messages,
      });
      messages.push({ role: "assistant", content: response.content });

      if (response.stop_reason === "end_turn") {
        finalText = response.content
          .filter((b): b is Anthropic.TextBlock => b.type === "text")
          .map((b) => b.text)
          .join("\n");
        break;
      }

      if (response.stop_reason === "tool_use") {
        const toolResults: Anthropic.ToolResultBlockParam[] = [];
        for (const block of response.content) {
          if (block.type === "tool_use") {
            const handler = toolHandlers[block.name];
            if (!handler) throw new Error(`No handler for tool: ${block.name}`);
            const result = await handler(block.input);
            toolResults.push({
              type: "tool_result",
              tool_use_id: block.id,
              content: JSON.stringify(result),
            });
          }
        }
        messages.push({ role: "user", content: toolResults });
      }
      iteration++;
    }

    return { finalText, toolCallCount: iteration, modelUsed: modelConfig.modelId };
  }

  // OpenAI-compatible loop (OpenAI, DeepSeek, Kimi)
  const client =
    modelConfig.provider === "openai" ? getOpenAIClient() :
    modelConfig.provider === "deepseek" ? getDeepSeekClient() :
    getKimiClient();

  const messages: OpenAI.ChatCompletionMessageParam[] = [
    { role: "system", content: callOptions.systemPrompt },
    { role: "user", content: callOptions.userMessage },
  ];
  const tools = callOptions.tools
    ? toOpenAITools(callOptions.tools)
    : undefined;
  let iteration = 0;
  let finalText = "";

  while (iteration < maxIterations) {
    const response = await client.chat.completions.create({
      model: modelConfig.modelId,
      max_tokens: callOptions.maxTokens ?? 1024,
      tools,
      tool_choice: tools ? "auto" : undefined,
      messages,
    });
    const choice = response.choices[0];
    messages.push({ role: "assistant", content: choice.message });

    if (choice.finish_reason === "stop") {
      finalText = choice.message.content ?? "";
      break;
    }

    if (choice.finish_reason === "tool_calls") {
      const toolResults: OpenAI.ChatCompletionToolMessageParam[] = [];
      for (const tc of choice.message.tool_calls ?? []) {
        const handler = toolHandlers[tc.function.name];
        if (!handler) throw new Error(`No handler for tool: ${tc.function.name}`);
        const result = await handler(JSON.parse(tc.function.arguments));
        toolResults.push({
          role: "tool",
          tool_call_id: tc.id,
          content: JSON.stringify(result),
        });
      }
      messages.push(...toolResults);
    }
    iteration++;
  }

  return { finalText, toolCallCount: iteration, modelUsed: modelConfig.modelId };
}
```

---

## Edge Function Base Pattern

Every Edge Function follows this structure:

```typescript
// /supabase/functions/[function-name]/index.ts

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // 1. Auth — extract tenant from JWT
    const authHeader = req.headers.get("Authorization");
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // 2. Parse request
    const body = await req.json();

    // 3. Business logic here
    const result = await doWork(supabase, body);

    // 4. Return result
    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200
    });

  } catch (error) {
    console.error("Function error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});
```

---

## Agent Action Logger

```typescript
// /supabase/functions/_shared/agent-logger.ts

export async function logAgentAction(supabase: SupabaseClient, options: {
  tenantId: string;
  agentType: string;
  triggerEvent: string;
  contextSnapshot: Record<string, unknown>;
  reasoning: string;
  proposedAction: Record<string, unknown>;
  confidence: number;
  autoExecute: boolean;
}) {
  const { data, error } = await supabase
    .from("agent_actions")
    .insert({
      tenant_id: options.tenantId,
      agent_type: options.agentType,
      trigger_event: options.triggerEvent,
      context_snapshot: options.contextSnapshot,
      reasoning: options.reasoning,
      proposed_action: options.proposedAction,
      confidence: options.confidence,
      status: options.autoExecute ? "auto_executed" : "proposed",
      executed_at: options.autoExecute ? new Date().toISOString() : null
    })
    .select("id")
    .single();

  if (error) throw error;
  return data.id;
}
```

---

## Supabase Client Pattern (React)

```typescript
// /src/lib/supabase.ts
import { createClient } from "@supabase/supabase-js";
import type { Database } from "./database.types"; // generated by supabase gen types

export const supabase = createClient<Database>(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

// For realtime subscriptions, use separate client to avoid auth conflicts
export const realtimeClient = createClient<Database>(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);
```

---

## Twilio Webhook Handler Pattern

```typescript
// /supabase/functions/twilio-sms-webhook/index.ts
// Twilio sends form-encoded POST, not JSON

serve(async (req: Request) => {
  const formData = await req.formData();
  
  const from = formData.get("From") as string;   // customer phone
  const to = formData.get("To") as string;         // our Twilio number
  const body = formData.get("Body") as string;     // message text
  const messageSid = formData.get("MessageSid") as string;

  // Look up tenant by their Twilio number
  const { data: tenant } = await supabase
    .from("tenants")
    .select("id, name")
    .eq("twilio_phone_number", to)
    .single();

  if (!tenant) {
    return new Response("<?xml version='1.0'?><Response></Response>", {
      headers: { "Content-Type": "text/xml" }
    });
  }

  // Hand off to booking agent asynchronously
  // Don't await — Twilio needs response within 15 seconds
  EdgeRuntime.waitUntil(
    invokeBookingAgent(tenant.id, from, body, messageSid)
  );

  // Return empty TwiML immediately (agent will send reply via Twilio API)
  return new Response("<?xml version='1.0'?><Response></Response>", {
    headers: { "Content-Type": "text/xml" }
  });
});
```

---

## Environment Variables Required

```bash
# .env.local (never commit)
VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...

# Supabase Edge Function secrets (set via: supabase secrets set KEY=value)

# AI Providers — only ANTHROPIC_API_KEY is required at launch.
# Others are optional and only needed if a tenant routes to that provider.
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...           # optional
DEEPSEEK_API_KEY=sk-...         # optional — https://platform.deepseek.com
KIMI_API_KEY=sk-...             # optional — https://platform.moonshot.cn

# Communications
TWILIO_ACCOUNT_SID=AC...
TWILIO_AUTH_TOKEN=...

# Payments
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...

# Integrations
GOOGLE_MAPS_API_KEY=...
QBO_CLIENT_ID=...
QBO_CLIENT_SECRET=...
SENDGRID_API_KEY=SG...
```

### Runtime Key Validation

The router will throw at call-time if the required API key for the selected provider is not set. Always validate keys exist before deploying a tenant that uses a non-Anthropic provider:

```typescript
// In the Edge Function, before calling any agent:
import { resolveModel } from "../_shared/llm-router.ts";

const model = resolveModel({ tenantModelId: tenant.default_model_id });
const keyMap: Record<string, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  deepseek: "DEEPSEEK_API_KEY",
  kimi: "KIMI_API_KEY",
};
if (!Deno.env.get(keyMap[model.provider])) {
  throw new Error(`API key not configured for provider: ${model.provider}`);
}
```
