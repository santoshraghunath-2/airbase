# Airbase — Multi-Tenancy Architecture

Airbase is a true multi-tenant SaaS. Every record in every table is scoped to a `tenant_id`.
Tenants are completely isolated from one another at the database level via Row-Level Security.

---

## Tenancy Model

### Isolation Layer: Supabase RLS

Every tenant-scoped table has:
```sql
ALTER TABLE [table] ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON [table]
  FOR ALL USING (
    tenant_id = (
      SELECT tenant_id FROM users WHERE auth_id = auth.uid()
    )
  );
```

This means a user from Tenant A physically cannot read, write, or delete data belonging to Tenant B — even if they craft a direct API call. The database enforces this, not the application layer. Never rely on application-layer filtering as the sole isolation mechanism.

For Edge Functions using the service role key (bypasses RLS), always manually filter by `tenant_id` from the authenticated JWT — never trust a `tenant_id` from the request body:

```typescript
// CORRECT — extract tenant_id from JWT, not request body
const { data: { user } } = await supabase.auth.getUser(jwt);
const { data: userData } = await supabase
  .from("users")
  .select("tenant_id")
  .eq("auth_id", user.id)
  .single();
const tenantId = userData.tenant_id; // always use this

// WRONG — never do this in a service-role function
const tenantId = req.body.tenant_id; // attacker-controlled
```

---

## Tenant Hierarchy

### Standard (Phase 1–3): Flat tenants
```
tenant (e.g. "Steward Home Services")
  └── users (owner, dispatcher, techs)
  └── customers
  └── jobs
  └── invoices
```

### MSO / Franchise (Phase 4): Parent-child
```
parent_tenant (e.g. "AcmeHVAC Franchising")
  ├── child_tenant (e.g. "AcmeHVAC - San Jose")
  │     └── users, customers, jobs ...
  ├── child_tenant (e.g. "AcmeHVAC - Oakland")
  │     └── users, customers, jobs ...
  └── child_tenant (e.g. "AcmeHVAC - Fremont")
        └── users, customers, jobs ...
```

Parent tenants can see aggregate data across children. Child tenants are isolated from each other. Implemented via `tenants.parent_tenant_id` FK and a separate `parent_access` policy layer in Phase 4.

---

## URL Routing

Each tenant has a unique `slug` (e.g. `steward`, `acme-hvac-sanjose`).

```
https://airbase.app/[slug]/dashboard
https://airbase.app/[slug]/dispatch
https://airbase.app/[slug]/customers
https://airbase.app/steward/dashboard    ← Steward
https://airbase.app/acme-hvac/dashboard  ← different company, completely isolated
```

The slug is resolved on login → stored in React context → prefixed on every route. Never expose a tenant's internal UUID in the URL.

### React Router setup
```typescript
// App.tsx
<Routes>
  <Route path="/login" element={<Login />} />
  <Route path="/:tenantSlug" element={<TenantGuard />}>
    <Route path="dashboard" element={<Dashboard />} />
    <Route path="dispatch" element={<DispatchBoard />} />
    <Route path="customers" element={<Customers />} />
    <Route path="jobs/:jobId" element={<JobDetail />} />
    {/* ... */}
  </Route>
  <Route path="/tech" element={<TechPWA />} /> {/* mobile, separate auth flow */}
  <Route path="/admin" element={<PlatformAdmin />} /> {/* Airbase superadmin only */}
</Routes>
```

---

## Subscription Tiers

Defined in `tenants.subscription_tier`. Feature gates enforced server-side (Edge Function checks tier before executing) and client-side (UI hides unavailable features with upgrade prompts).

| Feature | Starter | Growth | Enterprise |
|---|---|---|---|
| Max technicians | 3 | Unlimited | Unlimited |
| AI dispatch agent | ❌ | ✅ | ✅ |
| AI booking agent (SMS) | ❌ | ✅ | ✅ |
| AI booking agent (Voice) | ❌ | ✅ | ✅ |
| Invoice agent | ❌ | ✅ | ✅ |
| Operator command panel | ❌ | ✅ | ✅ |
| Custom model selection | ❌ | ❌ | ✅ |
| Memberships | ❌ | ✅ | ✅ |
| Multi-location hierarchy | ❌ | ❌ | ✅ |
| Inventory module | ❌ | ❌ | ✅ |
| Open API access | ❌ | ❌ | ✅ |
| White-label | ❌ | ❌ | ✅ (add-on) |

### Feature Gate Pattern (Edge Function)
```typescript
import { checkFeatureAccess } from "../_shared/feature-gates.ts";

// In any agent Edge Function:
await checkFeatureAccess(supabase, tenantId, "ai_dispatch_agent");
// Throws if tenant tier doesn't include this feature
```

### Feature Gate Pattern (React)
```typescript
// hooks/useFeatureGate.ts
export function useFeatureGate(feature: FeatureKey): boolean {
  const { tenant } = useTenant();
  return FEATURE_GATES[feature].includes(tenant.subscription_tier);
}

// In component:
const canUseAIDispatch = useFeatureGate("ai_dispatch_agent");
if (!canUseAIDispatch) return <UpgradePrompt feature="AI Dispatch" />;
```

---

## Model Selection: Operator-Facing UI

Available in **Enterprise tier only**. Exposes the `tenants.default_model_id` and per-agent `agent_config.model_id` settings via a UI in the tenant's settings page.

### Settings Page: AI Models

