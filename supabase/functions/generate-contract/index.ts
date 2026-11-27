// generate-contract: Builds a PDF home improvement contract from an accepted estimate.
//
// Called after a salesperson accepts an estimate on behalf of the customer.
// Guards:
//   - tenants.contract_template_approved must be true to send; can generate/preview without it
//   - CA deposit cap enforced via contract-rules.ts
//   - Payment schedule validated before writing to DB
//   - Service-role only (called by salesperson flow, not directly by customer)
//
// PDF: uses pdf-lib to build a structured document with CSLB-section layout.
// All clause bodies are marked PLACEHOLDER PENDING ATTORNEY APPROVAL.
// Template version is stamped on every generated contract for audit.

import { createClient } from "npm:@supabase/supabase-js@2";
import PDFLib from "npm:pdf-lib@1.17.1";
const { PDFDocument, StandardFonts, rgb } = PDFLib;
import {
  validateServiceRoleAuth,
  ok,
  err,
} from "../_shared/agent-base.ts";
import {
  maxDepositCents,
  validateDeposit,
  validatePaymentSchedule,
  cancellationNoticeDays,
  computeCancelByDate,
  UnsupportedStateError,
  type PaymentScheduleItem,
} from "../_shared/contract-rules.ts";

const TEMPLATE_VERSION = "0.1-DRAFT";
const STORAGE_BUCKET = "contracts";

let _supabase: ReturnType<typeof createClient> | null = null;
function getSupabase() {
  if (!_supabase) {
    _supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );
  }
  return _supabase;
}

// ─── Request body ─────────────────────────────────────────────────────────────

interface GenerateContractRequest {
  estimate_id: string;
  customer_65_or_older?: boolean;
  // Middle milestone amounts (PLACEHOLDER until confirmed)
  materials_milestone_cents?: number;
  rough_in_milestone_cents?: number;
}

// ─── PDF generation ───────────────────────────────────────────────────────────

