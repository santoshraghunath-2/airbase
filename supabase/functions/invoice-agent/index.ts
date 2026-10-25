// Invoice Agent — reviews and sends invoices on job completion.
//
// Trigger: set up this pg_net trigger in Supabase SQL editor (run once):
//
//   CREATE OR REPLACE FUNCTION trg_jobs_invoice_agent()
//   RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
//   BEGIN
//     IF NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed' THEN
//       PERFORM _call_edge_function(
//         'invoice-agent',
//         jsonb_build_object('type', 'UPDATE', 'table', 'jobs', 'schema', 'public',
//                            'record', row_to_json(NEW), 'old_record', row_to_json(OLD))
//       );
//     END IF;
//     RETURN NEW;
//   END;
//   $$;
//
//   CREATE TRIGGER jobs_invoice_agent
//     AFTER UPDATE ON jobs
//     FOR EACH ROW EXECUTE FUNCTION trg_jobs_invoice_agent();
//
// Required secrets: SENDGRID_API_KEY, SENDGRID_FROM_EMAIL
// (invoices over $500 are never auto-sent per platform policy — they always go to review)

import { createClient } from "npm:@supabase/supabase-js@2";
import {
  loadAgentContext,
  finalizeAction,
  validateServiceRoleAuth,
  ok,
  err,
} from "../_shared/agent-base.ts";
import { callAgent } from "../_shared/llm-router.ts";
import type { NormalisedTool } from "../_shared/llm-router.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const SENDGRID_KEY      = Deno.env.get("SENDGRID_API_KEY");
const SENDGRID_FROM     = Deno.env.get("SENDGRID_FROM_EMAIL") ?? "noreply@example.com";
const AUTO_SEND_CEILING = 500; // CLAUDE.md: never auto-execute financial tx > $500

// ─── SendGrid ─────────────────────────────────────────────────────────────────

interface LineItem { description: string; quantity: number; unit_price: number; total: number }

function buildInvoiceHtml(
  invoiceNumber: string,
  lineItems: LineItem[],
  subtotal: number,
  tax: number,
  total: number,
  companyName: string,
  customerName: string,
  notes: string | null,
): string {
  const rows = lineItems
    .map((li) => `<tr>
      <td style="padding:6px 0;border-bottom:1px solid #eee">${li.description}</td>
      <td style="padding:6px 0;border-bottom:1px solid #eee;text-align:center">${li.quantity}</td>
      <td style="padding:6px 0;border-bottom:1px solid #eee;text-align:right">$${li.unit_price.toFixed(2)}</td>
      <td style="padding:6px 0;border-bottom:1px solid #eee;text-align:right">$${li.total.toFixed(2)}</td>
    </tr>`)
    .join("");

  return `<!DOCTYPE html><html><body style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px">
    <h2 style="color:#1a1a2e">${companyName}</h2>
    <p>Hi ${customerName},<br>Thank you for your business. Please find your invoice below.</p>
    <h3>Invoice ${invoiceNumber}</h3>
    <table style="width:100%;border-collapse:collapse">
      <thead><tr style="border-bottom:2px solid #333">
        <th style="text-align:left;padding:6px 0">Description</th>
        <th style="text-align:center;padding:6px 0">Qty</th>
        <th style="text-align:right;padding:6px 0">Unit Price</th>
        <th style="text-align:right;padding:6px 0">Total</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div style="margin-top:16px;text-align:right">
      <p>Subtotal: $${subtotal.toFixed(2)}</p>
      ${tax > 0 ? `<p>Tax: $${tax.toFixed(2)}</p>` : ""}
      <p style="font-size:1.2em;font-weight:bold">Total Due: $${total.toFixed(2)}</p>
    </div>
    ${notes ? `<p style="color:#555;margin-top:16px">${notes}</p>` : ""}
    <p style="margin-top:32px;color:#888;font-size:12px">Questions? Reply to this email or call us directly.</p>
  </body></html>`;
}

async function sendInvoiceEmail(
  toEmail: string,
  toName: string,
  subject: string,
  html: string,
  fromName: string,
): Promise<boolean> {
  if (!SENDGRID_KEY) return false;
  const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SENDGRID_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: toEmail, name: toName }] }],
      from: { email: SENDGRID_FROM, name: fromName },
      subject,
      content: [{ type: "text/html", value: html }],
    }),
  });
  return res.ok;
}

// ─── Tool ─────────────────────────────────────────────────────────────────────

const PROPOSE_INVOICE_TOOL: NormalisedTool = {
  name: "propose_invoice",
  description: "Submit your invoice review recommendation.",
  input_schema: {
    type: "object",
    properties: {
      recommendation: {
        type: "string",
        enum: ["auto_send", "review"],
        description: "auto_send = looks clean, send it. review = flag for operator.",
      },
      anomalies: {
        type: "array",
        items: { type: "string" },
        description: "Specific issues found. Empty array if clean.",
      },
      notes: {
        type: "string",
        description: "One-sentence summary for the operator.",
      },
      confidence: {
        type: "number",
        description: "0–1 confidence in the recommendation.",
      },
    },
    required: ["recommendation", "anomalies", "notes", "confidence"],
  },
};

