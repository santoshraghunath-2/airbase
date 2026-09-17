// THE single AI entry point. All agent Edge Functions import from here.
// Never call any provider SDK directly in an agent function.

import Anthropic from "npm:@anthropic-ai/sdk";
import OpenAI from "npm:openai";

// ─── Types ───────────────────────────────────────────────────────────────────

export type ModelProvider = "anthropic" | "openai" | "deepseek";

export interface ModelConfig {
  provider: ModelProvider;
  modelId: string;
  displayName: string;
  maxTokensLimit: number;
  supportsTools: boolean;
  costTier: "low" | "medium" | "high";
}

export const MODEL_REGISTRY: Record<string, ModelConfig> = {
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
  // deepseek-flash = DeepSeek V4.1 Flash: 1M context, tool calls, $0.15/1M input
  "deepseek-flash": {
    provider: "deepseek",
    modelId: "deepseek-flash",
    displayName: "DeepSeek V4.1 Flash",
    maxTokensLimit: 8192,
    supportsTools: true,
    costTier: "low",
  },
  "deepseek-v4-pro": {
    provider: "deepseek",
    modelId: "deepseek-v4-pro",
    displayName: "DeepSeek V4 Pro",
    maxTokensLimit: 8192,
    supportsTools: true,
    costTier: "medium",
  },
  // Legacy alias — kept so old agent_config rows resolve
  "deepseek-chat": {
    provider: "deepseek",
    modelId: "deepseek-flash",
    displayName: "DeepSeek (legacy → Flash)",
    maxTokensLimit: 8192,
    supportsTools: true,
    costTier: "low",
  },
};

// DeepSeek V4.1 Flash: 1M context, tool calls, $0.15/1M input — default for all agents.
export const PLATFORM_DEFAULT_MODEL = "deepseek-flash";

// ─── Tool schema (always declare in Anthropic format; router translates) ──────

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
  model?: string;
  tenantModelId?: string;
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

// ─── Provider clients ─────────────────────────────────────────────────────────

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

// ─── Tool schema translation ──────────────────────────────────────────────────

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
  return tools as Anthropic.Tool[];
}

// ─── Provider implementations ─────────────────────────────────────────────────

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
    stopReason: response.stop_reason ?? "end_turn",
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
    input: JSON.parse(tc.function.arguments) as unknown,
  }));

  return {
    text: choice.message.content ?? "",
    toolUses,
    stopReason: choice.finish_reason ?? "stop",
    modelUsed: modelId,
    providerUsed: provider,
    usage: {
      inputTokens: response.usage?.prompt_tokens ?? 0,
      outputTokens: response.usage?.completion_tokens ?? 0,
    },
  };
}

// ─── Exported API ─────────────────────────────────────────────────────────────

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

export async function callAgent(options: AgentCallOptions): Promise<AgentCallResult> {
  const modelConfig = resolveModel({
    callTimeOverride: options.model,
    tenantModelId: options.tenantModelId,
  });

  switch (modelConfig.provider) {
    case "anthropic":
      return callAnthropic(modelConfig.modelId, options);
    case "openai":
      return callOpenAICompatible(getOpenAIClient(), "openai", modelConfig.modelId, options);
    case "deepseek":
      return callOpenAICompatible(getDeepSeekClient(), "deepseek", modelConfig.modelId, options);
  }
}

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
        tools: callOptions.tools ? toAnthropicTools(callOptions.tools) : undefined,
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

  // OpenAI-compatible loop
  const client =
    modelConfig.provider === "openai"
      ? getOpenAIClient()
      : getDeepSeekClient();

  const messages: OpenAI.ChatCompletionMessageParam[] = [
    { role: "system", content: callOptions.systemPrompt },
    { role: "user", content: callOptions.userMessage },
  ];
  const tools = callOptions.tools ? toOpenAITools(callOptions.tools) : undefined;
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
    messages.push({ role: "assistant", content: choice.message } as OpenAI.ChatCompletionMessageParam);

    if (choice.finish_reason === "stop") {
      finalText = choice.message.content ?? "";
      break;
    }

    if (choice.finish_reason === "tool_calls") {
      const toolResults: OpenAI.ChatCompletionToolMessageParam[] = [];
      for (const tc of choice.message.tool_calls ?? []) {
        const handler = toolHandlers[tc.function.name];
        if (!handler) throw new Error(`No handler for tool: ${tc.function.name}`);
        const result = await handler(JSON.parse(tc.function.arguments) as unknown);
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
