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
  | "warranty_call"
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
        Insert: Omit<JobRow, "id" | "created_at" | "updated_at"> & { id?: string };
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
      pricebook_item_type: PricebookItemType;
      invoice_status: InvoiceStatus;
    };
  };
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

// ─── Join types ───────────────────────────────────────────────────────────────
export type JobWithRelations = JobRow & {
  customers: Pick<CustomerRow, "id" | "name" | "phone" | "email"> | null;
  service_locations: Pick<ServiceLocationRow, "id" | "address" | "city" | "state" | "zip" | "location_notes"> | null;
  technicians: Pick<TechnicianRow, "id" | "name" | "phone"> | null;
};

export type CustomerWithLocations = CustomerRow & {
  service_locations: ServiceLocationRow[];
};
