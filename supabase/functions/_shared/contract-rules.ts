// contract-rules.ts — Pure functions encoding CA home improvement contract law.
//
// Source: CSLB Home Improvement Contract Guide and CSLB Sample Home Improvement Contract.
// This is an engineering summary, NOT legal advice. All dollar limits and clause text
// are subject to attorney review before use in a real contract.
//
// Non-CA states: fail closed with a clear error so we don't silently apply wrong rules.
// Add a new state block when you are ready to support it.

export type LicenseState = "CA" | string;

export interface PaymentScheduleItem {
  sort_order: number;
  milestone_name: string;
  trigger_type:
    | "contract_signed"
    | "materials_delivered"
    | "phase_closed"
    | "completion";
  amount_cents: number;
}

export interface ContractRulesError {
  code: string;
  message: string;
}

export type RulesResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: ContractRulesError };

// ─── CA deposit cap ───────────────────────────────────────────────────────────

/**
 * Maximum deposit for a CA home improvement contract.
 * Lesser of $1,000 or 10% of the contract price.
 * CSLB reference: Business and Professions Code §7159(d)(1).
 */
export function maxDepositCents(
  totalCents: number,
  licenseState: LicenseState,
): RulesResult<number> {
  assertCA(licenseState);
  if (totalCents <= 0) {
    return { ok: false, error: { code: "INVALID_TOTAL", message: "Total must be greater than zero" } };
  }
  const tenPercent = Math.round(totalCents * 0.1);
  return { ok: true, value: Math.min(100_000, tenPercent) }; // $1,000 = 100_000 cents
}

// ─── Written contract requirement ────────────────────────────────────────────

/**
 * A written home improvement contract is required for any job over $500 in CA.
 * CSLB reference: Business and Professions Code §7159(a).
 */
export function requiresWrittenContract(
  totalCents: number,
  licenseState: LicenseState,
): RulesResult<boolean> {
  assertCA(licenseState);
  return { ok: true, value: totalCents > 50_000 }; // $500 = 50_000 cents
}

// ─── Payment schedule validation ─────────────────────────────────────────────

/**
 * Validate a payment schedule against CA rules:
 *   1. Items must sum to totalCents.
 *   2. No payment may be made due before its trigger event is recorded
 *      (enforced by ordering: contract_signed first, completion last).
 *   3. Only the deposit may have trigger_type = 'contract_signed'.
 *
 * CSLB reference: Business and Professions Code §7159(d).
 */
export function validatePaymentSchedule(
  items: PaymentScheduleItem[],
  totalCents: number,
  licenseState: LicenseState,
): RulesResult<true> {
  assertCA(licenseState);

  if (items.length === 0) {
    return err("EMPTY_SCHEDULE", "Payment schedule must have at least one item");
  }

  // Rule 1: sum must equal total
  const sum = items.reduce((acc, i) => acc + i.amount_cents, 0);
  if (sum !== totalCents) {
    return err(
      "SCHEDULE_SUM_MISMATCH",
      `Payment schedule sums to ${centsDisplay(sum)} but contract total is ${centsDisplay(totalCents)}`,
    );
  }

  // Rule 2: no item may have amount <= 0
  for (const item of items) {
    if (item.amount_cents <= 0) {
      return err("ZERO_PAYMENT", `Milestone "${item.milestone_name}" has an invalid amount`);
    }
  }

  // Rule 3: only the first item (deposit) may be contract_signed
  const sorted = [...items].sort((a, b) => a.sort_order - b.sort_order);
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i].trigger_type === "contract_signed" && i !== 0) {
      return err(
        "DEPOSIT_NOT_FIRST",
        `Only the first payment item may have trigger "contract_signed". ` +
          `"${sorted[i].milestone_name}" is at position ${i + 1}.`,
      );
    }
  }

  // Rule 4: completion must be last if present
  const completionIdx = sorted.findIndex((i) => i.trigger_type === "completion");
  if (completionIdx !== -1 && completionIdx !== sorted.length - 1) {
    return err(
      "COMPLETION_NOT_LAST",
      `The "completion" trigger must be the last payment item`,
    );
  }

  return { ok: true, value: true };
}

// ─── Deposit validation ───────────────────────────────────────────────────────

/**
 * Validates that a proposed deposit does not exceed the CA legal maximum.
 */
export function validateDeposit(
  depositCents: number,
  totalCents: number,
  licenseState: LicenseState,
): RulesResult<true> {
  const maxResult = maxDepositCents(totalCents, licenseState);
  if (!maxResult.ok) return maxResult;

  if (depositCents > maxResult.value) {
    return err(
      "DEPOSIT_EXCEEDS_CAP",
      `Proposed deposit of ${centsDisplay(depositCents)} exceeds the CA legal maximum of ${centsDisplay(maxResult.value)} ` +
        `(lesser of $1,000 or 10% of ${centsDisplay(totalCents)})`,
    );
  }
  return { ok: true, value: true };
}

// ─── Cancellation notice ─────────────────────────────────────────────────────

/**
 * Returns the number of business days the customer has to cancel after signing.
 * Standard: 3 business days. Customer 65 or older: 5 business days.
 * CSLB reference: Civil Code §1689.5 (3-day); Civil Code §1689.7 (5-day for 65+).
 */
export function cancellationNoticeDays(
  customer65OrOlder: boolean,
  licenseState: LicenseState,
): RulesResult<3 | 5> {
  assertCA(licenseState);
  return { ok: true, value: customer65OrOlder ? 5 : 3 };
}

/**
 * Computes the cancel-by date from the signed timestamp and notice days.
 *
 * ⚠️ ATTORNEY REVIEW REQUIRED: "business days" here skips weekends only.
 * State holidays and time-of-day rules are NOT yet accounted for.
 * Do not use this calculation in a real contract until it has been reviewed.
 */
export function computeCancelByDate(
  signedAt: Date,
  noticeDays: number,
): Date {
  let date = new Date(signedAt);
  let daysAdded = 0;
  while (daysAdded < noticeDays) {
    date.setDate(date.getDate() + 1);
    const dow = date.getDay();
    if (dow !== 0 && dow !== 6) daysAdded++; // skip weekends — ATTORNEY REVIEW
  }
  date.setHours(23, 59, 59, 0);
  return date;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function assertCA(licenseState: LicenseState): asserts licenseState is "CA" {
  if (licenseState !== "CA") {
    throw new UnsupportedStateError(licenseState);
  }
}

function err(code: string, message: string): { ok: false; error: ContractRulesError } {
  return { ok: false, error: { code, message } };
}

function centsDisplay(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

export class UnsupportedStateError extends Error {
  constructor(state: string) {
    super(
      `Contract rules for state "${state}" are not implemented. ` +
        `Only CA is supported. Add a new state block in _shared/contract-rules.ts before generating contracts for this tenant.`,
    );
    this.name = "UnsupportedStateError";
  }
}
