// esign-webhook: Routes e-signature provider callbacks and manual uploads.
//
// Providers:
//   manual — office uploads signed PDF via POST, no external webhook needed
//   signudoc — PLACEHOLDER: implement when API credentials are provided
//
// On a signed event:
//   1. Verify the payload (provider-specific)
//   2. Download/store the signed PDF
//   3. Update contracts: status=signed, signed_at, signer_name
//   4. If cancel-by date has passed AND deposit is paid/financing approved → set effective
//
// Service-role for the manual adapter; provider webhooks are signed separately.

import { createClient } from "npm:@supabase/supabase-js@2";
import { validateServiceRoleAuth, ok, err } from "../_shared/agent-base.ts";

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

// ─── EsignProvider interface ──────────────────────────────────────────────────
// Implement this for each provider. Manual adapter below is the reference impl.

export interface EsignProvider {
  /** Verify a webhook payload from this provider. Returns false to reject. */
  verifyWebhook(req: Request, rawBody: string): Promise<boolean>;
  /** Extract contract ID, signer name, signed timestamp from verified payload. */
  parseSignedEvent(payload: unknown): { contractId: string; signerName: string; signedAt: Date } | null;
  /** Download the signed PDF and return as bytes, or null if not available yet. */
  fetchSignedDocument(envelopeId: string): Promise<Uint8Array | null>;
}

// ─── Manual adapter ───────────────────────────────────────────────────────────
// Office posts multipart form-data: contract_id, signer_name, signed_at, pdf file.

class ManualAdapter implements EsignProvider {
  async verifyWebhook(req: Request, _rawBody: string): Promise<boolean> {
    return validateServiceRoleAuth(req);
  }

  parseSignedEvent(_payload: unknown): null {
    // Manual adapter does not use parseSignedEvent — handled inline in the handler.
    return null;
  }

  async fetchSignedDocument(_envelopeId: string): Promise<null> {
    // Manual adapter: PDF is uploaded directly by the office, no fetch needed.
    return null;
  }
}

// ─── SignuDoc adapter (PLACEHOLDER) ──────────────────────────────────────────

class SignuDocAdapter implements EsignProvider {
  async verifyWebhook(_req: Request, _rawBody: string): Promise<boolean> {
    // PLACEHOLDER: implement SignuDoc webhook signature verification
    // See: https://docs.signudoc.com/webhooks (verify before integrating)
    throw new Error("SignuDoc adapter not yet implemented. Add API credentials and implement verifyWebhook.");
  }

  parseSignedEvent(_payload: unknown): null {
    // PLACEHOLDER: parse SignuDoc signed event payload
    throw new Error("SignuDoc adapter not yet implemented.");
  }

  async fetchSignedDocument(_envelopeId: string): Promise<null> {
    // PLACEHOLDER: fetch signed PDF from SignuDoc API
    throw new Error("SignuDoc adapter not yet implemented.");
  }
}

function getAdapter(provider: string): EsignProvider {
  if (provider === "manual") return new ManualAdapter();
  if (provider === "signudoc") return new SignuDocAdapter();
  throw new Error(`Unknown esign provider: "${provider}". Supported: manual, signudoc (pending).`);
}

// ─── Effectivity check ────────────────────────────────────────────────────────