// ─── Main handler ─────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (!validateServiceRoleAuth(req)) return err("Unauthorized", 401);

  try {
    const payload = await req.json();

    // Handle trigger format ({ record }) and direct call format ({ job_id })
    let job: Record<string, unknown>;
    if (payload.record) {
      job = payload.record as Record<string, unknown>;
    } else if (payload.job_id) {
      const { data: jobData } = await supabase.from("jobs").select("*").eq("id", payload.job_id as string).single();
      if (!jobData) return ok({ skip: "job not found" });
      job = jobData as Record<string, unknown>;
    } else {
      return ok({ skip: "no record or job_id in payload" });
    }

    if (job.status !== "completed") return ok({ skip: true });
    if (job.deleted_at) return ok({ skip: true });

    const tenantId = job.tenant_id as string;
    const jobId    = job.id as string;
    const jobType  = job.job_type as string;

    // ── Guard: skip non-billable job types ────────────────────────────────────
    if (["warranty_call", "recall", "estimate_only"].includes(jobType)) {
      return ok({ skip: `non-billable job type: ${jobType}` });
    }

    // ── Load agent context ────────────────────────────────────────────────────
    const ctx = await loadAgentContext(supabase, tenantId, "invoice");
    if (!ctx.config.enabled) return ok({ skip: "agent disabled" });

    // ── Load or guard-check existing invoice ──────────────────────────────────
    const { data: existingInvoice } = await supabase
      .from("invoices")
      .select("id, status, total, invoice_number, invoice_line_items(*)")
      .eq("job_id", jobId)
      .single();

    // Skip if invoice already sent/paid/void
    if (existingInvoice && !["draft", "review_required"].includes(existingInvoice.status as string)) {
      return ok({ skip: `invoice already in status: ${existingInvoice.status}` });
    }

    // ── Load job details ──────────────────────────────────────────────────────
    const [{ data: jobDetail }, { data: tenant }] = await Promise.all([
      supabase
        .from("jobs")
        .select("*, customers(id, name, email, phone), technicians(name), service_locations(address, city)")
        .eq("id", jobId)
        .single(),
      supabase.from("tenants").select("name, email").eq("id", tenantId).single(),
    ]);

    if (!jobDetail) return err(`Job ${jobId} not found`);

    const customer = jobDetail.customers as Record<string, unknown>;
    const tech     = jobDetail.technicians as Record<string, unknown>;
    const location = jobDetail.service_locations as Record<string, unknown>;

    // ── Load line items ───────────────────────────────────────────────────────
    const lineItems: LineItem[] = (existingInvoice?.invoice_line_items ?? []) as LineItem[];

    // ── Compute 90-day baseline for this job type ─────────────────────────────
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    const { data: recentInvoices } = await supabase
      .from("invoices")
      .select("total, jobs!inner(job_type)")
      .eq("tenant_id", tenantId)
      .in("status", ["sent", "viewed", "paid", "partial"])
      .gte("created_at", ninetyDaysAgo)
      .limit(100);

    const sameTypeInvoices = (recentInvoices ?? []).filter(
      (inv: Record<string, unknown>) =>
        (inv.jobs as Record<string, unknown>)?.job_type === jobType,
    );
    const avgTotal = sameTypeInvoices.length
      ? sameTypeInvoices.reduce((sum: number, inv: Record<string, unknown>) => sum + (Number(inv.total) || 0), 0) / sameTypeInvoices.length
      : null;

    // ── Build context for Claude ──────────────────────────────────────────────
    const total = lineItems.reduce((s, li) => s + li.total, 0);

    const lineItemLines = lineItems.length
      ? lineItems.map((li) => `  - ${li.description} | qty ${li.quantity} | $${li.unit_price.toFixed(2)} each | $${li.total.toFixed(2)}`).join("\n")
      : "  (no line items)";

    const baselineLine = avgTotal !== null
      ? `90-day average for ${jobType}: $${avgTotal.toFixed(2)} (${sameTypeInvoices.length} invoices)`
      : `No baseline yet for ${jobType} (first invoice of this type)`;

    const userMessage =
      `JOB DETAILS\n` +
      `Type: ${jobType}\n` +
      `Technician: ${tech?.name ?? "Unknown"}\n` +
      `Customer: ${customer?.name ?? "Unknown"}\n` +
      `Location: ${location?.address ?? ""}, ${location?.city ?? ""}\n\n` +
      `DRAFT INVOICE\n` +
      `Invoice #: ${existingInvoice?.invoice_number ?? "(not yet assigned)"}\n` +
      `Line items:\n${lineItemLines}\n` +
      `Total: $${total.toFixed(2)}\n\n` +
      `BASELINE\n${baselineLine}\n\n` +
      `Review this invoice and call propose_invoice with your recommendation.`;

    const systemPromptRaw = await Deno.readTextFile(
      new URL("../../prompts/invoice-agent.md", import.meta.url),
    ).catch(() => null) ?? "Review the invoice and call propose_invoice.";

    const systemPrompt = systemPromptRaw
      .replace("{{company_name}}", (tenant?.name as string) ?? "the company")
      .replace("{{trade}}", "home services");

    // ── Call Claude ───────────────────────────────────────────────────────────
    const result = await callAgent({
      systemPrompt,
      userMessage,
      tools: [PROPOSE_INVOICE_TOOL],
      model: ctx.resolvedModelId,
      temperature: 0.2,
      maxTokens: 1024,
    });

    const toolCall = result.toolUses.find((t) => t.name === "propose_invoice");
    if (!toolCall) return err("Invoice agent did not call propose_invoice");

    const proposal = toolCall.input as {
      recommendation: "auto_send" | "review";
      anomalies: string[];
      notes: string;
      confidence: number;
    };

    // ── Policy enforcement: always flag >$500 ─────────────────────────────────
    const mustReview =
      proposal.recommendation === "review" ||
      total > AUTO_SEND_CEILING ||
      !customer?.email;

    if (total > AUTO_SEND_CEILING && proposal.recommendation === "auto_send") {
      proposal.anomalies.push(`Total $${total.toFixed(2)} exceeds $${AUTO_SEND_CEILING} auto-send limit — operator approval required`);
      proposal.recommendation = "review";
    }
    if (!customer?.email) {
      proposal.anomalies.push("Customer has no email address on file — cannot auto-send");
      proposal.recommendation = "review";
    }

    // ── Ensure invoice exists ─────────────────────────────────────────────────
    let invoiceId = existingInvoice?.id as string | undefined;
    if (!invoiceId) {
      const { data: newInvoice } = await supabase
        .from("invoices")
        .insert({
          tenant_id:     tenantId,
          job_id:        jobId,
          customer_id:   customer?.id as string,
          subtotal:      total,
          total,
          balance_due:   total,
          ai_generated:  true,
          status:        "draft",
        })
        .select("id, invoice_number")
        .single();
      invoiceId = newInvoice?.id;
    }

    // ── Finalize ──────────────────────────────────────────────────────────────
    const { actionId, autoExecuted } = await finalizeAction(supabase, {
      tenantId,
      agentType:       "invoice",
      triggerEvent:    `job:${jobId}:status:completed`,
      contextSnapshot: { job_id: jobId, job_type: jobType, invoice_id: invoiceId, total, avg_baseline: avgTotal },
      reasoning:       `${proposal.notes}${proposal.anomalies.length ? ` Anomalies: ${proposal.anomalies.join("; ")}` : ""}`,
      proposedAction: {
        type:           "send_invoice",
        invoice_id:     invoiceId,
        recommendation: proposal.recommendation,
        anomalies:      proposal.anomalies,
        notes:          proposal.notes,
      },
      confidence:    proposal.confidence,
      config:        ctx.config,
      modelUsed:     result.modelUsed,
      providerUsed:  result.providerUsed,
      inputTokens:   result.usage.inputTokens,
      outputTokens:  result.usage.outputTokens,
      onAutoExecute: async () => {
        if (mustReview) throw new Error("Policy requires review — should not auto-execute");

        // Send invoice email
        const invoiceNumber = existingInvoice?.invoice_number ?? invoiceId?.slice(0, 8) ?? "";
        const html = buildInvoiceHtml(
          invoiceNumber, lineItems, total, 0, total,
          (tenant?.name as string) ?? "Your service company",
          (customer?.name as string) ?? "Valued Customer",
          null,
        );
        const sent = await sendInvoiceEmail(
          customer?.email as string,
          customer?.name as string,
          `Invoice ${invoiceNumber} from ${tenant?.name ?? ""}`,
          html,
          (tenant?.name as string) ?? "",
        );

        if (!sent) throw new Error("SendGrid send failed — check SENDGRID_API_KEY");

        // Update invoice status
        await supabase
          .from("invoices")
          .update({ status: "sent", sent_at: new Date().toISOString(), ai_generated: true })
          .eq("id", invoiceId);

        // Advance job status
        await supabase
          .from("jobs")
          .update({ status: "invoiced" })
          .eq("id", jobId)
          .eq("tenant_id", tenantId);
      },
    });

    // If not auto-executing: flag the invoice for review
    if (!autoExecuted) {
      await supabase
        .from("invoices")
        .update({
          status:         "review_required",
          ai_generated:   true,
          ai_flagged:     true,
          ai_flag_reason: proposal.anomalies.length
            ? proposal.anomalies.join("; ")
            : proposal.notes,
        })
        .eq("id", invoiceId);
    }

    return ok({ actionId, autoExecuted, invoiceId, recommendation: proposal.recommendation });
  } catch (e) {
    console.error("invoice-agent error:", e);
    return err(String(e));
  }
});
