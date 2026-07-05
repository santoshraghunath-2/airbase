export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type SubscriptionTier = "starter" | "growth" | "enterprise";
export type SubscriptionStatus = "trialing" | "active" | "past_due" | "cancelled" | "paused";
export type UserRole = "owner" | "office_manager" | "dispatcher" | "technician";
export type JobStatus =
  | "scheduled"
  | "unassigned"
  | "dispatched"
  | "en_route"
  | "arrived"
  | "in_progress"
  | "completed"
  | "invoiced"
  | "cancelled"
  | "no_show";
export type JobPriority = "emergency" | "high" | "normal" | "low";
export type JobType =
  | "plumbing_service"
  | "drain_cleaning"
  | "water_heater_repair"
  | "water_heater_install"
  | "hvac_service"
  | "hvac_repair"
  | "hvac_install"
  | "hvac_maintenance"
  | "electrical_service"
  | "electrical_repair"
  | "electrical_install"
  | "general_maintenance"
  | "estimate_only"
  | "warranty_call" // @deprecated — use visit_reason: 'labor_warranty' instead
  | "recall";       // @deprecated — use visit_reason: 'recall' instead

export type VisitReason =
  | "new_request"
  | "callback"
  | "parts_warranty"
  | "labor_warranty"
  | "recall";
export type PricebookItemType = "service" | "part" | "material" | "labor" | "fee";
export type InvoiceStatus =
  | "draft"
  | "review_required"
  | "sent"
  | "viewed"
  | "partial"
  | "paid"
  | "overdue"
  | "void";

// ─── Row types ────────────────────────────────────────────────────────────────

export type AfterHoursMode = "message" | "emergency" | "anytime";
export type ModelTier = "balanced" | "capable" | "fast";
export type MembershipStatus = "pending" | "active" | "lapsed" | "cancelled";
export type BillingCycle = "monthly" | "annual";
export type EstimateStatus = "draft" | "sent" | "accepted" | "declined" | "expired" | "converted";
export type EstimatePresentationMode = "single" | "good_better_best";
export type EstimateOption = "good" | "better" | "best" | "base";
export type TechType = "service" | "install" | "install_lead" | "comfort_advisor";
export type LeadSource = "service_call" | "inbound_call" | "marketing" | "referral" | "portal" | "manual";
export type OpportunityStatus =
  | "new"
  | "assigned"
  | "contacted"
  | "visit_scheduled"
  | "visit_complete"
  | "won"
  | "lost"
  | "no_decision";

export interface TenantRow {
  id: string;
  name: string;
  slug: string;
  phone: string | null;
  address: string | null;
  timezone: string;
  subscription_tier: SubscriptionTier;
  subscription_status: SubscriptionStatus;
  trial_ends_at: string | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  stripe_account_id: string | null;
  billing_email: string | null;
  default_model_id: string;
  twilio_phone_number: string | null;
  qbo_realm_id: string | null;
  qbo_access_token: string | null;
  qbo_refresh_token: string | null;
  parent_tenant_id: string | null;
  google_review_url: string | null;
  yelp_review_url: string | null;
  sms_sender_name: string | null;
  reply_to_email: string | null;
  brand_color: string | null;
  service_area_radius_miles: number | null;
  service_area_zips: string[] | null;
  after_hours_mode: AfterHoursMode;
  created_at: string;
  updated_at: string;
}