async function buildContractPdf(params: {
  contractNumber: string;
  tenantName: string;
  tenantLegalEntity: string;
  tenantLicense: string;
  tenantLicenseState: string;
  customerName: string;
  customerAddress: string;
  projectDescription: string;
  totalCents: number;
  schedule: PaymentScheduleItem[];
  commitmentDays: number;
  cancelByDate: Date;
  cancellationNoticeDays: number;
  templateVersion: string;
}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  function addPage() {
    return doc.addPage([612, 792]); // US Letter
  }

  function centsDisplay(c: number) {
    return `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
  }

  let page = addPage();
  let y = 740;
  const margin = 60;
  const width = 612 - margin * 2;

  function text(str: string, x: number, yPos: number, size = 10, isBold = false) {
    page.drawText(str, {
      x, y: yPos, size,
      font: isBold ? bold : font,
      color: rgb(0, 0, 0),
    });
  }

  function line(yPos: number) {
    page.drawLine({
      start: { x: margin, y: yPos },
      end: { x: margin + width, y: yPos },
      thickness: 0.5,
      color: rgb(0.6, 0.6, 0.6),
    });
  }

  function wrap(str: string, maxChars: number): string[] {
    const words = str.split(" ");
    const lines: string[] = [];
    let current = "";
    for (const word of words) {
      if ((current + " " + word).trim().length > maxChars) {
        lines.push(current.trim());
        current = word;
      } else {
        current = (current + " " + word).trim();
      }
    }
    if (current) lines.push(current);
    return lines;
  }

  function section(title: string) {
    if (y < 100) { page = addPage(); y = 740; }
    y -= 18;
    text(title, margin, y, 11, true);
    y -= 4;
    line(y);
    y -= 10;
  }

  function para(str: string, indent = 0) {
    const lines = wrap(str, 85);
    for (const l of lines) {
      if (y < 80) { page = addPage(); y = 740; }
      text(l, margin + indent, y, 10);
      y -= 14;
    }
    y -= 4;
  }

  // ── Header ──
  text("HOME IMPROVEMENT CONTRACT", margin, y, 14, true);
  y -= 20;
  text(`Contract No: ${params.contractNumber}`, margin, y, 9);
  text(`Template: ${params.templateVersion}  ⚠ DRAFT — NOT FOR EXECUTION`, margin + 300, y, 9);
  y -= 6;
  line(y);
  y -= 14;

  // ── Parties ──
  section("1. PARTIES");
  para(`Contractor: ${params.tenantLegalEntity} (dba ${params.tenantName})`);
  para(`CSLB License No. ${params.tenantLicense} (${params.tenantLicenseState})`);
  para(`Customer: ${params.customerName}`);
  para(`Project Address: ${params.customerAddress}`);

  // ── Description of Work ──
  section("2. DESCRIPTION OF WORK");
  para(params.projectDescription || "[PLACEHOLDER PENDING ATTORNEY APPROVAL — describe scope of work]");

  // ── Contract Price ──
  section("3. CONTRACT PRICE");
  para(`Total Contract Price: ${centsDisplay(params.totalCents)}`);
  para("[PLACEHOLDER PENDING ATTORNEY APPROVAL — required CSLB price statement]");

  // ── Payment Schedule ──
  section("4. PAYMENT SCHEDULE");
  para("[PLACEHOLDER PENDING ATTORNEY APPROVAL — required CSLB payment schedule statement]");
  y -= 4;
  for (const item of [...params.schedule].sort((a, b) => a.sort_order - b.sort_order)) {
    para(`  ${item.milestone_name}: ${centsDisplay(item.amount_cents)}  (due: ${item.trigger_type.replace(/_/g, " ")})`, 10);
  }

  // ── Start and Completion ──
  section("5. START AND COMPLETION DATES");
  para(`Estimated completion: ${params.commitmentDays} business days from project start`);
  para("[PLACEHOLDER PENDING ATTORNEY APPROVAL — CSLB required date statement]");

  // ── Cancellation Rights ──
  section("6. NOTICE OF CANCELLATION");
  para(
    `You may cancel this contract without penalty within ${params.cancellationNoticeDays} business days of signing. ` +
      `Cancel-by date: ${params.cancelByDate.toLocaleDateString("en-US")}.`,
  );
  para("[PLACEHOLDER PENDING ATTORNEY APPROVAL — full CSLB cancellation notice text required]");

  // ── Mechanics Lien Warning ──
  section("7. MECHANICS LIEN WARNING");
  para("[PLACEHOLDER PENDING ATTORNEY APPROVAL — CSLB required mechanics lien warning]");

  // ── Dispute Resolution ──
  section("8. DISPUTE RESOLUTION");
  para("[PLACEHOLDER PENDING ATTORNEY APPROVAL — arbitration / CSLB complaint language]");

  // ── Signatures ──
  section("9. SIGNATURES");
  y -= 10;
  text("Contractor Signature: ____________________________  Date: __________", margin, y, 10);
  y -= 24;
  text("Customer Signature:   ____________________________  Date: __________", margin, y, 10);
  y -= 24;
  text("Print Name:           ____________________________", margin, y, 10);

  return doc.save();
}

// ─── Default payment schedule ─────────────────────────────────────────────────

function buildDefaultSchedule(
  totalCents: number,
  depositCents: number,
  materialsMilestoneCents: number | null,
  roughInMilestoneCents: number | null,
): PaymentScheduleItem[] {
  // PLACEHOLDER amounts for middle milestones — replace when confirmed
  const middleTotal = totalCents - depositCents;
  const mat = materialsMilestoneCents ?? Math.round(middleTotal * 0.3);  // PLACEHOLDER: 30%
  const rough = roughInMilestoneCents ?? Math.round(middleTotal * 0.3);  // PLACEHOLDER: 30%
  const balance = totalCents - depositCents - mat - rough;

  return [
    { sort_order: 0, milestone_name: "Deposit",             trigger_type: "contract_signed",    amount_cents: depositCents },
    { sort_order: 1, milestone_name: "Materials Delivered",  trigger_type: "materials_delivered", amount_cents: mat },
    { sort_order: 2, milestone_name: "Rough-in Complete",    trigger_type: "phase_closed",        amount_cents: rough },
    { sort_order: 3, milestone_name: "Balance at Completion", trigger_type: "completion",         amount_cents: balance },
  ];
}

// ─── Main handler ─────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (!validateServiceRoleAuth(req)) return err("Unauthorized", 401);

  let body: GenerateContractRequest;
  try {
    body = await req.json() as GenerateContractRequest;
  } catch {
    return err("Invalid JSON");
  }

  if (!body.estimate_id) return err("Missing estimate_id");

  const sb = getSupabase();

  try {
    // ── Load estimate ──
    const { data: estimate, error: estErr } = await sb
      .from("estimates")
      .select(`
        id, tenant_id, customer_id, opportunity_id, status,
        estimate_line_items(id, option, description, quantity, unit_price_cents, total_cents),
        customers(id, name, address_line1, address_line2, city, state, zip),
        tenants(name, legal_entity_name, license_number, license_state, brand_name, contract_template_approved)
      `)
      .eq("id", body.estimate_id)
      .single();

    if (estErr || !estimate) return err(`Estimate not found: ${estErr?.message}`);
    if (estimate.status === "converted") return err("Estimate is already converted");

    const tenant = estimate.tenants as {
      name: string; legal_entity_name: string; license_number: string;
      license_state: string; brand_name: string; contract_template_approved: boolean;
    };
    const customer = estimate.customers as {
      name: string; address_line1: string; address_line2: string;
      city: string; state: string; zip: string;
    };

    const licenseState = tenant.license_state ?? "CA";

    // ── Total from accepted lines ──
    const lines = estimate.estimate_line_items as Array<{
      option: string; description: string; unit_price_cents: number; quantity: number; total_cents: number;
    }>;
    const totalCents = lines.reduce((s, l) => s + l.total_cents, 0);
    if (totalCents <= 0) return err("Estimate has no line items with value");

    // ── CA rules ──
    let depositCents: number;
    try {
      const depositResult = maxDepositCents(totalCents, licenseState);
      if (!depositResult.ok) return err(depositResult.error.message);
      depositCents = depositResult.value;
    } catch (e) {
      if (e instanceof UnsupportedStateError) return err(e.message);
      throw e;
    }

    const schedule = buildDefaultSchedule(
      totalCents,
      depositCents,
      body.materials_milestone_cents ?? null,
      body.rough_in_milestone_cents ?? null,
    );

    const scheduleResult = validatePaymentSchedule(schedule, totalCents, licenseState);
    if (!scheduleResult.ok) return err(scheduleResult.error.message);

    const noticeDays = cancellationNoticeDays(body.customer_65_or_older ?? false, licenseState);
    if (!noticeDays.ok) return err(noticeDays.error.message);

    const signedAt = new Date();
    const cancelByDate = computeCancelByDate(signedAt, noticeDays.value);

    // ── Build project description from line items ──
    const projectDescription = lines
      .map((l) => `${l.description} (${l.option})`)
      .join("; ");

    const customerAddress = [
      customer.address_line1, customer.address_line2,
      customer.city, customer.state, customer.zip,
    ].filter(Boolean).join(", ");

    // ── Look up commitment days from package_components ──
    const pkgItemIds = lines.map((l) => l.description); // best effort
    const { data: pkgComponents } = await sb
      .from("package_components")
      .select("commitment_days, option")
      .eq("tenant_id", estimate.tenant_id)
      .eq("option", "base")
      .not("commitment_days", "is", null);

    const commitmentDays = pkgComponents?.reduce(
      (max, c) => Math.max(max, c.commitment_days ?? 0), 0,
    ) ?? 10; // PLACEHOLDER: default 10 days

    const contractNumber = `C-${estimate.tenant_id.slice(0, 6).toUpperCase()}-${Date.now()}`;

    // ── Generate PDF ──
    const pdfBytes = await buildContractPdf({
      contractNumber,
      tenantName: tenant.brand_name ?? tenant.name,
      tenantLegalEntity: tenant.legal_entity_name ?? tenant.name,
      tenantLicense: tenant.license_number ?? "PENDING",
      tenantLicenseState: licenseState,
      customerName: customer.name,
      customerAddress,
      projectDescription,
      totalCents,
      schedule,
      commitmentDays,
      cancelByDate,
      cancellationNoticeDays: noticeDays.value,
      templateVersion: TEMPLATE_VERSION,
    });

    // ── Upload to Supabase Storage ──
    const pdfPath = `${estimate.tenant_id}/${estimate.id}/${contractNumber}.pdf`;
    const { error: uploadErr } = await sb.storage
      .from(STORAGE_BUCKET)
      .upload(pdfPath, pdfBytes, { contentType: "application/pdf", upsert: true });

    if (uploadErr) return err(`PDF upload failed: ${uploadErr.message}`);

    // ── Create contracts row ──
    const { data: contract, error: contractErr } = await sb
      .from("contracts")
      .insert({
        tenant_id: estimate.tenant_id,
        estimate_id: estimate.id,
        customer_id: estimate.customer_id,
        opportunity_id: estimate.opportunity_id,
        project_description: projectDescription,
        total_cents: totalCents,
        status: "draft",
        pdf_path: pdfPath,
        esign_provider: "manual",
        cancellation_notice_type: noticeDays.value === 5 ? "five_day" : "three_day",
        cancel_by_date: cancelByDate.toISOString().slice(0, 10),
        customer_65_or_older: body.customer_65_or_older ?? false,
        template_version: TEMPLATE_VERSION,
      })
      .select("id")
      .single();

    if (contractErr || !contract) return err(`Contract insert failed: ${contractErr?.message}`);

    // ── Create payment schedule rows ──
    const scheduleRows = schedule.map((item) => ({
      ...item,
      tenant_id: estimate.tenant_id,
      contract_id: contract.id,
    }));
    const { error: schedErr } = await sb.from("payment_schedule_items").insert(scheduleRows);
    if (schedErr) return err(`Payment schedule insert failed: ${schedErr.message}`);

    // ── Link contract back to estimate ──
    await sb.from("estimates")
      .update({ contract_id: contract.id })
      .eq("id", estimate.id)
      .eq("tenant_id", estimate.tenant_id);

    console.log(`generate-contract: created ${contract.id} for estimate ${estimate.id}`);

    return ok({
      contract_id: contract.id,
      pdf_path: pdfPath,
      total_cents: totalCents,
      deposit_cents: depositCents,
      cancel_by_date: cancelByDate.toISOString().slice(0, 10),
      template_approved: tenant.contract_template_approved,
      warning: tenant.contract_template_approved
        ? null
        : "Contract template is not yet approved. Contract can be previewed but not sent to customer.",
    });
  } catch (e) {
    console.error("generate-contract error:", e);
    if (e instanceof UnsupportedStateError) return err(e.message);
    return err(String(e));
  }
});
