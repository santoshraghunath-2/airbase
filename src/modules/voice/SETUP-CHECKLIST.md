# Airbase Voice Module — Setup Checklist

Complete this before running the module for the first time.
Work through each section in order.

---

## 1. Twilio Setup

**Account**
- [ ] Log in to twilio.com
- [ ] Copy `Account SID` → `VOICE_TWILIO_ACCOUNT_SID`
- [ ] Copy `Auth Token` → `VOICE_TWILIO_AUTH_TOKEN`

**Phone Numbers**
- [ ] Buy a Bay Area number for GGB Express (area code 415, 510, 650, 408, or 925)
  → Copy full number with country code → `VOICE_TWILIO_PHONE_NUMBER_GGB`
- [ ] Buy a Houston number for Recast Texas (area code 713, 281, 346, or 832)
  → Copy full number → `VOICE_TWILIO_PHONE_NUMBER_RECAST`

**Webhook Configuration (after server is deployed)**
- [ ] GGB Express number → Voice webhook → `https://[your-domain]/voice/inbound`
- [ ] Recast Texas number → Voice webhook → `https://[your-domain]/voice/inbound`
- [ ] Both numbers → Status callback → `https://[your-domain]/voice/status`
- [ ] Both numbers → HTTP method = POST

**Media Streams**
- [ ] Verify your Twilio account has Media Streams enabled (it's on by default for most accounts)
- [ ] No special configuration needed — the TwiML in the code handles it

---

## 2. Deepgram Setup

- [ ] Create account at deepgram.com
- [ ] Create a new API key (name it "airbase-voice-production")
- [ ] Copy key → `VOICE_DEEPGRAM_API_KEY`
- [ ] Note: $200 free credit is applied automatically on signup — no billing needed to start

**Model to use:** `nova-2-phonecall` (optimized for 8kHz telephone audio)

---

## 3. Cartesia Setup

- [ ] Create account at cartesia.ai
- [ ] Navigate to API Keys → Create new key → `VOICE_CARTESIA_API_KEY`
- [ ] Navigate to Voice Library → choose or clone voices

**Voice Selection:**
- For GGB Express (Alex): Choose a warm, professional American English voice
  → Copy voice ID → `VOICE_CARTESIA_VOICE_ID_GGB`
- For Recast Texas (Jordan): Choose a slightly warmer, friendly Southern-neutral voice
  → Copy voice ID → `VOICE_CARTESIA_VOICE_ID_RECAST`

**Output format to request:** `audio/pcm` at 8000Hz (matches Twilio mulaw)
Alternatively request `audio/mpeg` and transcode — but direct PCM is lower latency.

---

## 4. Anthropic API Key

- [ ] Already configured in Airbase as `ANTHROPIC_API_KEY`
- [ ] The Voice Module reuses this key — no new key needed
- [ ] Verify the key has access to `claude-sonnet-4-6`

---

## 5. Supabase Setup

- [ ] Using the existing Airbase Supabase project — no new project needed
- [ ] Run `schema.sql` from `src/modules/voice/db/schema.sql` in the Supabase SQL editor
- [ ] This creates three tables: `voice_calls`, `voice_leads`, `voice_agent_config`
- [ ] Seed initial agent configs:
  - Insert GGB Express row into `voice_agent_config`
  - Insert Recast Texas row into `voice_agent_config`
- [ ] Connection string already in Airbase env as `SUPABASE_URL` and `SUPABASE_SERVICE_KEY`

---

## 6. .env File

Create `src/modules/voice/.env` with the following:

```env
# Twilio
VOICE_TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
VOICE_TWILIO_AUTH_TOKEN=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
VOICE_TWILIO_PHONE_NUMBER_GGB=+14155551234
VOICE_TWILIO_PHONE_NUMBER_RECAST=+17135551234

# Deepgram
VOICE_DEEPGRAM_API_KEY=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# Cartesia
VOICE_CARTESIA_API_KEY=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
VOICE_CARTESIA_VOICE_ID_GGB=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
VOICE_CARTESIA_VOICE_ID_RECAST=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx

# Anthropic (reuse from parent Airbase env or set here)
ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# Supabase (reuse from parent Airbase env or set here)
SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
SUPABASE_SERVICE_KEY=eyxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# Server
VOICE_SERVER_PORT=3001
VOICE_BASE_URL=https://[your-deployed-domain]

# Optional: Form fill webhook secret (for outbound validation)
VOICE_WEBHOOK_SECRET=choose-a-random-string-here
```

---

## 7. Form Fill Webhook Setup

For outbound calling to work, your website forms need to POST to the Voice Module on submission.

**Endpoint:** `POST https://[your-domain]/voice/outbound-trigger`

**Payload:**
```json
{
  "source": "ggb_express_website",
  "name": "Jane Smith",
  "phone": "+14085551234",
  "email": "jane@example.com",
  "zip": "94025",
  "project": "full bathroom remodel",
  "secret": "[VOICE_WEBHOOK_SECRET value]"
}
```

**Website integration (if using standard HTML form):**
Add a hidden field: `<input type="hidden" name="source" value="ggb_express_website">`
Hook your form submit to also POST to the voice trigger endpoint.

**If using a form tool (Webflow, Typeform, etc.):**
Use their webhook/Zapier integration to forward the submission to the Voice Module endpoint.

---

## 8. Local Development Setup

**Install ngrok** (needed because Twilio webhooks require a public URL):
```bash
npm install -g ngrok
# or: brew install ngrok
```

**Run locally:**
```bash
cd src/modules/voice
npm install
node server/index.js
# Server starts on port 3001

# In a second terminal:
ngrok http 3001
# Copy the https://xxxx.ngrok.io URL
```

**Update Twilio webhooks** to point to ngrok URL while developing:
`https://xxxx.ngrok.io/voice/inbound`

**Test a call:**
- Call the GGB Express Twilio number from your cell
- You should hear the agent pick up within 2-3 seconds

**Twilio Dev Phone** (alternative to calling from your real phone):
- Available in the Twilio console under Tools → Dev Phone
- Useful for testing without burning real call minutes

---

## 9. Pre-Launch Checklist

Before going live:

- [ ] Test inbound call end-to-end — GGB Express number
- [ ] Test inbound call end-to-end — Recast Texas number
- [ ] Test outbound trigger — submit a test form, confirm call fires within 30 seconds
- [ ] Verify call transcript saves to `voice_calls` table in Supabase
- [ ] Verify qualified lead saves to `voice_leads` table
- [ ] Verify SMS confirmation sends after booking
- [ ] Test "transfer to human" — call should transfer to your actual phone
- [ ] Test disqualification flow — give a $3K budget, confirm agent doesn't book
- [ ] Test out-of-area zip — confirm agent doesn't book
- [ ] Review first 5 calls manually — check transcript quality, conversation flow
- [ ] Add TCPA consent language to all website forms before outbound goes live:
  "By submitting this form, you consent to receive calls or texts from [Brand Name] 
   at the number provided, including via automated means."

---

## 10. Costs at Launch

With this setup and low initial volume:

| Item | Cost |
|---|---|
| GGB Express phone number | $1/mo |
| Recast Texas phone number | $1/mo |
| All usage (Twilio + Deepgram + Claude + Cartesia) | Pay-per-call |
| **Fixed monthly minimum** | **~$2/mo** |

You will not be charged until calls start happening. All four platforms are pure usage-based except the $1/mo per Twilio number.