```
Settings → AI & Agents → Model Configuration

┌─────────────────────────────────────────────────────────┐
│ Default Model                                            │
│ Used for any agent without a specific override           │
│                                                          │
│  ◉ Claude Sonnet 4.6        Anthropic  ●●○ Medium cost  │
│  ○ Claude Opus 4.6          Anthropic  ●●● High cost     │
│  ○ GPT-4o                   OpenAI     ●●○ Medium cost   │
│  ○ GPT-4o Mini              OpenAI     ●○○ Low cost      │
│  ○ DeepSeek V4              DeepSeek   ●○○ Low cost      │
│  ○ Kimi K2.5 (32k)          Moonshot   ●○○ Low cost      │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│ Per-Agent Overrides           (leave blank = use default)│
│                                                          │
│  Dispatch Agent      [Claude Sonnet 4.6      ▼]          │
│  Booking Agent SMS   [DeepSeek V4            ▼]          │
│  Booking Agent Voice [Claude Sonnet 4.6      ▼]          │
│  Invoice Agent       [DeepSeek V4            ▼]          │
│  Operator Agent      [Claude Opus 4.6        ▼]          │
│  Tech Assistant      [Kimi K2.5 (32k)        ▼]          │
│  Membership Agent    [DeepSeek V4            ▼]          │
└─────────────────────────────────────────────────────────┘

  Estimated monthly AI cost at current job volume: ~$47
  [Save changes]
```

The "estimated monthly AI cost" is calculated from `agent_actions` — count tokens used in last 30 days × provider pricing, projected forward.

### Implementation Notes
- Show a warning if the operator selects a non-Anthropic model for the dispatch or operator agent: "Claude is recommended for complex reasoning tasks. Other models may produce lower-quality results for dispatch."
- Validate that `model_id` is a key in `MODEL_REGISTRY` before saving (server-side)
- For Growth tier: show the model settings UI but with all fields locked and an "Upgrade to Enterprise to customise models" notice
- Never expose API keys to the frontend — model selection saves only the model ID string

---

## Tenant Provisioning Flow

When a new company signs up:

1. User fills sign-up form (company name, email, phone, trade type)
2. `provision-tenant` Edge Function runs:
   - Creates `tenants` row with slug derived from company name
   - Creates `users` row with role = `owner`
   - Creates Supabase Auth user, sends magic link
   - Seeds default `agent_config` rows for all 7 agent types (all defaults, auto_execute = false)
   - Seeds sample `pricebook_items` (10 common items for their trade type)
   - Creates Stripe customer
3. Owner lands on `/[slug]/onboarding` — 5-step wizard:
   - Step 1: Confirm company details + timezone
   - Step 2: Add first technician(s)
   - Step 3: Import or build pricebook
   - Step 4: Connect Twilio number (or use shared Airbase number in trial)
   - Step 5: Connect QuickBooks (optional, can skip)
4. After onboarding: redirect to `/[slug]/dashboard`

### `provision-tenant` Edge Function

```typescript
// /supabase/functions/provision-tenant/index.ts

export async function provisionTenant(input: {
  companyName: string;
  ownerEmail: string;
  ownerName: string;
  phone: string;
  tradeType: "plumbing" | "hvac" | "electrical" | "multi";
  timezone: string;
}) {
  const slug = slugify(input.companyName); // "Steward Home Services" → "steward-home-services"

  // 1. Create tenant
  const { data: tenant } = await supabase.from("tenants").insert({
    name: input.companyName,
    slug,
    phone: input.phone,
    timezone: input.timezone,
    subscription_tier: "starter",
    subscription_status: "trialing",
    trial_ends_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
    default_model_id: "claude-sonnet-4-6",
  }).select("id").single();

  // 2. Create Supabase Auth user + users row
  const { data: authUser } = await supabase.auth.admin.createUser({
    email: input.ownerEmail,
    email_confirm: false,
  });
  await supabase.from("users").insert({
    tenant_id: tenant.id,
    auth_id: authUser.user.id,
    email: input.ownerEmail,
    name: input.ownerName,
    role: "owner",
  });

  // 3. Seed default agent configs
  const agentTypes = ["dispatch", "booking", "invoice", "membership", "operator", "tech", "membership"];
  await supabase.from("agent_config").insert(
    agentTypes.map(type => ({
      tenant_id: tenant.id,
      agent_type: type,
      auto_execute_enabled: false,
      confidence_threshold: 0.85,
      model_id: null, // inherit from tenant default
    }))
  );

  // 4. Seed starter pricebook from trade type template
  await seedPricebook(tenant.id, input.tradeType);

  // 5. Send magic link
  await supabase.auth.admin.generateLink({
    type: "magiclink",
    email: input.ownerEmail,
    options: { redirectTo: `https://airbase.app/${slug}/onboarding` },
  });

  return { tenantId: tenant.id, slug };
}
```

---

## Platform Admin

Airbase operators (you) need a superadmin view to manage all tenants.

**Route:** `/admin` — protected by a separate `is_platform_admin` flag on `users`, not by tenant RLS.

**Platform admin capabilities:**
- List all tenants with subscription status, MRR, job volume
- Impersonate any tenant (read-only) for support
- Manually override subscription tier
- View aggregate platform metrics (total jobs, agents fired, AI cost)
- Provision new tenants manually
- Flag a tenant for churn risk

**Implementation:** `/admin` uses the Supabase service role key directly (bypasses RLS) and queries all tenants. Access is guarded by `users.is_platform_admin = true` checked at the Edge Function level, not via RLS policy.

```sql
-- Add to users table in migration
ALTER TABLE users ADD COLUMN is_platform_admin BOOLEAN DEFAULT false;

-- Only set this manually for Airbase team members — never expose to tenants
```
