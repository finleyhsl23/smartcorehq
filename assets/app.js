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

async function loadConfig(){
  // Cloudflare Pages Function: /config
  const r = await fetch("/config", { headers: { "Accept": "application/json" } });
  if(!r.ok) throw new Error("Config endpoint failed");
  return r.json();
}

async function initSupabase(){
  try{
    const cfg = await loadConfig();
    if(!cfg?.SUPABASE_URL || !cfg?.SUPABASE_ANON){
      throw new Error("Missing SUPABASE_URL or SUPABASE_ANON");
    }

    sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });

    $("envHint").textContent = "Environment loaded.";
    setStatus("sbDot","sbText", true, "Supabase: connected");
    return true;
  }catch(e){
    $("envHint").textContent = "Missing environment. Check Cloudflare env vars + /config function.";
    setStatus("sbDot","sbText", false, "Supabase: not initialised");
    setStatus("authDot","authText", false, "Auth: unavailable");
    setStatus("accessDot","accessText", false, "Access: unavailable");
    return false;
  }
}

async function getSession(){
  const { data, error } = await sb.auth.getSession();
  if(error) return null;
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
    toastLogin(false, "Access denied: you’re not listed in smartcore_logins.");
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
}

async function signIn(email, password){
  toastLogin(true, "Signing in…");
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if(error){
    toastLogin(false, error.message);
    return;
  }
  await enforceAccess();
}

async function signOut(){
  await sb.auth.signOut();
  currentProfile = null;
  $("sessionPill").style.display = "none";
  setStatus("authDot","authText", false, "Auth: signed out");
  setStatus("accessDot","accessText", false, "Access: not signed in");
  showView("login");
}

function modalOpen(title, desc, bodyEl, actions = []){
  $("modalTitle").textContent = title;
  $("modalDesc").textContent = desc;

  const b = $("modalBody");
  const a = $("modalActions");

  b.innerHTML = "";
  a.innerHTML = "";

  b.appendChild(bodyEl);

  actions.forEach(btn => a.appendChild(btn));
  $("modalWrap").classList.add("active");
}

function modalClose(){
  $("modalWrap").classList.remove("active");
}

async function openVaultUnlock(){
  if(currentProfile?.role !== "admin") return;

  const body = document.createElement("div");
  body.className = "fields";
  body.innerHTML = `
    <div class="field">
      <label for="pin">PIN</label>
      <input id="pin" type="password" inputmode="numeric" autocomplete="one-time-code" placeholder="••••" />
      <div class="note" style="margin-top:8px;">PIN verification is server-side. Max 5 attempts. 10 min lockout. 20 min unlock session.</div>
    </div>
  `;

  const btnCancel = document.createElement("button");
  btnCancel.className = "btn linky";
  btnCancel.type = "button";
  btnCancel.textContent = "Cancel";
  btnCancel.onclick = modalClose;

  const btnVerify = document.createElement("button");
  btnVerify.className = "btn primary";
  btnVerify.type = "button";
  btnVerify.textContent = "Verify";
  btnVerify.onclick = async () => {
    const pin = body.querySelector("#pin").value.trim();
    if(!pin){ return; }

    btnVerify.disabled = true;
    btnVerify.textContent = "Verifying…";

    try{
      const session = await getSession();
      const r = await fetch("/vault/verify", {
        method: "POST",
        headers: {
          "Content-Type":"application/json",
          "Authorization": `Bearer ${session.access_token}`
        },
        body: JSON.stringify({ pin })
      });

      const data = await r.json().catch(() => ({}));

      if(!r.ok){
        btnVerify.disabled = false;
        btnVerify.textContent = "Verify";
        const msg = data?.error || "Verification failed";
        alert(msg);
        return;
      }

      // success
      modalClose();
      alert("Vault unlocked for 20 minutes (session-based). Next: we’ll show vault list UI.");
    }catch(e){
      btnVerify.disabled = false;
      btnVerify.textContent = "Verify";
      alert("Verification error.");
    }
  };

  modalOpen(
    "Vault Unlock",
    "Enter PIN to unlock admin vault access.",
    body,
    [btnCancel, btnVerify]
  );

  setTimeout(() => {
    const pinInput = body.querySelector("#pin");
    if(pinInput) pinInput.focus();
  }, 50);
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

  $("modalClose").addEventListener("click", modalClose);
  $("modalWrap").addEventListener("click", (e) => {
    if(e.target === $("modalWrap")) modalClose();
  });
  window.addEventListener("keydown", (e) => {
    if(e.key === "Escape") modalClose();
  });

  $("btnOpenVaultUnlock")?.addEventListener("click", openVaultUnlock);
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
