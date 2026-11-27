/**
 * AccountingAdapter interface + adapter registry.
 *
 * All adapters implement the same interface. The registry returns the right
 * adapter for a tenant's accounting_target system.
 *
 * Adding a new adapter: implement AccountingAdapter and register in getAdapter().
 */

export interface InvoicePayload {
  invoice_id:     string;
  invoice_number: string;
  project_id:     string;
  project_name:   string;
  milestone_name: string;
  amount_cents:   number;
  customer_id:    string;
  contract_id:    string;
}

export interface PaymentPayload {
  payment_id:  string;
  invoice_id:  string;
  amount_cents: number;
  paid_at:     string;
  method:      string;
}

export interface CostPayload {
  cost_id:      string;
  project_id:   string;
  cost_type:    string;
  description:  string;
  amount_cents: number;
  occurred_at:  string;
}

export interface AdapterResult {
  success:            boolean;
  external_id?:       string;  // ID assigned by accounting system
  error?:             string;
}

export interface AccountingAdapter {
  postInvoice(tenantId: string, payload: InvoicePayload): Promise<AdapterResult>;
  postPayment(tenantId: string, payload: PaymentPayload): Promise<AdapterResult>;
  postCost(tenantId: string, payload: CostPayload):       Promise<AdapterResult>;
}

// ─── Adapter registry ─────────────────────────────────────────────────────────

import { QuickBooksAdapter } from "./qbo-adapter.ts";
import { BuildersBooksAdapter } from "./buildersbooks-adapter.ts";

const qboAdapter          = new QuickBooksAdapter();
const buildersBooksAdapter = new BuildersBooksAdapter();

export function getAdapter(targetSystem: string): AccountingAdapter {
  switch (targetSystem) {
    case "quickbooks":
      return qboAdapter;
    case "buildersbooks":
      return buildersBooksAdapter;
    default:
      throw new Error(`Unknown accounting target system: ${targetSystem}`);
  }
}
