import { assertEquals, assertThrows } from "jsr:@std/assert";
import {
  maxDepositCents,
  validateDeposit,
  validatePaymentSchedule,
  cancellationNoticeDays,
  computeCancelByDate,
  requiresWrittenContract,
  UnsupportedStateError,
  type PaymentScheduleItem,
} from "../_shared/contract-rules.ts";

// ─── maxDepositCents ──────────────────────────────────────────────────────────

Deno.test("deposit cap: $16,000 contract → cap is $1,600 (10%)", () => {
  const result = maxDepositCents(1_600_000, "CA");
  assertEquals(result.ok, true);
  if (result.ok) assertEquals(result.value, 160_000); // $1,600
});

Deno.test("deposit cap: $5,000 contract → cap is $500 (10%)", () => {
  const result = maxDepositCents(500_000, "CA");
  assertEquals(result.ok, true);
  if (result.ok) assertEquals(result.value, 50_000); // $500
});

Deno.test("deposit cap: $600 contract → cap is $60 (10%, under $1,000 floor)", () => {
  const result = maxDepositCents(60_000, "CA");
  assertEquals(result.ok, true);
  if (result.ok) assertEquals(result.value, 6_000); // $60
});

Deno.test("deposit cap: $20,000 contract → cap is $1,000 (10% would be $2,000, capped)", () => {
  const result = maxDepositCents(2_000_000, "CA");
  assertEquals(result.ok, true);
  if (result.ok) assertEquals(result.value, 100_000); // $1,000
});

// ─── validateDeposit ─────────────────────────────────────────────────────────

Deno.test("validateDeposit: proposed deposit at cap passes", () => {
  const result = validateDeposit(100_000, 1_600_000, "CA"); // $1,000 deposit on $16K contract
  assertEquals(result.ok, true);
});

Deno.test("validateDeposit: proposed deposit above cap fails", () => {
  const result = validateDeposit(200_000, 1_600_000, "CA"); // $2,000 deposit on $16K contract
  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.error.code, "DEPOSIT_EXCEEDS_CAP");
});

// ─── validatePaymentSchedule ─────────────────────────────────────────────────

function makeSchedule(overrides?: Partial<PaymentScheduleItem>[]): PaymentScheduleItem[] {
  const base: PaymentScheduleItem[] = [
    { sort_order: 0, milestone_name: "Deposit",            trigger_type: "contract_signed",    amount_cents: 100_000  },
    { sort_order: 1, milestone_name: "Materials Delivered", trigger_type: "materials_delivered", amount_cents: 400_000  },
    { sort_order: 2, milestone_name: "Rough-in Complete",   trigger_type: "phase_closed",        amount_cents: 400_000  },
    { sort_order: 3, milestone_name: "Balance",             trigger_type: "completion",          amount_cents: 700_000  },
  ];
  if (overrides) {
    return overrides.map((o, i) => ({ ...base[i], ...o }));
  }
  return base;
}

Deno.test("validatePaymentSchedule: valid 4-item schedule passes", () => {
  const result = validatePaymentSchedule(makeSchedule(), 1_600_000, "CA");
  assertEquals(result.ok, true);
});

Deno.test("validatePaymentSchedule: sum mismatch fails", () => {
  const items = makeSchedule();
  items[3] = { ...items[3], amount_cents: 500_000 }; // total now 1_400_000, not 1_600_000
  const result = validatePaymentSchedule(items, 1_600_000, "CA");
  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.error.code, "SCHEDULE_SUM_MISMATCH");
});

Deno.test("validatePaymentSchedule: payment before trigger (deposit not first) fails", () => {
  const items: PaymentScheduleItem[] = [
    { sort_order: 0, milestone_name: "Materials",  trigger_type: "materials_delivered", amount_cents: 100_000  },
    { sort_order: 1, milestone_name: "Deposit",    trigger_type: "contract_signed",     amount_cents: 400_000  },
    { sort_order: 2, milestone_name: "Phase",      trigger_type: "phase_closed",        amount_cents: 400_000  },
    { sort_order: 3, milestone_name: "Balance",    trigger_type: "completion",          amount_cents: 700_000  },
  ];
  const result = validatePaymentSchedule(items, 1_600_000, "CA");
  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.error.code, "DEPOSIT_NOT_FIRST");
});

Deno.test("validatePaymentSchedule: completion not last fails", () => {
  const items: PaymentScheduleItem[] = [
    { sort_order: 0, milestone_name: "Deposit",    trigger_type: "contract_signed",    amount_cents: 100_000  },
    { sort_order: 1, milestone_name: "Complete",   trigger_type: "completion",         amount_cents: 700_000  },
    { sort_order: 2, milestone_name: "Phase",      trigger_type: "phase_closed",       amount_cents: 400_000  },
    { sort_order: 3, milestone_name: "Balance",    trigger_type: "materials_delivered", amount_cents: 400_000  },
  ];
  const result = validatePaymentSchedule(items, 1_600_000, "CA");
  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.error.code, "COMPLETION_NOT_LAST");
});

// ─── Non-CA state fails closed ────────────────────────────────────────────────

Deno.test("non-CA state: maxDepositCents throws UnsupportedStateError", () => {
  assertThrows(() => maxDepositCents(1_600_000, "TX"), UnsupportedStateError);
});

Deno.test("non-CA state: validatePaymentSchedule throws UnsupportedStateError", () => {
  assertThrows(() => validatePaymentSchedule(makeSchedule(), 1_600_000, "NY"), UnsupportedStateError);
});

// ─── Cancellation notice ─────────────────────────────────────────────────────

Deno.test("cancellation notice: standard customer → 3 days", () => {
  const result = cancellationNoticeDays(false, "CA");
  assertEquals(result.ok, true);
  if (result.ok) assertEquals(result.value, 3);
});

Deno.test("cancellation notice: 65+ customer → 5 days", () => {
  const result = cancellationNoticeDays(true, "CA");
  assertEquals(result.ok, true);
  if (result.ok) assertEquals(result.value, 5);
});

Deno.test("computeCancelByDate: 3 business days from Wednesday skips weekend", () => {
  const wednesday = new Date("2026-11-25T14:00:00Z"); // Wednesday
  const result = computeCancelByDate(wednesday, 3);
  // Thu +1, Fri +2, skip Sat/Sun, Mon +3
  assertEquals(result.getUTCDay(), 1); // Monday
});

Deno.test("requiresWrittenContract: $600 contract requires written contract", () => {
  const result = requiresWrittenContract(60_000, "CA");
  assertEquals(result.ok, true);
  if (result.ok) assertEquals(result.value, true);
});

Deno.test("requiresWrittenContract: $400 contract does not require written contract", () => {
  const result = requiresWrittenContract(40_000, "CA");
  assertEquals(result.ok, true);
  if (result.ok) assertEquals(result.value, false);
});