export interface UserRow {
  id: string;
  tenant_id: string;
  auth_id: string | null;
  email: string | null;
  name: string;
  phone: string | null;
  role: UserRole;
  avatar_url: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CustomerRow {
  id: string;
  tenant_id: string;
  name: string;
  email: string | null;
  phone: string;
  phone_alt: string | null;
  notes: string | null;
  source: string | null;
  qbo_customer_id: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ServiceLocationRow {
  id: string;
  tenant_id: string;
  customer_id: string;
  address: string;
  city: string | null;
  state: string | null;
  zip: string | null;
  latitude: number | null;
  longitude: number | null;
  location_notes: string | null;
  is_primary: boolean;
  created_at: string;
}

export interface EquipmentRow {
  id: string;
  tenant_id: string;
  location_id: string;
  category: string;
  make: string | null;
  model: string | null;
  serial_number: string | null;
  install_date: string | null;
  warranty_expiry: string | null;
  last_service_date: string | null;
  notes: string | null;
  nameplate_photo_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface TechnicianRow {
  id: string;
  tenant_id: string;
  user_id: string | null;
  name: string;
  phone: string;
  email: string | null;
  license_number: string | null;
  license_expiry: string | null;
  is_active: boolean;
  tech_type: TechType;
  can_sell: boolean;
  current_latitude: number | null;
  current_longitude: number | null;
  last_location_update: string | null;
  created_at: string;
}

export interface TechSkillRow {
  tech_id: string;
  skill: string;
  level: string;
  ai_inferred: boolean;
  ai_confidence: number | null;
  manually_overridden: boolean;
  overridden_by: string | null;
  updated_at: string;
}

export interface JobRow {
  id: string;
  tenant_id: string;
  customer_id: string;
  location_id: string;
  tech_id: string | null;
  dispatched_by: string | null;
  job_type: JobType;
  visit_reason: VisitReason;
  parent_job_id: string | null;
  status: JobStatus;
  priority: JobPriority;
  description: string | null;
  internal_notes: string | null;
  scheduled_start: string | null;
  scheduled_end: string | null;
  actual_start: string | null;
  actual_end: string | null;
  source: string;
  membership_id: string | null;
  requires_skill: string | null;
  estimated_duration_minutes: number | null;
  actual_duration_minutes: number | null;
  travel_time_minutes: number | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface PricebookItemRow {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  item_type: PricebookItemType;
  trade: string | null;
  category: string | null;
  unit_price: number;
  cost: number | null;
  sku: string | null;
  taxable: boolean;
  is_active: boolean;
  estimated_hours: number | null;
  unit_of_measure: string | null;
  vendor: string | null;
  created_at: string;
  updated_at: string;
}

export interface InvoiceRow {
  id: string;
  tenant_id: string;
  job_id: string;
  customer_id: string;
  invoice_number: string | null;
  status: InvoiceStatus;
  subtotal: number | null;
  tax_amount: number;
  discount_amount: number;
  total: number | null;
  amount_paid: number;
  balance_due: number | null;
  ai_generated: boolean;
  ai_flagged: boolean;
  ai_flag_reason: string | null;
  sent_at: string | null;
  viewed_at: string | null;
  due_date: string | null;
  paid_at: string | null;
  notes: string | null;
  qbo_invoice_id: string | null;
  payment_link_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface InvoiceLineItemRow {
  id: string;
  invoice_id: string;
  pricebook_item_id: string | null;
  description: string;
  quantity: number;
  unit_price: number;
  total: number;
  taxable: boolean;
  sort_order: number | null;
  created_at: string;
}

export interface PaymentRow {
  id: string;
  tenant_id: string;
  invoice_id: string;
  stripe_payment_intent_id: string | null;
  amount: number;
  method: string | null;
  status: string;
  last_four: string | null;
  card_brand: string | null;
  processed_at: string | null;
  created_at: string;
}

export interface AgentConfigRow {
  id: string;
  tenant_id: string;
  agent_type: string;
  model_id: string | null;
  model_tier: ModelTier;
  autonomy_level: 0 | 1 | 2 | 3;
  confidence_threshold: number;
  enabled: boolean;
  auto_execute: boolean;
  settings: Json;
  created_at: string;
  updated_at: string;
}

export interface TenantHoursRow {
  id: string;
  tenant_id: string;
  day_of_week: number;
  is_open: boolean;
  open_time: string;
  close_time: string;
  created_at: string;
  updated_at: string;
}

export interface EstimateRow {
  id: string;
  tenant_id: string;
  customer_id: string;
  location_id: string | null;
  job_id: string | null;
  tech_id: string | null;
  title: string;
  status: EstimateStatus;
  presentation_mode: EstimatePresentationMode;
  selected_option: EstimateOption | null;
  notes: string | null;
  internal_notes: string | null;
  valid_until: string | null;
  sent_at: string | null;
  accepted_at: string | null;
  declined_at: string | null;
  converted_job_id: string | null;
  ai_generated: boolean;
  ai_upsell_suggestions: Array<{ description: string; reason: string; price_cents: number }>;
  wisetack_application_id: string | null;
  wisetack_offer_url: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface EstimateLineItemRow {
  id: string;
  estimate_id: string;
  option: EstimateOption;
  pricebook_item_id: string | null;
  description: string;
  quantity: number;
  unit_price_cents: number;
  total_cents: number;
  is_upsell: boolean;
  sort_order: number;
  created_at: string;
}

export interface MembershipPlanRow {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  billing_cycle: BillingCycle;
  price_cents: number;
  discount_percent: number;
  priority_dispatch: boolean;
  free_service_call: boolean;
  benefits: Array<{ text: string }>;
  stripe_price_id: string | null;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface MembershipRow {
  id: string;
  tenant_id: string;
  customer_id: string;
  plan_id: string;
  status: MembershipStatus;
  billing_cycle: BillingCycle;
  started_at: string;
  expires_at: string;
  auto_renew: boolean;
  stripe_subscription_id: string | null;
  stripe_customer_id: string | null;
  cancellation_reason: string | null;
  cancelled_at: string | null;
  last_renewed_at: string | null;
  outreach_sent_at_60: string | null;
  outreach_sent_at_30: string | null;
  outreach_sent_at_7: string | null;
  win_back_sent_at_7: string | null;
  win_back_sent_at_30: string | null;
  win_back_sent_at_90: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface AgentActionRow {
  id: string;
  tenant_id: string;
  agent_type: string;
  trigger_event: string;
  context_snapshot: Json;
  reasoning: string;
  proposed_action: Json;
  confidence: number;
  status: string;
  executed_at: string | null;
  reversed_at: string | null;
  reversed_by: string | null;
  operator_approved_by: string | null;
  model_used: string | null;
  provider_used: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  created_at: string;
}

// ─── Database interface ───────────────────────────────────────────────────────

export interface Database {
  public: {
    Tables: {
      tenants: {
        Row: TenantRow;
        Insert: Partial<TenantRow> & { name: string; slug: string };
        Update: Partial<TenantRow>;
      };
      users: {
        Row: UserRow;
        Insert: Omit<UserRow, "id" | "created_at" | "updated_at"> & { id?: string };
        Update: Partial<Omit<UserRow, "id" | "created_at">>;
      };
      customers: {
        Row: CustomerRow;
        Insert: Omit<CustomerRow, "id" | "created_at" | "updated_at"> & { id?: string };
        Update: Partial<Omit<CustomerRow, "id" | "created_at">>;
      };
      service_locations: {
        Row: ServiceLocationRow;
        Insert: Omit<ServiceLocationRow, "id" | "created_at"> & { id?: string };
        Update: Partial<Omit<ServiceLocationRow, "id" | "created_at">>;
      };
      equipment: {
        Row: EquipmentRow;
        Insert: Omit<EquipmentRow, "id" | "created_at" | "updated_at"> & { id?: string };
        Update: Partial<Omit<EquipmentRow, "id" | "created_at">>;
      };
      technicians: {
        Row: TechnicianRow;
        Insert: Omit<TechnicianRow, "id" | "created_at"> & { id?: string };
        Update: Partial<Omit<TechnicianRow, "id" | "created_at">>;
      };
      tech_skills: {
        Row: TechSkillRow;
        Insert: Omit<TechSkillRow, "updated_at"> & { updated_at?: string };
        Update: Partial<TechSkillRow>;
      };
      jobs: {
        Row: JobRow;
        Insert: Omit<JobRow, "id" | "created_at" | "updated_at" | "visit_reason" | "parent_job_id"> & { id?: string; visit_reason?: VisitReason; parent_job_id?: string | null };
        Update: Partial<Omit<JobRow, "id" | "created_at">>;
      };
      pricebook_items: {
        Row: PricebookItemRow;
        Insert: Omit<PricebookItemRow, "id" | "created_at" | "updated_at"> & { id?: string };
        Update: Partial<Omit<PricebookItemRow, "id" | "created_at">>;
      };
      invoices: {
        Row: InvoiceRow;
        Insert: Omit<InvoiceRow, "id" | "created_at" | "updated_at"> & { id?: string };
        Update: Partial<Omit<InvoiceRow, "id" | "created_at">>;
      };
      invoice_line_items: {
        Row: InvoiceLineItemRow;
        Insert: Omit<InvoiceLineItemRow, "id" | "created_at"> & { id?: string };
        Update: Partial<Omit<InvoiceLineItemRow, "id" | "created_at">>;
      };
      payments: {
        Row: PaymentRow;
        Insert: Omit<PaymentRow, "id" | "created_at"> & { id?: string };
        Update: Partial<Omit<PaymentRow, "id" | "created_at">>;
      };
      agent_actions: {
        Row: AgentActionRow;
        Insert: Omit<AgentActionRow, "id" | "created_at"> & { id?: string };
        Update: Partial<Omit<AgentActionRow, "id" | "created_at">>;
      };
      estimates: {
        Row: EstimateRow;
        Insert: Omit<EstimateRow, "id" | "total_cents" | "created_at" | "updated_at"> & { id?: string };
        Update: Partial<Omit<EstimateRow, "id" | "created_at">>;
      };
      estimate_line_items: {
        Row: EstimateLineItemRow;
        Insert: Omit<EstimateLineItemRow, "id" | "total_cents" | "created_at"> & { id?: string };
        Update: Partial<Omit<EstimateLineItemRow, "id" | "created_at">>;
      };
      membership_plans: {
        Row: MembershipPlanRow;
        Insert: Omit<MembershipPlanRow, "id" | "created_at" | "updated_at"> & { id?: string };
        Update: Partial<Omit<MembershipPlanRow, "id" | "created_at">>;
      };
      memberships: {
        Row: MembershipRow;
        Insert: Omit<MembershipRow, "id" | "created_at" | "updated_at"> & { id?: string };
        Update: Partial<Omit<MembershipRow, "id" | "created_at">>;
      };
      agent_config: {
        Row: AgentConfigRow;
        Insert: Omit<AgentConfigRow, "id" | "created_at" | "updated_at"> & { id?: string };
        Update: Partial<Omit<AgentConfigRow, "id" | "created_at">>;
      };
      tenant_hours: {
        Row: TenantHoursRow;
        Insert: Omit<TenantHoursRow, "id" | "created_at" | "updated_at"> & { id?: string };
        Update: Partial<Omit<TenantHoursRow, "id" | "created_at">>;
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: {
      subscription_tier: SubscriptionTier;
      subscription_status: SubscriptionStatus;
      user_role: UserRole;
      job_status: JobStatus;
      job_priority: JobPriority;
      job_type: JobType;
      visit_reason: VisitReason;
      pricebook_item_type: PricebookItemType;
      invoice_status: InvoiceStatus;
    };
  };
}

export interface OpportunityRow {
  id: string;
  tenant_id: string;
  customer_id: string;
  service_location_id: string | null;
  source: LeadSource;
  source_job_id: string | null;
  source_tech_id: string | null;
  assigned_to: string | null;
  install_job_id: string | null;
  status: OpportunityStatus;
  equipment_notes: string | null;
  notes: string | null;
  estimated_value_cents: number | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface PortalInvitationRow {
  id: string;
  tenant_id: string;
  customer_id: string;
  token: string;
  last_sent_at: string | null;
  expires_at: string;
  created_at: string;
}

export interface JobCrewRow {
  id: string;
  job_id: string;
  tech_id: string;
  role: "lead" | "crew" | "helper";
  confirmed: boolean;
  created_at: string;
}

// ─── Convenience aliases (matches old usage) ─────────────────────────────────
export type Tenant = TenantRow;
export type User = UserRow;
export type Customer = CustomerRow;
export type ServiceLocation = ServiceLocationRow;
export type Equipment = EquipmentRow;
export type Technician = TechnicianRow;
export type TechSkill = TechSkillRow;
export type Job = JobRow;
export type PricebookItem = PricebookItemRow;
export type Invoice = InvoiceRow;
export type InvoiceLineItem = InvoiceLineItemRow;
export type Payment = PaymentRow;
export type AgentAction = AgentActionRow;
export type AgentConfig = AgentConfigRow;
export type TenantHours = TenantHoursRow;
export type MembershipPlan = MembershipPlanRow;
export type Membership = MembershipRow;
export type Estimate = EstimateRow;
export type EstimateLineItem = EstimateLineItemRow;
export type Opportunity = OpportunityRow;
export type JobCrew = JobCrewRow;
export type PortalInvitation = PortalInvitationRow;

// ─── Join types ───────────────────────────────────────────────────────────────
export type JobWithRelations = JobRow & {
  customers: Pick<CustomerRow, "id" | "name" | "phone" | "email"> | null;
  service_locations: Pick<ServiceLocationRow, "id" | "address" | "city" | "state" | "zip" | "location_notes"> | null;
  technicians: Pick<TechnicianRow, "id" | "name" | "phone"> | null;
};

export type CustomerWithLocations = CustomerRow & {
  service_locations: ServiceLocationRow[];
};
