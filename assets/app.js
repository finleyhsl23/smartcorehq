/* global supabase */

const $ = (id) => document.getElementById(id);

const views = {
  login: $("viewLogin"),
  dash: $("viewDashboard"),
  calendar: $("viewCalendar"),
  customers: $("viewCustomers"),
  finance: $("viewFinance"),
  vault: $("viewVault")
};

function setDot(dotEl, ok){
  dotEl.classList.remove("ok","bad");
  dotEl.classList.add(ok ? "ok" : "bad");
}
function setStatus(dotId, textId, ok, text){
  setDot($(dotId), ok);
  $(textId).textContent = text;
}
function toastLogin(ok, msg){
  const box = $("loginStatus");
  box.style.display = "inline-flex";
  setDot($("loginDot"), ok);
  $("loginStatusText").textContent = msg;
}
function showView(name){
  Object.values(views).forEach(v => v.classList.remove("active"));
  views[name].classList.add("active");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

let sb = null;
let currentProfile = null;

window.addEventListener("unhandledrejection", (e) => {
  console.error("Unhandled promise rejection:", e.reason);
  toastLogin(false, "Error: check console (unhandled rejection).");
});
window.addEventListener("error", (e) => {
  console.error("Window error:", e.error || e.message);
});

async function loadConfig(){
  const r = await fetch("/config", { headers: { "Accept": "application/json" } });
  const text = await r.text();
  if(!r.ok) throw new Error(`/config failed (${r.status}): ${text.slice(0,200)}`);
  try { return JSON.parse(text); }
  catch { throw new Error("Config returned non-JSON (Functions not running?)"); }
}

async function initSupabase(){
  try{
    const cfg = await loadConfig();

    if(!cfg?.SUPABASE_URL || !cfg?.SUPABASE_ANON){
      throw new Error("Missing SUPABASE_URL or SUPABASE_ANON in /config response");
    }

    sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });

    $("envHint").textContent = "Environment loaded.";
    setStatus("sbDot","sbText", true, "Supabase: connected");
    return true;
  }catch(e){
    console.error("Init error:", e);
    $("envHint").textContent = "Environment error. Open /config to verify.";
    setStatus("sbDot","sbText", false, "Supabase: not initialised");
    setStatus("authDot","authText", false, "Auth: unavailable");
    setStatus("accessDot","accessText", false, "Access: unavailable");
    toastLogin(false, e.message);
    return false;
  }
}

async function getSession(){
  const { data, error } = await sb.auth.getSession();
  if(error) throw error;
  return data.session || null;
}

async function fetchSmartcoreProfileByEmail(email){
  const { data, error } = await sb
    .from("smartcore_logins")
    .select("id,email,role,created_at,auth_user_id")
    .eq("email", email)
    .maybeSingle();

  if(error) throw error;
  return data || null;
}

async function enforceAccess(){
  try{
    const session = await getSession();

    if(!session){
      currentProfile = null;
      $("sessionPill").style.display = "none";
      setStatus("authDot","authText", false, "Auth: no session");
      setStatus("accessDot","accessText", false, "Access: not signed in");
      showView("login");
      return;
    }

    setStatus("authDot","authText", true, "Auth: session active");

    const email = session.user?.email;
    if(!email){
      await sb.auth.signOut();
      currentProfile = null;
      setStatus("accessDot","accessText", false, "Access: missing email");
      showView("login");
      return;
    }

    const profile = await fetchSmartcoreProfileByEmail(email);

    if(!profile){
      await sb.auth.signOut();
      currentProfile = null;
      setStatus("accessDot","accessText", false, "Access: denied (not in smartcore_logins)");
      toastLogin(false, "Access denied: not in smartcore_logins.");
      showView("login");
      return;
    }

    currentProfile = profile;

    $("sessionPill").style.display = "flex";
    $("sessionText").textContent = email;
    setDot($("sessionDot"), true);

    setStatus("accessDot","accessText", true, `Access: granted (${profile.role})`);

    $("roleText").textContent = (profile.role === "admin") ? "admin access" : "staff access";
    $("vaultCard").style.display = (profile.role === "admin") ? "block" : "none";

    showView("dash");
  }catch(e){
    console.error("Access enforcement error:", e);
    toastLogin(false, `Access check failed: ${e.message}`);
    setStatus("accessDot","accessText", false, "Access: error (see console)");
    // Don’t hang:
    try { await sb.auth.signOut(); } catch {}
    showView("login");
  }
}

async function signIn(email, password){
  const btn = document.getElementById("btnLogin");
  const withTimeout = (p, ms) =>
    Promise.race([
      p,
      new Promise((_, rej) => setTimeout(() => rej(new Error("Sign-in timed out. Check VPN/adblock or network.")), ms))
    ]);

  try{
    toastLogin(true, "Signing in…");
    btn.disabled = true;

    const { data, error } = await withTimeout(
      sb.auth.signInWithPassword({ email, password }),
      12000
    );

    if(error) throw error;

    console.log("Signed in:", data?.user?.email);
    await enforceAccess();
  }catch(e){
    console.error("Sign-in failed:", e);
    toastLogin(false, e.message || "Sign-in failed");
  }finally{
    btn.disabled = false;
  }
}


async function signOut(){
  await sb.auth.signOut();
  currentProfile = null;
  $("sessionPill").style.display = "none";
  setStatus("authDot","authText", false, "Auth: signed out");
  setStatus("accessDot","accessText", false, "Access: not signed in");
  showView("login");
}

function wireUI(){
  $("btnLogin").addEventListener("click", async () => {
    const email = $("email").value.trim();
    const password = $("password").value;
    if(!email || !password){
      toastLogin(false, "Enter email and password.");
      return;
    }
    await signIn(email, password);
  });

  $("password").addEventListener("keydown", (e) => {
    if(e.key === "Enter") $("btnLogin").click();
  });

  $("btnSignOut").addEventListener("click", signOut);

  document.querySelectorAll(".dashCard").forEach(card => {
    card.addEventListener("click", () => {
      const go = card.getAttribute("data-go");
      if(go === "vault" && currentProfile?.role !== "admin") return;

      if(go === "calendar") showView("calendar");
      if(go === "customers") showView("customers");
      if(go === "finance") showView("finance");
      if(go === "vault") showView("vault");
    });
  });

  document.querySelectorAll("[data-back]").forEach(btn => {
    btn.addEventListener("click", () => showView("dash"));
  });

  $("modalClose")?.addEventListener("click", () => $("modalWrap").classList.remove("active"));
  $("modalWrap")?.addEventListener("click", (e) => {
    if(e.target === $("modalWrap")) $("modalWrap").classList.remove("active");
  });
}

(async function boot(){
  wireUI();

  const ok = await initSupabase();
  if(!ok) return;

  sb.auth.onAuthStateChange(async () => {
    await enforceAccess();
  });

  await enforceAccess();
})();
