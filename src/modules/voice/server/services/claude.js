// Claude conversation agent — drives the AI side of every call.
// Called on each final transcript from Deepgram.
// Returns the agent's spoken reply and any tool calls to execute.

import Anthropic from '@anthropic-ai/sdk'
import { TOOL_DEFINITIONS, SUMMARY_TURN_THRESHOLD } from '../agents/base-agent.js'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

/**
 * Send the latest transcript turn to Claude and get a response.
 *
 * @param {{
 *   systemPrompt:        string,
 *   modelId:             string,
 *   conversationHistory: Array<{ role: 'user'|'assistant', content: string }>,
 *   state:               string,
 *   toolDefinitions?:    Array<object>,
 * }} opts
 * @returns {Promise<{
 *   text:      string | null,
 *   toolCalls: Array<{ name: string, input: Record<string, unknown> }>,
 *   newState:  null,
 * }>}
 */
export async function callAgent({ systemPrompt, modelId, conversationHistory, state, toolDefinitions }) {
  const model    = modelId ?? 'claude-sonnet-4-6'
  const system   = buildSystemPrompt(systemPrompt, state)
  const messages = buildMessages(conversationHistory)
  const tools    = toolDefinitions ?? TOOL_DEFINITIONS

  const response = await client.messages.create({
    model,
    system,
    messages,
    tools,
    temperature: 0.2,   // low temp for consistent, decision-quality responses
    max_tokens:  1024,
  })

  const text      = extractText(response)
  const toolCalls = extractToolCalls(response)

  return { text, toolCalls, newState: null }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildSystemPrompt(basePrompt, state) {
  return `${basePrompt}

Current conversation state: ${state}

Remember:
- 1–3 sentences maximum per response. This is a phone call.
- One question at a time.
- Use tools to act — do not describe what you are about to do, just do it.`
}

/**
 * Build the Anthropic messages array from conversation history.
 * If the history is long, older turns are collapsed into a summary block
 * to stay well within the context window without losing recent context.
 */
function buildMessages(history) {
  if (history.length <= SUMMARY_TURN_THRESHOLD) return history

  // Keep the last 6 items (3 full exchanges); summarize everything before
  const recent = history.slice(-6)
  const older  = history.slice(0, -6)

  const summaryText = older
    .map(m => `${m.role === 'user' ? 'Caller' : 'Agent'}: ${m.content}`)
    .join('\n')

  // Inject summary as the opening exchange so the API sees valid alternating turns
  return [
    {
      role:    'user',
      content: `[Summary of earlier conversation]\n${summaryText}\n[End summary — continue from here]`,
    },
    {
      role:    'assistant',
      content: 'Understood, I have the context from earlier in our call.',
    },
    ...recent,
  ]
}

function extractText(response) {
  const block = response.content.find(b => b.type === 'text')
  return block?.text?.trim() || null
}

function extractToolCalls(response) {
  return response.content
    .filter(b => b.type === 'tool_use')
    .map(b => ({ name: b.name, input: b.input }))
}