async function checkAndSetEffective(contractId: string, tenantId: string): Promise<void> {
  const sb = getSupabase();
  const { data: contract } = await sb
    .from("contracts")
    .select("id, status, cancel_by_date, signed_at")
    .eq("id", contractId)
    .eq("tenant_id", tenantId)
    .single();

  if (!contract || contract.status !== "signed") return;

  const cancelBy = contract.cancel_by_date ? new Date(contract.cancel_by_date) : null;
  const now = new Date();
  if (!cancelBy || now < cancelBy) return; // still in cancellation window

  // Check deposit paid or financing approved
  const { data: schedule } = await sb
    .from("payment_schedule_items")
    .select("status, trigger_type")
    .eq("contract_id", contractId)
    .eq("trigger_type", "contract_signed")
    .single();

  const { data: estimate } = await sb
    .from("estimates")
    .select("financing_application_id")
    .eq("contract_id", contractId)
    .single();

  const depositPaid = schedule?.status === "paid";
  const financingApproved = !!estimate?.financing_application_id;

  if (depositPaid || financingApproved) {
    await sb
      .from("contracts")
      .update({ status: "effective", effective_at: now.toISOString() })
      .eq("id", contractId)
      .eq("tenant_id", tenantId);

    // Set opportunity to won
    const { data: c } = await sb
      .from("contracts")
      .select("opportunity_id")
      .eq("id", contractId)
      .single();
    if (c?.opportunity_id) {
      await sb.from("opportunities")
        .update({ status: "won", won_at: now.toISOString() })
        .eq("id", c.opportunity_id)
        .eq("tenant_id", tenantId);
    }

    console.log(`esign-webhook: contract ${contractId} set to effective`);

    // Trigger project creation
    await fetch(
      `${Deno.env.get("SUPABASE_URL")}/functions/v1/project-create`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
        },
        body: JSON.stringify({ contract_id: contractId }),
      },
    ).catch((e) => console.error("esign-webhook: project-create call failed:", e));
  }
}

// ─── Main handler ─────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  const provider = url.searchParams.get("provider") ?? "manual";

  // Manual adapter: multipart form upload from office
  if (provider === "manual") {
    if (!validateServiceRoleAuth(req)) return err("Unauthorized", 401);

    let formData: FormData;
    try {
      formData = await req.formData();
    } catch {
      return err("Invalid form data");
    }

    const contractId = formData.get("contract_id")?.toString();
    const signerName = formData.get("signer_name")?.toString();
    const signedAtStr = formData.get("signed_at")?.toString();
    const pdfFile = formData.get("signed_pdf") as File | null;

    if (!contractId || !signerName || !pdfFile) {
      return err("Missing required fields: contract_id, signer_name, signed_pdf");
    }

    const sb = getSupabase();
    const { data: contract } = await sb
      .from("contracts")
      .select("id, tenant_id, status, pdf_path")
      .eq("id", contractId)
      .single();

    if (!contract) return err("Contract not found");
    if (contract.status === "effective" || contract.status === "void") {
      return err(`Contract is already ${contract.status}`);
    }

    const pdfBytes = new Uint8Array(await pdfFile.arrayBuffer());
    const signedPath = (contract.pdf_path as string)?.replace(".pdf", "-signed.pdf") ??
      `${contract.tenant_id}/${contractId}/signed.pdf`;

    const { error: uploadErr } = await sb.storage
      .from(STORAGE_BUCKET)
      .upload(signedPath, pdfBytes, { contentType: "application/pdf", upsert: true });

    if (uploadErr) return err(`Upload failed: ${uploadErr.message}`);

    const signedAt = signedAtStr ? new Date(signedAtStr) : new Date();

    await sb.from("contracts").update({
      status: "signed",
      signed_pdf_path: signedPath,
      signed_at: signedAt.toISOString(),
      signer_name: signerName,
    }).eq("id", contractId).eq("tenant_id", contract.tenant_id);

    await checkAndSetEffective(contractId, contract.tenant_id as string);

    return ok({ signed: true, contract_id: contractId });
  }

  // Provider webhook (signudoc etc.)
  const rawBody = await req.text();
  let adapter: EsignProvider;
  try {
    adapter = getAdapter(provider);
  } catch (e) {
    return err(String(e), 400);
  }

  const valid = await adapter.verifyWebhook(req, rawBody);
  if (!valid) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });

  // PLACEHOLDER: parse and handle provider webhook events
  // When SignuDoc or another provider is integrated, implement parseSignedEvent
  // and fetchSignedDocument in that adapter, then call checkAndSetEffective.
  console.log(`esign-webhook: received ${provider} event (not yet implemented)`);
  return ok({ received: true });
});
