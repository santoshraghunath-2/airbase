// Tier-based feature access checks for Edge Functions.
// Check before doing any premium work so free-tier tenants don't accidentally
// trigger billable operations.

export type SubscriptionTier = "starter" | "growth" | "enterprise";

const FEATURE_TIERS: Record<string, SubscriptionTier> = {
  // Phase 2 AI features
  dispatch_agent: "growth",
  booking_agent_sms: "growth",
  booking_agent_voice: "enterprise",
  invoice_agent: "growth",
  operator_agent: "growth",
  tech_assistant: "growth",
  // Phase 1 integrations
  qbo_sync: "starter",
  stripe_payments: "starter",
  sms_notifications: "starter",
};

const TIER_RANK: Record<SubscriptionTier, number> = {
  starter: 0,
  growth: 1,
  enterprise: 2,
};

export function canAccess(
  tenantTier: SubscriptionTier,
  feature: string
): boolean {
  const requiredTier = FEATURE_TIERS[feature];
  if (!requiredTier) return true; // unknown features are open
  return TIER_RANK[tenantTier] >= TIER_RANK[requiredTier];
}

export function assertFeatureAccess(
  tenantTier: SubscriptionTier,
  feature: string
): void {
  if (!canAccess(tenantTier, feature)) {
    throw new Error(
      `Feature "${feature}" requires ${FEATURE_TIERS[feature]} tier. Current tier: ${tenantTier}.`
    );
  }
}
