export async function onRequestPost(context) {
  try {
    const { request, env } = context;

    // PIN stored only as env var (server-side), NOT in frontend
    // Set in Cloudflare Pages env vars: VAULT_PIN = 9656 (temporary)
    const VAULT_PIN = env.VAULT_PIN;
    if (!VAULT_PIN) {
      return json({ ok: false, message: "Server PIN not configured." }, 500);
    }

    const authHeader = request.headers.get("Authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!token) return json({ ok: false, message: "Missing auth token." }, 401);

    const body = await request.json().catch(() => ({}));
    const pin = String(body.pin || "").trim();
    if (!pin) return json({ ok: false, message: "PIN required." }, 400);

    // Supabase REST endpoints from env (reuse /config values in Pages env)
    const supabaseUrl = env.SUPABASE_URL;
    const supabaseAnon = env.SUPABASE_ANON;
    if (!supabaseUrl || !supabaseAnon) return json({ ok:false, message:"Server not configured." }, 500);

    // 1) Identify user from token
    const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: {
        "apikey": supabaseAnon,
        "Authorization": `Bearer ${token}`
      }
    });
    if (!userRes.ok) return json({ ok:false, message:"Auth invalid." }, 401);
    const user = await userRes.json();
    const userId = user?.id;

    // 2) Confirm admin role by reading smartcore_logins (RLS allows self-read)
    const loginRes = await fetch(`${supabaseUrl}/rest/v1/smartcore_logins?select=role,email&id=eq.${encodeURIComponent(userId)}`, {
      headers: {
        "apikey": supabaseAnon,
        "Authorization": `Bearer ${token}`,
        "Accept": "application/json"
      }
    });

    // If you don’t have user_id in smartcore_logins (only email), fall back to email lookup:
    let role = null;

    if (loginRes.ok) {
      const rows = await loginRes.json();
      role = rows?.[0]?.role || null;
    }

    if (!role) {
      const email = (user?.email || "").toLowerCase();
      const emailRes = await fetch(`${supabaseUrl}/rest/v1/smartcore_logins?select=role,email&email=ilike.${encodeURIComponent(email)}`, {
        headers: {
          "apikey": supabaseAnon,
          "Authorization": `Bearer ${token}`,
          "Accept": "application/json"
        }
      });
      if (emailRes.ok) {
        const rows = await emailRes.json();
        role = rows?.[0]?.role || null;
      }
    }

    if (role !== "admin") {
      return json({ ok:false, message:"Admin only." }, 403);
    }

    // 3) Check lockout: count failed unlock_attempt in last 10 minutes
    const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();

    const auditUrl = `${supabaseUrl}/rest/v1/vault_audit_log?select=action,timestamp&user_id=eq.${encodeURIComponent(userId)}&timestamp=gte.${encodeURIComponent(since)}&action=eq.unlock_attempt_failed`;

    const auditRes = await fetch(auditUrl, {
      headers: {
        "apikey": supabaseAnon,
        "Authorization": `Bearer ${token}`,
        "Accept": "application/json"
      }
    });

    let failedCount = 0;
    if (auditRes.ok) {
      const rows = await auditRes.json();
      failedCount = rows?.length || 0;
    }

    if (failedCount >= 5) {
      return json({ ok:false, message:"Too many attempts. Locked for 10 minutes." }, 429);
    }

    // 4) Verify PIN
    const ok = (pin === String(VAULT_PIN));

    // 5) Log attempt
    await fetch(`${supabaseUrl}/rest/v1/vault_audit_log`, {
      method: "POST",
      headers: {
        "apikey": supabaseAnon,
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
        "Prefer": "return=minimal"
      },
      body: JSON.stringify({
        user_id: userId,
        action: ok ? "unlocked" : "unlock_attempt_failed",
        vault_item_id: null,
        timestamp: new Date().toISOString()
      })
    }).catch(() => {});

    if (!ok) {
      return json({ ok:false, message:"Incorrect PIN." }, 401);
    }

    return json({ ok:true, message:"Unlocked." }, 200);

  } catch (e) {
    return json({ ok:false, message: e.message || String(e) }, 500);
  }
}

function json(obj, status=200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}
