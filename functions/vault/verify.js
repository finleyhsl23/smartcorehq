async function sha256Hex(str) {
  const enc = new TextEncoder().encode(str);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  const arr = Array.from(new Uint8Array(buf));
  return arr.map(b => b.toString(16).padStart(2,"0")).join("");
}

function json(status, obj){
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type":"application/json", "cache-control":"no-store" }
  });
}

export async function onRequestPost(context) {
  const { env, request } = context;

  // Expect Authorization: Bearer <supabase_access_token>
  const auth = request.headers.get("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if(!token) return json(401, { error: "Missing bearer token" });

  const { pin } = await request.json().catch(() => ({}));
  if(!pin) return json(400, { error: "Missing pin" });

  const salt = env.VAULT_PIN_SALT || "";
  const expectedHash = (env.VAULT_PIN_HASH || "").toLowerCase();
  if(!salt || !expectedHash){
    return json(500, { error: "Vault PIN env not configured" });
  }

  // Hash the supplied pin
  const gotHash = (await sha256Hex(salt + String(pin))).toLowerCase();

  // NOTE:
  // This function returns success/fail now.
  // Next step: add attempt tracking + 10min lockout + 20min unlock session + audit log writes.
  // That part needs either:
  //  (A) Supabase Edge Function with service role, or
  //  (B) Cloudflare function calling Supabase REST with service role
  // so we can store lockouts + unlock sessions server-side.

  if(gotHash !== expectedHash){
    return json(403, { error: "Invalid PIN" });
  }

  return json(200, { ok: true, unlocked_for_minutes: 20 });
}
