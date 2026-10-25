/**
 * rate-job
 *
 * Public endpoint (no auth) for customer satisfaction ratings.
 * Called from the link in the post-job review SMS.
 *
 * GET  /functions/v1/rate-job?token=<UUID>         → HTML rating page (1–5 stars)
 * POST /functions/v1/rate-job?token=<UUID>&score=N → Records score, sends follow-up SMS
 *
 * Routing:
 *   score >= tenant.satisfaction_threshold → send Google/Yelp review link
 *   score <  tenant.satisfaction_threshold → send internal apology + contact info
 */

import { createClient } from "npm:@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const TWILIO_ACCOUNT_SID = Deno.env.get("TWILIO_ACCOUNT_SID")!;
const TWILIO_AUTH_TOKEN  = Deno.env.get("TWILIO_AUTH_TOKEN")!;

async function sendSms(to: string, from: string, body: string): Promise<void> {
  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`,
    {
      method: "POST",
      headers: {
        "Authorization": "Basic " + btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ To: to, From: from, Body: body }).toString(),
    },
  );
  if (!res.ok) throw new Error(`Twilio SMS failed: ${res.status} ${await res.text()}`);
}

function ratingPage(token: string, companyName: string, alreadyRated: boolean): string {
  if (alreadyRated) {
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Thank you</title>
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <style>body{font-family:sans-serif;max-width:480px;margin:60px auto;text-align:center;padding:24px;color:#1a1a2e}</style>
    </head><body><h2>Thanks!</h2><p>You've already rated this visit. We appreciate your feedback.</p></body></html>`;
  }

  const stars = [1, 2, 3, 4, 5].map((n) =>
    `<a href="?token=${token}&score=${n}" style="display:inline-block;font-size:40px;text-decoration:none;margin:4px;color:${n <= 3 ? "#f59e0b" : "#f59e0b"}">${"★"}</a>`
  ).join("");

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Rate your visit</title>
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <style>
    body{font-family:sans-serif;max-width:480px;margin:60px auto;text-align:center;padding:24px;color:#1a1a2e}
    h2{margin-bottom:8px}p{color:#6b7280;margin-bottom:24px}
    .stars a{font-size:48px;text-decoration:none;color:#d1d5db;display:inline-block;margin:4px;cursor:pointer}
    .stars a:hover,.stars a:focus{color:#f59e0b}
  </style>
  </head><body>
    <h2>How did we do?</h2>
    <p>Rate your experience with ${companyName}</p>
    <div class="stars">
      ${[1,2,3,4,5].map((n) =>
        `<a href="?token=${token}&score=${n}" title="${n} star${n>1?"s":""}" aria-label="${n} star${n>1?"s":""}">★</a>`
      ).join("")}
    </div>
    <p style="margin-top:24px;font-size:13px;color:#9ca3af">Tap a star to rate</p>
  </body></html>`;
}

function thankYouPage(positive: boolean, reviewUrl: string | null, companyName: string): string {
  const msg = positive
    ? `We're so glad you had a great experience! Please share it — it means the world to our small team.`
    : `We're sorry your experience wasn't perfect. Someone from our team will reach out shortly to make it right.`;

  const cta = positive && reviewUrl
    ? `<a href="${reviewUrl}" style="display:inline-block;margin-top:24px;padding:12px 24px;background:#2563eb;color:#fff;border-radius:8px;text-decoration:none;font-size:16px">Leave a review</a>`
    : "";

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Thank you</title>
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <style>body{font-family:sans-serif;max-width:480px;margin:60px auto;text-align:center;padding:24px;color:#1a1a2e}</style>
  </head><body>
    <h2>${positive ? "Thank you! 🌟" : "Thank you for letting us know"}</h2>
    <p>${msg}</p>
    ${cta}
    <p style="margin-top:32px;font-size:13px;color:#9ca3af">${companyName}</p>
  </body></html>`;
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });

  try {
    const url   = new URL(req.url);
    const token = url.searchParams.get("token");
    const score = parseInt(url.searchParams.get("score") ?? "", 10);

    if (!token) {
      return new Response("Missing token", { status: 400 });
    }

    // Look up the job by token — includes tenant and customer data
    const { data: job, error: jobErr } = await supabase
      .from("jobs")
      .select("id, tenant_id, customer_id, satisfaction_score, satisfaction_rated_at, tenants(name, twilio_phone_number, google_review_url, yelp_review_url, satisfaction_threshold), customers(name, phone)")
      .eq("satisfaction_token", token)
      .is("deleted_at", null)
      .single();

    if (jobErr || !job) {
      return new Response("Not found", { status: 404 });
    }

    const tenant   = job.tenants as { name: string; twilio_phone_number: string | null; google_review_url: string | null; yelp_review_url: string | null; satisfaction_threshold: number } | null;
    const customer = job.customers as { name: string; phone: string | null } | null;

    // GET with no score → show rating page
    if (!score || score < 1 || score > 5) {
      const alreadyRated = job.satisfaction_rated_at !== null;
      return new Response(
        ratingPage(token, tenant?.name ?? "the company", alreadyRated),
        { headers: { ...CORS_HEADERS, "Content-Type": "text/html; charset=utf-8" } },
      );
    }

    // Already rated — idempotent, show thank you page
    if (job.satisfaction_rated_at) {
      const threshold  = tenant?.satisfaction_threshold ?? 4;
      const positive   = (job.satisfaction_score ?? 0) >= threshold;
      const reviewUrl  = tenant?.google_review_url ?? tenant?.yelp_review_url ?? null;
      return new Response(
        thankYouPage(positive, reviewUrl, tenant?.name ?? ""),
        { headers: { ...CORS_HEADERS, "Content-Type": "text/html; charset=utf-8" } },
      );
    }

    // Record score
    await supabase
      .from("jobs")
      .update({ satisfaction_score: score, satisfaction_rated_at: new Date().toISOString() })
      .eq("id", job.id as string);

    const threshold = tenant?.satisfaction_threshold ?? 4;
    const positive  = score >= threshold;
    const reviewUrl = tenant?.google_review_url ?? tenant?.yelp_review_url ?? null;

    // Send follow-up SMS
    if (customer?.phone && tenant?.twilio_phone_number) {
      const fn = customer.name?.split(" ")[0] ?? customer.name;
      const smsBody = positive && reviewUrl
        ? `Thanks ${fn}! We're thrilled you had a great experience. Would you mind sharing it? ${reviewUrl} (You can delete this if you'd prefer not to.)`
        : `Thanks for your honest feedback, ${fn}. We take this seriously — someone from ${tenant.name} will reach out within 24 hours to make it right.`;

      try {
        await sendSms(customer.phone, tenant.twilio_phone_number, smsBody);
      } catch (smsErr) {
        console.error("rate-job follow-up SMS failed:", smsErr);
      }
    }

    return new Response(
      thankYouPage(positive, reviewUrl, tenant?.name ?? ""),
      { headers: { ...CORS_HEADERS, "Content-Type": "text/html; charset=utf-8" } },
    );
  } catch (err) {
    console.error("rate-job error:", err);
    return new Response("Internal error", { status: 500 });
  }
});
