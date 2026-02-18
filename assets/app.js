(() => {
  // ---------- Helpers ----------
  const $ = (id) => document.getElementById(id);
  const money = (n) => {
    const v = Number(n || 0);
    return v.toLocaleString("en-GB", { style: "currency", currency: "GBP" });
  };
  const fmtDate = (iso) => {
    if (!iso) return "";
    const d = new Date(iso);
    return d.toLocaleDateString("en-GB");
  };
  const escapeHtml = (s) =>
    String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");

  // ---------- App State ----------
  const state = {
    supabase: null,
    session: null,
    me: null, // row from smartcore_logins
    companies: [],
    servicesByCompany: new Map(),
    transactions: [],
    vaultUnlockedUntil: 0
  };

  // ---------- Config / Supabase ----------
  async function loadConfig() {
    const res = await fetch("/config", { cache: "no-store" });
    if (!res.ok) throw new Error("Config not available");
    return await res.json();
  }

  async function initSupabase() {
    const cfg = await loadConfig();
    state.supabase = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON);
  }

  // ---------- Views ----------
  const views = {
    login: $("viewLogin"),
    dashboard: $("viewDashboard"),
    customers: $("viewCustomers"),
    calendar: $("viewCalendar"),
    finance: $("viewFinance"),
    vault: $("viewVault")
  };

  function showView(name) {
    Object.entries(views).forEach(([k, el]) => {
      if (!el) return;
      el.hidden = (k !== name);
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function bindNav() {
    document.querySelectorAll("[data-nav]").forEach(btn => {
      btn.addEventListener("click", () => goto(btn.getAttribute("data-nav")));
    });
    document.querySelectorAll("[data-back]").forEach(btn => {
      btn.addEventListener("click", () => goto("dashboard"));
    });
    $("brandHome").addEventListener("click", () => goto("dashboard"));
    $("btnSignOut").addEventListener("click", signOut);
  }

  async function goto(name) {
    if (!state.session && name !== "login") {
      showView("login");
      return;
    }

    if (name === "vault") {
      if (!state.me || state.me.role !== "admin") {
        alert("Admin only.");
        return;
      }
      await loadVaultList();
    }

    if (name === "customers") {
      await loadCompanies();
      await renderCompanies();
    }

    if (name === "finance") {
      await loadCompanies(); // for company filter dropdown
      await loadTransactions();
      renderFinance();
    }

    showView(name);
  }

  // ---------- Modal ----------
  const modal = $("modal");
  const modalTitle = $("modalTitle");
  const modalBody = $("modalBody");
  const modalFoot = $("modalFoot");

  function openModal(title, bodyHtml, footHtml) {
    modalTitle.textContent = title;
    modalBody.innerHTML = bodyHtml;
    modalFoot.innerHTML = footHtml;
    modal.hidden = false;

    modal.querySelectorAll("[data-close]").forEach(el => {
      el.addEventListener("click", closeModal);
    });
  }
  function closeModal() {
    modal.hidden = true;
    modalTitle.textContent = "—";
    modalBody.innerHTML = "";
    modalFoot.innerHTML = "";
  }

  // ---------- Auth / Access ----------
  async function getSession() {
    const { data } = await state.supabase.auth.getSession();
    state.session = data.session || null;
    return state.session;
  }

  async function loadMe() {
    if (!state.session) return null;
    const email = state.session.user.email;
    const { data, error } = await state.supabase
      .from("smartcore_logins")
      .select("*")
      .ilike("email", email)
      .maybeSingle();

    if (error) throw error;
    state.me = data || null;

    if (!state.me) {
      // signed in via Supabase auth, but not whitelisted in smartcore_logins
      await state.supabase.auth.signOut();
      state.session = null;
      return null;
    }
    return state.me;
  }

  function setTopbar() {
    const top = $("topbarRight");
    if (!state.session) {
      top.hidden = true;
      return;
    }
    top.hidden = false;
    $("userEmail").textContent = state.session.user.email || "—";
    $("vaultCard").style.display = (state.me?.role === "admin") ? "flex" : "none";
  }

  async function signIn(email, password) {
    const btn = $("btnLogin");
    btn.disabled = true;
    btn.querySelector(".btnSpinner").hidden = false;
    $("loginHint").textContent = "Signing in…";

    try {
      const { data, error } = await state.supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;

      state.session = data.session;
      const me = await loadMe();
      if (!me) {
        $("loginHint").textContent = "Access denied. You are not in smartcore_logins.";
        btn.disabled = false;
        btn.querySelector(".btnSpinner").hidden = true;
        return;
      }

      setTopbar();
      $("loginHint").textContent = "";
      goto("dashboard");
    } catch (e) {
      $("loginHint").textContent = `Sign-in failed: ${e.message || e}`;
    } finally {
      btn.disabled = false;
      btn.querySelector(".btnSpinner").hidden = true;
    }
  }

  async function signOut() {
    await state.supabase.auth.signOut();
    state.session = null;
    state.me = null;
    setTopbar();
    showView("login");
  }

  // ---------- Customers ----------
  async function loadCompanies() {
    const { data, error } = await state.supabase
      .from("companies")
      .select("*")
      .order("company_name", { ascending: true });

    if (error) throw error;
    state.companies = data || [];
    $("companyCount").textContent = `${state.companies.length} customers`;
  }

  function companyRowActions(c) {
    return `
      <div class="actions">
        <button class="btn btn-ghost btn-mini" data-action="view" data-id="${c.id}">View</button>
        <button class="btn btn-ghost btn-mini" data-action="edit" data-id="${c.id}">Edit</button>
        <button class="btn btn-ghost btn-mini" data-action="delete" data-id="${c.id}">Delete</button>
      </div>
    `;
  }

  async function renderCompanies() {
    const q = ($("companySearch").value || "").trim().toLowerCase();
    const list = state.companies.filter(c =>
      !q ||
      (c.company_name || "").toLowerCase().includes(q) ||
      (c.primary_contact_name || "").toLowerCase().includes(q) ||
      (c.primary_contact_email || "").toLowerCase().includes(q)
    );

    // desktop table
    const tbody = $("companiesBody");
    tbody.innerHTML = list.map(c => `
      <tr>
        <td><strong>${escapeHtml(c.company_name)}</strong></td>
        <td>${escapeHtml(c.primary_contact_name)}</td>
        <td>${escapeHtml(c.primary_contact_email)}</td>
        <td class="hide-sm">${escapeHtml(c.primary_contact_phone || "")}</td>
        <td>${companyRowActions(c)}</td>
      </tr>
    `).join("");

    // mobile cards
    const mobile = $("companiesMobile");
    mobile.hidden = false;
    mobile.innerHTML = list.map(c => `
      <div class="mobileCard">
        <div class="mobileCardTop">
          <div>
            <div class="mobileTitle">${escapeHtml(c.company_name)}</div>
            <div class="mobileMeta">
              ${escapeHtml(c.primary_contact_name)}<br/>
              ${escapeHtml(c.primary_contact_email)}${c.primary_contact_phone ? `<br/>${escapeHtml(c.primary_contact_phone)}` : ""}
            </div>
          </div>
        </div>
        <div class="mobileActions">
          <button class="btn btn-ghost btn-mini" data-action="view" data-id="${c.id}">View</button>
          <button class="btn btn-ghost btn-mini" data-action="edit" data-id="${c.id}">Edit</button>
          <button class="btn btn-ghost btn-mini" data-action="delete" data-id="${c.id}">Delete</button>
        </div>
      </div>
    `).join("");

    // bind actions
    document.querySelectorAll("[data-action][data-id]").forEach(btn => {
      btn.addEventListener("click", async () => {
        const id = btn.getAttribute("data-id");
        const action = btn.getAttribute("data-action");
        const company = state.companies.find(x => x.id === id);
        if (!company) return;

        if (action === "view") openCompanyView(company);
        if (action === "edit") openCompanyEdit(company);
        if (action === "delete") deleteCompany(company);
      });
    });
  }

  function companyFormHtml(c = {}) {
    return `
      <div class="field">
        <label>Company Name *</label>
        <input id="f_company_name" value="${escapeHtml(c.company_name || "")}" placeholder="e.g. BT, Tesco..." />
      </div>

      <div class="field">
        <label>Primary Contact Name *</label>
        <input id="f_primary_contact_name" value="${escapeHtml(c.primary_contact_name || "")}" placeholder="e.g. John Smith" />
      </div>

      <div class="field">
        <label>Primary Contact Email *</label>
        <input id="f_primary_contact_email" value="${escapeHtml(c.primary_contact_email || "")}" placeholder="name@company.co.uk" />
      </div>

      <div class="field">
        <label>Primary Contact Phone</label>
        <input id="f_primary_contact_phone" value="${escapeHtml(c.primary_contact_phone || "")}" placeholder="Optional" />
      </div>

      <div class="field">
        <label>Approx Staff Count</label>
        <input id="f_approx_staff_count" type="number" inputmode="numeric" value="${escapeHtml(c.approx_staff_count || "")}" placeholder="Optional" />
      </div>

      <div class="field">
        <label>Website</label>
        <input id="f_website" value="${escapeHtml(c.website || "")}" placeholder="Optional" />
      </div>

      <div class="field">
        <label>Location</label>
        <input id="f_location" value="${escapeHtml(c.location || "")}" placeholder="Optional" />
      </div>

      <div class="field">
        <label>Working Hours</label>
        <input id="f_working_hours" value="${escapeHtml(c.working_hours || "")}" placeholder="Optional" />
      </div>

      <div class="field">
        <label>Payment Plan</label>
        <input id="f_payment_plan" value="${escapeHtml(c.payment_plan || "")}" placeholder="Optional" />
      </div>

      <div class="field">
        <label>Payment Options</label>
        <input id="f_payment_options" value="${escapeHtml(c.payment_options || "")}" placeholder="Optional" />
      </div>

      <div class="field">
        <label>Notes</label>
        <textarea id="f_notes" placeholder="Optional">${escapeHtml(c.notes || "")}</textarea>
      </div>
    `;
  }

  function readCompanyForm() {
    const company_name = $("f_company_name").value.trim();
    const primary_contact_name = $("f_primary_contact_name").value.trim();
    const primary_contact_email = $("f_primary_contact_email").value.trim();

    if (!company_name || !primary_contact_name || !primary_contact_email) {
      throw new Error("Please complete Company Name, Primary Contact Name, and Primary Contact Email.");
    }

    return {
      company_name,
      primary_contact_name,
      primary_contact_email,
      primary_contact_phone: $("f_primary_contact_phone").value.trim() || null,
      approx_staff_count: $("f_approx_staff_count").value ? Number($("f_approx_staff_count").value) : null,
      website: $("f_website").value.trim() || null,
      location: $("f_location").value.trim() || null,
      working_hours: $("f_working_hours").value.trim() || null,
      payment_plan: $("f_payment_plan").value.trim() || null,
      payment_options: $("f_payment_options").value.trim() || null,
      notes: $("f_notes").value.trim() || null
    };
  }

  function openCompanyAdd() {
    openModal(
      "Add New Company",
      companyFormHtml(),
      `
        <button class="btn btn-ghost" data-close>Cancel</button>
        <button class="btn btn-primary" id="saveCompany">Save</button>
      `
    );
    $("saveCompany").addEventListener("click", async () => {
      try {
        const payload = readCompanyForm();
        const { error } = await state.supabase.from("companies").insert(payload);
        if (error) throw error;
        closeModal();
        await loadCompanies();
        await renderCompanies();
      } catch (e) {
        alert(e.message || e);
      }
    });
  }

  function openCompanyEdit(c) {
    openModal(
      `Edit: ${c.company_name}`,
      companyFormHtml(c),
      `
        <button class="btn btn-ghost" data-close>Cancel</button>
        <button class="btn btn-primary" id="saveCompany">Save Changes</button>
      `
    );
    $("saveCompany").addEventListener("click", async () => {
      try {
        const payload = readCompanyForm();
        const { error } = await state.supabase.from("companies").update(payload).eq("id", c.id);
        if (error) throw error;
        closeModal();
        await loadCompanies();
        await renderCompanies();
      } catch (e) {
        alert(e.message || e);
      }
    });
  }

  async function openCompanyView(c) {
    const services = await loadServicesForCompany(c.id);

    const body = `
      <div class="panel panel-inner" style="margin-bottom:12px;">
        <div class="panelTitleRow">
          <div class="panelTitle">Company Details</div>
          <div class="muted small">${escapeHtml(c.company_name)}</div>
        </div>
        <div class="muted" style="margin-top:8px; line-height:1.6;">
          <strong>Primary Contact:</strong> ${escapeHtml(c.primary_contact_name)}<br/>
          <strong>Email:</strong> ${escapeHtml(c.primary_contact_email)}<br/>
          ${c.primary_contact_phone ? `<strong>Phone:</strong> ${escapeHtml(c.primary_contact_phone)}<br/>` : ""}
          ${c.website ? `<strong>Website:</strong> ${escapeHtml(c.website)}<br/>` : ""}
          ${c.location ? `<strong>Location:</strong> ${escapeHtml(c.location)}<br/>` : ""}
          ${c.working_hours ? `<strong>Working Hours:</strong> ${escapeHtml(c.working_hours)}<br/>` : ""}
          ${c.payment_plan ? `<strong>Payment Plan:</strong> ${escapeHtml(c.payment_plan)}<br/>` : ""}
          ${c.payment_options ? `<strong>Payment Options:</strong> ${escapeHtml(c.payment_options)}<br/>` : ""}
          ${c.notes ? `<strong>Notes:</strong> ${escapeHtml(c.notes)}<br/>` : ""}
        </div>
      </div>

      <div class="panel panel-inner">
        <div class="panelTitleRow">
          <div class="panelTitle">Services</div>
          <button class="btn btn-primary btn-mini" id="addService">+ Add Service</button>
        </div>
        <div style="margin-top:10px;">
          ${services.length ? services.map(s => `
            <div class="txnItem" style="margin-bottom:10px;">
              <div class="txnTop">
                <div><strong>${escapeHtml(s.service_name)}</strong></div>
                <div class="txnAmt">${money(s.price)}</div>
              </div>
              <div class="txnMeta">
                ${s.duration_minutes ? `Duration: ${escapeHtml(s.duration_minutes)} minutes<br/>` : ""}
                ${s.description ? escapeHtml(s.description) : ""}
              </div>
              <div class="actions" style="margin-top:10px; justify-content:flex-start;">
                <button class="btn btn-ghost btn-mini" data-svc-edit="${s.id}">Edit</button>
                <button class="btn btn-ghost btn-mini" data-svc-del="${s.id}">Delete</button>
              </div>
            </div>
          `).join("") : `<div class="muted">No services yet.</div>`}
        </div>
      </div>
    `;

    openModal(
      `View: ${c.company_name}`,
      body,
      `
        <button class="btn btn-ghost" data-close>Close</button>
        <button class="btn btn-primary" id="editFromView">Edit Company</button>
      `
    );

    $("editFromView").addEventListener("click", () => {
      closeModal();
      openCompanyEdit(c);
    });

    $("addService").addEventListener("click", () => openServiceAdd(c.id));

    document.querySelectorAll("[data-svc-edit]").forEach(btn => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-svc-edit");
        const svc = services.find(x => x.id === id);
        if (svc) openServiceEdit(c.id, svc);
      });
    });

    document.querySelectorAll("[data-svc-del]").forEach(btn => {
      btn.addEventListener("click", async () => {
        const id = btn.getAttribute("data-svc-del");
        if (!confirm("Delete this service?")) return;
        const { error } = await state.supabase.from("company_services").delete().eq("id", id);
        if (error) return alert(error.message);
        closeModal();
        openCompanyView(c);
      });
    });
  }

  async function deleteCompany(c) {
    if (!confirm(`Delete "${c.company_name}"? This cannot be undone.`)) return;
    const { error } = await state.supabase.from("companies").delete().eq("id", c.id);
    if (error) return alert(error.message);
    await loadCompanies();
    await renderCompanies();
  }

  async function loadServicesForCompany(companyId) {
    const { data, error } = await state.supabase
      .from("company_services")
      .select("*")
      .eq("company_id", companyId)
      .order("service_name", { ascending: true });

    if (error) throw error;
    return data || [];
  }

  function serviceFormHtml(s = {}) {
    return `
      <div class="field">
        <label>Service Name *</label>
        <input id="svc_name" value="${escapeHtml(s.service_name || "")}" placeholder="e.g. Install, Support..." />
      </div>
      <div class="field">
        <label>Duration (minutes)</label>
        <input id="svc_duration" type="number" inputmode="numeric" value="${escapeHtml(s.duration_minutes || "")}" placeholder="Optional" />
      </div>
      <div class="field">
        <label>Price *</label>
        <input id="svc_price" type="number" inputmode="decimal" value="${escapeHtml(s.price || "")}" placeholder="e.g. 150" />
      </div>
      <div class="field">
        <label>Description</label>
        <textarea id="svc_desc" placeholder="Optional">${escapeHtml(s.description || "")}</textarea>
      </div>
    `;
  }

  function readServiceForm() {
    const service_name = $("svc_name").value.trim();
    const price = $("svc_price").value ? Number($("svc_price").value) : NaN;
    if (!service_name) throw new Error("Service name is required.");
    if (!Number.isFinite(price)) throw new Error("Price must be a number.");
    return {
      service_name,
      duration_minutes: $("svc_duration").value ? Number($("svc_duration").value) : null,
      price,
      description: $("svc_desc").value.trim() || null
    };
  }

  function openServiceAdd(companyId) {
    openModal(
      "Add Service",
      serviceFormHtml(),
      `
        <button class="btn btn-ghost" data-close>Cancel</button>
        <button class="btn btn-primary" id="saveSvc">Save</button>
      `
    );

    $("saveSvc").addEventListener("click", async () => {
      try {
        const payload = readServiceForm();
        payload.company_id = companyId;
        const { error } = await state.supabase.from("company_services").insert(payload);
        if (error) throw error;
        closeModal();
      } catch (e) {
        alert(e.message || e);
      }
    });
  }

  function openServiceEdit(companyId, svc) {
    openModal(
      `Edit Service: ${svc.service_name}`,
      serviceFormHtml(svc),
      `
        <button class="btn btn-ghost" data-close>Cancel</button>
        <button class="btn btn-primary" id="saveSvc">Save Changes</button>
      `
    );

    $("saveSvc").addEventListener("click", async () => {
      try {
        const payload = readServiceForm();
        const { error } = await state.supabase
          .from("company_services")
          .update(payload)
          .eq("id", svc.id)
          .eq("company_id", companyId);
        if (error) throw error;
        closeModal();
      } catch (e) {
        alert(e.message || e);
      }
    });
  }

  // ---------- Finance ----------
  async function loadTransactions() {
    const { data, error } = await state.supabase
      .from("transactions")
      .select("*")
      .order("date", { ascending: false });

    if (error) throw error;
    state.transactions = data || [];
  }

  function renderFinance() {
    // year dropdown
    const years = new Set(state.transactions.map(t => (t.date ? new Date(t.date).getFullYear() : new Date().getFullYear())));
    years.add(new Date().getFullYear());
    const yearArr = Array.from(years).sort((a,b)=>b-a);

    const yearSel = $("financeYear");
    yearSel.innerHTML = yearArr.map(y => `<option value="${y}">${y}</option>`).join("");

    // company dropdown
    const companySel = $("financeCompany");
    companySel.innerHTML = `<option value="all">All companies</option>` + state.companies.map(c =>
      `<option value="${c.id}">${escapeHtml(c.company_name)}</option>`
    ).join("");

    const apply = () => {
      const year = Number($("financeYear").value);
      const type = $("financeType").value;
      const company = $("financeCompany").value;

      const filtered = state.transactions.filter(t => {
        const y = t.date ? new Date(t.date).getFullYear() : year;
        if (y !== year) return false;
        if (type !== "all" && t.type !== type) return false;
        if (company !== "all" && String(t.company_id || "") !== company) return false;
        return true;
      });

      $("txnCount").textContent = `${filtered.length} items`;

      // totals
      let income = 0, expense = 0;
      const byMonthIncome = Array(12).fill(0);
      const byMonthExpense = Array(12).fill(0);

      filtered.forEach(t => {
        const d = t.date ? new Date(t.date) : null;
        const m = d ? d.getMonth() : 0;
        const amt = Number(t.amount || 0);
        if (t.type === "incoming") { income += amt; byMonthIncome[m] += amt; }
        if (t.type === "outgoing") { expense += amt; byMonthExpense[m] += amt; }
      });

      $("statIncome").textContent = money(income);
      $("statExpense").textContent = money(expense);
      $("statProfit").textContent = money(income - expense);
      $("financeSummary").textContent = `Year ${year}`;

      // list
      const list = $("txnList");
      list.innerHTML = filtered.map(t => {
        const compName = t.company_id ? (state.companies.find(c => c.id === t.company_id)?.company_name || "Company") : "Global Expense";
        return `
          <div class="txnItem">
            <div class="txnTop">
              <div class="txnType ${t.type}">${t.type}</div>
              <div class="txnAmt">${money(t.amount)}</div>
            </div>
            <div class="txnMeta">
              <strong>${escapeHtml(compName)}</strong> • ${escapeHtml(fmtDate(t.date))}<br/>
              ${escapeHtml(t.description || "")}
            </div>
          </div>
        `;
      }).join("") || `<div class="muted">No transactions for the selected filters.</div>`;

      // chart
      drawFinanceChart(byMonthIncome, byMonthExpense);
    };

    ["financeYear","financeType","financeCompany"].forEach(id => $(id).addEventListener("change", apply));
    apply();
  }

  function drawFinanceChart(incomeArr, expenseArr) {
    const canvas = $("financeChart");
    const ctx = canvas.getContext("2d");
    const w = canvas.width = canvas.clientWidth * devicePixelRatio;
    const h = canvas.height = 140 * devicePixelRatio;

    ctx.clearRect(0,0,w,h);

    const pad = 18 * devicePixelRatio;
    const innerW = w - pad*2;
    const innerH = h - pad*2;

    const maxV = Math.max(1, ...incomeArr, ...expenseArr);
    const xStep = innerW / 11;

    // grid
    ctx.globalAlpha = 0.35;
    ctx.strokeStyle = "rgba(255,255,255,0.12)";
    ctx.lineWidth = 1 * devicePixelRatio;
    for (let i=0;i<4;i++){
      const y = pad + (innerH/3)*i;
      ctx.beginPath(); ctx.moveTo(pad,y); ctx.lineTo(w-pad,y); ctx.stroke();
    }
    ctx.globalAlpha = 1;

    const line = (arr, stroke) => {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 2.2 * devicePixelRatio;
      ctx.beginPath();
      arr.forEach((v,i)=>{
        const x = pad + xStep*i;
        const y = pad + innerH - (v/maxV)*innerH;
        if (i===0) ctx.moveTo(x,y);
        else ctx.lineTo(x,y);
      });
      ctx.stroke();
    };

    // keep it clean: income bright blue, expense dimmer blue/white
    line(incomeArr, "rgba(59,130,246,0.95)");
    line(expenseArr, "rgba(255,255,255,0.55)");
  }

  function openTxnAdd() {
    const companyOptions = `<option value="">Global Expense</option>` + state.companies.map(c =>
      `<option value="${c.id}">${escapeHtml(c.company_name)}</option>`
    ).join("");

    openModal(
      "Add Transaction",
      `
        <div class="field">
          <label>Type *</label>
          <select id="t_type">
            <option value="incoming">Incoming</option>
            <option value="outgoing">Outgoing</option>
          </select>
        </div>
        <div class="field">
          <label>Company</label>
          <select id="t_company">${companyOptions}</select>
        </div>
        <div class="field">
          <label>Amount (GBP) *</label>
          <input id="t_amount" type="number" inputmode="decimal" placeholder="e.g. 150" />
        </div>
        <div class="field">
          <label>Date *</label>
          <input id="t_date" type="date" />
        </div>
        <div class="field">
          <label>Description</label>
          <input id="t_desc" placeholder="Optional" />
        </div>
      `,
      `
        <button class="btn btn-ghost" data-close>Cancel</button>
        <button class="btn btn-primary" id="saveTxn">Save</button>
      `
    );

    $("saveTxn").addEventListener("click", async () => {
      try {
        const type = $("t_type").value;
        const amount = Number($("t_amount").value);
        const date = $("t_date").value;
        const description = $("t_desc").value.trim() || null;
        const company_id = $("t_company").value || null;

        if (!Number.isFinite(amount) || amount <= 0) throw new Error("Amount must be a positive number.");
        if (!date) throw new Error("Date is required.");

        const { error } = await state.supabase.from("transactions").insert({
          type, amount, date, description, company_id
        });
        if (error) throw error;

        closeModal();
        await loadTransactions();
        renderFinance();
      } catch (e) {
        alert(e.message || e);
      }
    });
  }

  function exportCsv() {
    const rows = state.transactions.map(t => ({
      id: t.id,
      company_id: t.company_id || "",
      type: t.type,
      amount: t.amount,
      date: t.date,
      description: t.description || ""
    }));

    const header = Object.keys(rows[0] || { id:"", company_id:"", type:"", amount:"", date:"", description:"" });
    const csv = [
      header.join(","),
      ...rows.map(r => header.map(k => `"${String(r[k] ?? "").replaceAll('"','""')}"`).join(","))
    ].join("\n");

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `smartcore-transactions.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ---------- Vault (PIN verify server-side) ----------
  function vaultIsUnlocked() {
    return Date.now() < state.vaultUnlockedUntil;
  }

  async function loadVaultList() {
    $("vaultStatus").textContent = vaultIsUnlocked() ? "Unlocked" : "Locked";
    $("btnVaultAdd").disabled = !vaultIsUnlocked();

    // We still show list, but you can keep it empty until you want to enforce unlock for viewing.
    // Vault items are already admin-only via RLS.
    const { data, error } = await state.supabase
      .from("vault_items")
      .select("id, service_name, url, username_email, notes, tags, updated_at")
      .order("service_name", { ascending: true });

    if (error) {
      $("vaultList").innerHTML = `<div class="muted">Vault not available: ${escapeHtml(error.message)}</div>`;
      return;
    }

    $("vaultList").innerHTML = (data || []).map(v => `
      <div class="txnItem">
        <div class="txnTop">
          <div><strong>${escapeHtml(v.service_name)}</strong></div>
          <div class="muted small">${escapeHtml(fmtDate(v.updated_at))}</div>
        </div>
        <div class="txnMeta">
          ${v.url ? `URL: ${escapeHtml(v.url)}<br/>` : ""}
          ${v.username_email ? `User: ${escapeHtml(v.username_email)}<br/>` : ""}
          ${v.notes ? escapeHtml(v.notes) : ""}
        </div>
      </div>
    `).join("") || `<div class="muted">No vault items yet.</div>`;
  }

  function openVaultPin() {
    openModal(
      "Enter Vault PIN",
      `
        <div class="field">
          <label>PIN</label>
          <input id="pinInput" type="password" inputmode="numeric" placeholder="••••" />
          <div class="hint" id="pinHint"></div>
        </div>
      `,
      `
        <button class="btn btn-ghost" data-close>Cancel</button>
        <button class="btn btn-primary" id="pinSubmit">Unlock</button>
      `
    );

    $("pinSubmit").addEventListener("click", async () => {
      try {
        const pin = $("pinInput").value.trim();
        if (!pin) throw new Error("Enter your PIN.");

        $("pinHint").textContent = "Verifying…";

        const accessToken = state.session?.access_token;
        const res = await fetch("/vault-verify", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${accessToken}`
          },
          body: JSON.stringify({ pin })
        });

        const out = await res.json().catch(() => ({}));
        if (!res.ok || !out.ok) {
          throw new Error(out.message || "PIN verification failed.");
        }

        // unlock for 20 minutes (client side gating)
        state.vaultUnlockedUntil = Date.now() + (20 * 60 * 1000);

        closeModal();
        await loadVaultList();
      } catch (e) {
        $("pinHint").textContent = e.message || String(e);
      }
    });
  }

  // ---------- Wiring ----------
  function wireUi() {
    bindNav();

    $("loginForm").addEventListener("submit", (e) => {
      e.preventDefault();
      signIn($("loginEmail").value.trim(), $("loginPassword").value);
    });

    $("companySearch").addEventListener("input", renderCompanies);
    $("btnAddCompany").addEventListener("click", openCompanyAdd);

    $("btnAddTxn").addEventListener("click", openTxnAdd);
    $("btnExportCsv").addEventListener("click", exportCsv);

    $("btnVaultUnlock").addEventListener("click", openVaultPin);
  }

  // ---------- Boot ----------
  async function boot() {
    await initSupabase();
    wireUi();

    await getSession();

    if (!state.session) {
      setTopbar();
      showView("login");
      return;
    }

    await loadMe();
    setTopbar();

    if (!state.me) {
      showView("login");
      return;
    }

    // keep session changes in sync
    state.supabase.auth.onAuthStateChange(async (_event, session) => {
      state.session = session;
      if (!session) {
        state.me = null;
        setTopbar();
        showView("login");
        return;
      }
      await loadMe();
      setTopbar();
    });

    goto("dashboard");
  }

  boot().catch(err => {
    console.error(err);
    alert("App failed to start: " + (err.message || err));
    showView("login");
  });

})();
