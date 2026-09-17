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

    // Use service role to write, but verify the JWT to get tenant context
    const supabaseService = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Derive tenant_id from JWT — never trust body for this
    const supabaseUser = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: authError } = await supabaseUser.auth.getUser();
    if (authError || !user) throw new Error("Unauthorized");

    const { data: userRecord, error: userError } = await supabaseService
      .from("users")
      .select("tenant_id, role")
      .eq("auth_id", user.id)
      .single();
    if (userError || !userRecord) throw new Error("User not found");

    const tenantId = userRecord.tenant_id as string;

    const body = await req.json() as {
      customer_id: string;
      location_id: string;
      job_type: string;
      priority?: string;
      description?: string;
      scheduled_start?: string;
      scheduled_end?: string;
      requires_skill?: string;
      estimated_duration_minutes?: number;
    };

    // Validate customer belongs to this tenant
    const { data: customer, error: custError } = await supabaseService
      .from("customers")
      .select("id, name, phone")
      .eq("id", body.customer_id)
      .eq("tenant_id", tenantId)
      .single();
    if (custError || !customer) throw new Error("Customer not found");

    // Create the job
    const { data: job, error: jobError } = await supabaseService
      .from("jobs")
      .insert({
        tenant_id: tenantId,
        customer_id: body.customer_id,
        location_id: body.location_id,
        job_type: body.job_type,
        priority: body.priority ?? "normal",
        description: body.description ?? null,
        scheduled_start: body.scheduled_start ?? null,
        scheduled_end: body.scheduled_end ?? null,
        requires_skill: body.requires_skill ?? null,
        estimated_duration_minutes: body.estimated_duration_minutes ?? null,
        status: body.scheduled_start ? "scheduled" : "unassigned",
        source: "manual",
      })
      .select("*")
      .single();

    if (jobError) throw jobError;

    // Get tenant to check if SMS notifications are configured
    const { data: tenant } = await supabaseService
      .from("tenants")
      .select("twilio_phone_number")
      .eq("id", tenantId)
      .single();

    // Send customer confirmation SMS if Twilio is configured and scheduled_start is set
    if (tenant?.twilio_phone_number && body.scheduled_start && customer.phone) {
      // Fire and forget — don't let SMS failure block job creation
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
            template: "confirmation",
            variables: {
              customerName: customer.name,
              scheduledStart: body.scheduled_start,
              jobType: body.job_type,
            },
          }),
        }
      );
    }

    // Fire dispatch agent — fire-and-forget, don't block job creation response
    void fetch(
      `${Deno.env.get("SUPABASE_URL")}/functions/v1/dispatch-agent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
        },
        body: JSON.stringify({ job_id: job.id }),
      }
    );

    return new Response(JSON.stringify({ job }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("create-job error:", message);
    return new Response(JSON.stringify({ error: message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 400,
    });
  }
});
