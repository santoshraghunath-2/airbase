import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Missing authorization header");

    const supabaseService = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );
    const supabaseUser = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: authError } = await supabaseUser.auth.getUser();
    if (authError || !user) throw new Error("Unauthorized");

    const { data: userRecord } = await supabaseService
      .from("users")
      .select("tenant_id")
      .eq("auth_id", user.id)
      .single();
    if (!userRecord) throw new Error("User not found");

    const tenantId = userRecord.tenant_id as string;
    const body = await req.json() as { job_id: string; notes?: string };

    const { data: job, error: jobError } = await supabaseService
      .from("jobs")
      .select("*, customers(name, phone, email)")
      .eq("id", body.job_id)
      .eq("tenant_id", tenantId)
      .single();
    if (jobError || !job) throw new Error("Job not found");

    // Mark completed
    const now = new Date().toISOString();
    const scheduledStart = job.scheduled_start ? new Date(job.scheduled_start as string) : null;
    const actualStart = job.actual_start ? new Date(job.actual_start as string) : scheduledStart;
    const actualDuration = actualStart
      ? Math.round((new Date(now).getTime() - actualStart.getTime()) / 60000)
      : null;

    const { error: updateError } = await supabaseService
      .from("jobs")
      .update({
        status: "completed",
        actual_end: now,
        actual_duration_minutes: actualDuration,
        ...(body.notes ? { internal_notes: body.notes } : {}),
      })
      .eq("id", body.job_id);
    if (updateError) throw updateError;

    // Send customer thank-you SMS
    const { data: tenant } = await supabaseService
      .from("tenants")
      .select("twilio_phone_number, name")
      .eq("id", tenantId)
      .single();

    const customer = job.customers as { name: string; phone: string; email: string };
    if (tenant?.twilio_phone_number && customer.phone) {
      void fetch(
        `${Deno.env.get("SUPABASE_URL")}/functions/v1/send-sms`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
          },
          body: JSON.stringify({
            to: customer.phone,
            tenantId,
            template: "job_complete",
            variables: {
              customerName: customer.name,
              companyName: tenant.name,
            },
          }),
        }
      );
    }

    // Invoice agent fires via DB trigger (trg_jobs_invoice_agent from migration 040)
    // when the status update above completes. No explicit call needed here.

    return new Response(JSON.stringify({ success: true, job_id: body.job_id }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("close-job error:", message);
    return new Response(JSON.stringify({ error: message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 400,
    });
  }
});
