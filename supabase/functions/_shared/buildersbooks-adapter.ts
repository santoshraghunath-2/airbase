/**
 * BuildersBooks accounting adapter — STUB ONLY.
 *
 * The BuildersBooks posting contract (chart of accounts, job dimension mapping,
 * tenant mapping, authentication flow) has not been defined yet.
 *
 * STOP: Do not implement this adapter until the posting contract is provided.
 * See: docs/backlog.md → "BuildersBooks adapter (Phase 5 blocked)"
 *
 * All methods return a clear "not configured" error so the outbox drainer
 * marks the row as failed and surfaces it in the admin outbox view.
 */

import type { AccountingAdapter, InvoicePayload, PaymentPayload, CostPayload, AdapterResult } from "./accounting-adapter.ts";

const NOT_CONFIGURED: AdapterResult = {
  success: false,
  error:   "BuildersBooks adapter not configured — posting contract required. See docs/backlog.md.",
};

export class BuildersBooksAdapter implements AccountingAdapter {
  async postInvoice(_tenantId: string, _payload: InvoicePayload): Promise<AdapterResult> {
    return NOT_CONFIGURED;
  }

  async postPayment(_tenantId: string, _payload: PaymentPayload): Promise<AdapterResult> {
    return NOT_CONFIGURED;
  }

  async postCost(_tenantId: string, _payload: CostPayload): Promise<AdapterResult> {
    return NOT_CONFIGURED;
  }
}
