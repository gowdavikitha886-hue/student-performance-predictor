/* ============================================================
   SPPS FRONTEND CONTROLLER
   auth · navigation · dashboard · data · training · predict ·
   history · models · admin · reports
   ============================================================ */
"use strict";

const $ = id => document.getElementById(id);
const qa = sel => [...document.querySelectorAll(sel)];
const STATE = { user: null, data: null, trained: null, history: [], models: [], activeModel: null, lastResult: null, mode: "login" };
const charts = {};
const draw = (id, cfg) => {
  if (!$(id)) return;
  if (charts[id]) charts[id].destroy();
  cfg.options = Object.assign({
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { labels: { boxWidth: 14, font: { size: 12 } } } }
  }, cfg.options || {});
  charts[id] = new Chart($(id), cfg);
};
Chart.defaults.font.family = '"Segoe UI", system-ui, sans-serif';
Chart.defaults.color = "#475569";

/* ================= THEME (dark mode) ================= */
function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  const b = $("themeBtn");
  if (b) b.innerHTML = t === "dark" ? '<i class="bi bi-sun-fill"></i>' : '<i class="bi bi-moon-stars"></i>';
}
applyTheme(localStorage.getItem("spps_theme") || "light");
$("themeBtn").onclick = () => {
  const t = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  localStorage.setItem("spps_theme", t);
  applyTheme(t);
  toast(t === "dark" ? "Dark mode on" : "Light mode on");
};

/* ================= ACCOUNT SETTINGS ================= */
const acctModal = () => bootstrap.Modal.getOrCreateInstance($("accountModal"));
document.getElementById("accountModal").addEventListener("show.bs.modal", loadAccount);

async function loadAccount() {
  if (!STATE.user) return;
  $("accName").value = STATE.user.name;
  $("accEmail").textContent = STATE.user.email;
  $("accRole").textContent = STATE.user.role;
  try {
    const r = await api("GET", "/api/account/sessions");
    $("accSessions").innerHTML = r.sessions.map(s => `<tr>
      <td class="mono">${esc(s.id)}…</td>
      <td class="small-13">${new Date(s.createdAt).toLocaleString()}</td>
      <td class="small-13">${new Date(s.expiresAt).toLocaleString()}</td>
      <td>${s.current ? '<span class="chip green">this device</span>' : '<span class="chip gray">active</span>'}</td>
    </tr>`).join("");
  } catch (ex) { toast(ex.message, "err"); }
}

$("accNameSave").onclick = async () => {
  try {
    const r = await api("PUT", "/api/account", { name: $("accName").value.trim() });
    STATE.user.name = r.user.name;
    $("userName").textContent = r.user.name;
    $("avatarInitials").textContent = r.user.name.split(/\s+/).map(w => w[0]).slice(0, 2).join("").toUpperCase();
    toast("Profile updated", "ok");
  } catch (ex) { toast(ex.message, "err"); }
};

$("accPwSave").onclick = async () => {
  try {
    const r = await api("POST", "/api/account/password", { currentPassword: $("accCurPw").value, newPassword: $("accNewPw").value });
    toast(r.message, "ok");
    $("accCurPw").value = ""; $("accNewPw").value = "";
    loadAccount();
  } catch (ex) { toast(ex.message, "err"); }
};

$("accLogoutOthers").onclick = async () => {
  try { const r = await api("DELETE", "/api/account/sessions"); toast(r.message, "ok"); loadAccount(); }
  catch (ex) { toast(ex.message, "err"); }
};

$("accDelete").onclick = async () => {
  const pw = $("accDelPw").value;
  if (!pw) return toast("Enter your password to confirm.", "err");
  if (!confirm("This permanently deletes your account, models and history. Continue?")) return;
  try {
    const r = await api("DELETE", "/api/account", { password: pw });
    toast(r.message, "ok");
    acctModal().hide();
    showAuth();
  } catch (ex) { toast(ex.message, "err"); }
};

/* ================= UI HELPERS ================= */
function toast(msg, kind = "") {
  const el = document.createElement("div");
  el.className = "toast-app " + kind;
  el.innerHTML = `<i class="bi bi-${kind === "err" ? "x-circle" : kind === "ok" ? "check-circle" : "info-circle"}"></i><span>${msg}</span>`;
  $("toasts").appendChild(el);
  setTimeout(() => { el.style.opacity = "0"; el.style.transition = ".4s"; setTimeout(() => el.remove(), 400); }, 3600);
}
function loader(show, title = "Working…", msg = "Please wait", pct = 35) {
  $("loadTitle").textContent = title;
  $("loadMsg").textContent = msg;
  $("loadBar").style.width = pct + "%";
  $("overlay").classList.toggle("show", !!show);
}
const progress = (msg, pct) => { $("loadMsg").textContent = msg; if (pct) $("loadBar").style.width = pct + "%"; };
const pct = v => (v == null ? "—" : (v * 100).toFixed(1) + "%");
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/* ================= API CLIENT ================= */
async function api(method, path, body) {
  const opt = { method, headers: {} };
  if (body !== undefined) { opt.headers["Content-Type"] = "application/json"; opt.body = JSON.stringify(body); }
  const r = await fetch(path, opt);
  let data = {};
  try { data = await r.json(); } catch { /* empty */ }
  if (r.status === 401 && STATE.user) { showAuth(); throw new Error("Session expired — please sign in again."); }
  if (!r.ok) throw new Error(data.error || `Request failed (${r.status})`);
  return data;
}

/* ================= AUTH ================= */
function showAuth() {
  STATE.user = null;
  $("appScreen").style.display = "none";
  $("authScreen").style.display = "grid";
}
function showApp(user) {
  STATE.user = user;
  $("authScreen").style.display = "none";
  $("appScreen").style.display = "block";
  $("userName").textContent = user.name;
  $("userEmail").textContent = user.email;
  $("menuEmail").textContent = user.email;
  $("roleBadge").textContent = user.role;
  $("avatarInitials").textContent = user.name.split(/\s+/).map(w => w[0]).slice(0, 2).join("").toUpperCase();
  qa(".admin-only").forEach(el => el.classList.toggle("d-none", user.role !== "admin"));
  go("dashboard");
  refreshAll();
}
function setMode(mode) {
  STATE.mode = mode;
  const reg = mode === "register";
  $("authTitle").textContent = reg ? "Create your account" : "Welcome back";
  $("authSub").textContent = reg ? "Save models, predictions and history on the server." : "Sign in to train models and save your predictions.";
  $("nameField").classList.toggle("d-none", !reg);
  $("authSubmit").textContent = reg ? "Create account" : "Sign in";
  $("authSwitchText").textContent = reg ? "Already have an account?" : "New to SPPS?";
  $("authSwitchLink").textContent = reg ? "Sign in" : "Create an account";
  $("authError").classList.add("d-none");
}
$("authSwitchLink").onclick = () => setMode(STATE.mode === "login" ? "register" : "login");
$("authForm").onsubmit = async e => {
  e.preventDefault();
  const err = $("authError");
  err.classList.add("d-none");
  const email = $("authEmail").value.trim(), password = $("authPassword").value;
  if (!email || !password) { err.textContent = "Email and password are required."; return err.classList.remove("d-none"); }
  if (STATE.mode === "register" && $("authName").value.trim().length < 2) { err.textContent = "Please enter your full name."; return err.classList.remove("d-none"); }
  $("authSubmit").disabled = true;
  try {
    const path = STATE.mode === "register" ? "/api/auth/register" : "/api/auth/login";
    const body = STATE.mode === "register"
      ? { name: $("authName").value.trim(), email, password }
      : { email, password };
    const res = await api("POST", path, body);
    $("authForm").reset();
    toast(res.message || "Signed in", "ok");
    showApp(res.user);
  } catch (ex) {
    err.textContent = ex.message; err.classList.remove("d-none");
  }
  $("authSubmit").disabled = false;
};
$("logoutBtn").onclick = async () => {
  try { await api("POST", "/api/auth/logout"); } catch { }
  toast("Logged out successfully", "ok");
  showAuth();
};
$("goDashboard").onclick = () => go("dashboard");

/* ================= NAVIGATION ================= */
function go(page) {
  qa(".page").forEach(p => p.classList.toggle("active", p.id === "page-" + page));
  qa(".sidebar .nav-link").forEach(b => b.classList.toggle("active", b.dataset.page === page));
  window.scrollTo({ top: 0, behavior: "smooth" });
  if (page === "dashboard") loadDashboard();
  if (page === "history") loadHistory();
  if (page === "models") loadModels();
  if (page === "admin") loadAdmin();
  if (page === "predict") refreshPredictUI();
}
qa(".sidebar .nav-link").forEach(b => b.onclick = () => go(b.dataset.page));
document.addEventListener("click", e => {
  const t = e.target.closest("[data-goto]");
  if (t) { e.preventDefault(); go(t.dataset.goto); }
});

async function refreshAll() {
  await Promise.allSettled([loadDashboard(), loadModels(), loadHistory()]);
}

/* ================= DASHBOARD ================= */
async function loadDashboard() {
  try {
    const d = await api("GET", "/api/dashboard");
    $("statPred").textContent = d.totals.predictions;
    $("statModels").textContent = d.totals.models;
    $("statConf").textContent = (d.totals.avgConfidence || 0) + "%";
    $("statAcc").textContent = d.bestModel && d.bestModel.metrics && d.bestModel.metrics.testAccuracy
      ? (d.bestModel.metrics.testAccuracy * 100).toFixed(1) + "%" : "—";

    const days = d.daily, map = Object.fromEntries(days.map(x => [x.d, x.c]));
    const labels = [], vals = [];
    for (let i = 13; i >= 0; i--) {
      const dt = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
      labels.push(dt.slice(5)); vals.push(map[dt] || 0);
    }
    draw("chartDaily", {
      type: "line",
      data: { labels, datasets: [{ label: "Predictions", data: vals, borderColor: "#4f46e5", backgroundColor: "rgba(79,70,229,.12)", fill: true, tension: .35, pointRadius: 3 }] },
      options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } }
    });

    const dist = d.distribution;
    draw("chartDist", {
      type: "doughnut",
      data: { labels: dist.length ? dist.map(x => x.prediction) : ["No data"], datasets: [{ data: dist.length ? dist.map(x => x.c) : [1], backgroundColor: ["#4f46e5", "#7c3aed", "#16a34a", "#f59e0b", "#ef4444", "#06b6d4"] }] },
      options: { cutout: "62%", plugins: { legend: { position: "bottom" } } }
    });

    $("recentBody").innerHTML = d.recent.length
      ? d.recent.map(r => `<tr><td>${r.id}</td><td>${badgeFor(r.prediction)}</td><td>${r.confidence}%</td><td class="muted small-13">${new Date(r.created_at).toLocaleString()}</td></tr>`).join("")
      : `<tr><td colspan="4" class="text-center muted py-4">No predictions yet</td></tr>`;

    $("bestModelBox").innerHTML = d.bestModel
      ? `<div class="d-flex justify-content-between align-items-start mb-2">
           <div><h5 class="mb-0">${esc(d.bestModel.name)}</h5>
           <div class="muted small-13">${esc(d.bestModel.algorithm)} · target <b>${esc(d.bestModel.target)}</b></div></div>
           <span class="chip green">saved</span></div>
         <div class="row g-2 text-center">
           <div class="col-4"><div class="metric"><div class="v" style="font-size:19px">${pct(d.bestModel.metrics?.testAccuracy)}</div><div class="k">Accuracy</div></div></div>
           <div class="col-4"><div class="metric"><div class="v" style="font-size:19px">${pct(d.bestModel.metrics?.macroF1)}</div><div class="k">Macro F1</div></div></div>
           <div class="col-4"><div class="metric"><div class="v" style="font-size:19px">${pct(d.bestModel.metrics?.rocAuc)}</div><div class="k">ROC-AUC</div></div></div>
         </div>
         <button class="btn btn-sm btn-outline-primary w-100 mt-3" data-goto="predict">Use this model</button>`
      : `<div class="empty"><i class="bi bi-box-seam"></i>No model saved yet.<br><button class="btn btn-sm btn-brand mt-2" data-goto="data">Train one now</button></div>`;
  } catch (ex) { /* silent on dashboard */ }
}
const badgeFor = p => {
  const k = String(p).toLowerCase();
  const cls = k.includes("high") || k.includes("good") || k.includes("pass") ? "green"
    : k.includes("low") || k.includes("fail") || k.includes("risk") ? "red" : "amber";
  return `<span class="chip ${cls}">${esc(p)}</span>`;
};

/* ================= DATASET ================= */
async function loadDatasetFrom(d, label) {
  if (d.rows.length < 30 || d.cols.length < 2) return toast("Need at least 30 rows and 2 columns.", "err");
  STATE.data = d;
  $("dataEmpty").classList.add("d-none");
  $("dataBox").classList.remove("d-none");
  $("noData").classList.add("d-none");
  $("trainArea").classList.remove("d-none");

  $("target").innerHTML = d.cols.map((c, i) => `<option ${i === d.cols.length - 1 ? "selected" : ""}>${esc(c)}</option>`).join("");

  const missing = d.rows.reduce((a, r) => a + d.cols.filter(c => r[c] === "" || r[c] == null).length, 0);
  $("dsInfo").innerHTML = [
    `<span class="chip blue"><i class="bi bi-table"></i> ${d.rows.length} rows</span>`,
    `<span class="chip blue"><i class="bi bi-columns-gap"></i> ${d.cols.length} columns</span>`,
    `<span class="chip ${missing ? "amber" : "green"}"><i class="bi bi-exclamation-triangle"></i> ${missing} missing values</span>`,
    `<span class="chip gray"><i class="bi bi-file-earmark-text"></i> ${esc(label)}</span>`
  ].join("");

  $("dsPreview").innerHTML = `<table class="table table-sm table-striped mb-0"><thead><tr>${d.cols.map(c => `<th>${esc(c)}</th>`).join("")}</tr></thead>
    <tbody>${d.rows.slice(0, 6).map(r => `<tr>${d.cols.map(c => `<td>${esc(r[c])}</td>`).join("")}</tr>`).join("")}</tbody></table>`;

  renderPrepAndProfile();
  toast(`${label} loaded — ${d.rows.length} rows`, "ok");
}

function renderPrepAndProfile() {
  const d = STATE.data, target = $("target").value;
  const pre = fitPre(d.rows, d.cols, target);

  $("prepBody").innerHTML = pre.report.map(r => `<tr>
    <td class="fw-semibold">${esc(r.column)}</td>
    <td>${r.detected === "Numeric" ? '<span class="chip blue">Numeric</span>' : r.detected === "Categorical" ? '<span class="chip amber">Categorical</span>' : '<span class="chip gray">Skipped</span>'}</td>
    <td>${r.missing ? `<span class="chip red">${r.missing}</span>` : '<span class="chip green">0</span>'}</td>
    <td>${esc(r.action)}<div class="small-13 muted">${esc(r.detail)}</div></td></tr>`).join("");

  const num = pre.report.filter(r => r.detected === "Numeric").length;
  const cat = pre.report.filter(r => r.detected === "Categorical").length;
  const skip = pre.report.filter(r => r.detected === "Skipped").length;
  const miss = pre.report.reduce((a, r) => a + r.missing, 0);
  $("prepNote").innerHTML = `<b>${num}</b> numeric standardized (z-score) · <b>${cat}</b> one-hot encoded · <b>${skip}</b> dropped · ` +
    `<b>${miss}</b> missing cells imputed with median/mode. <span class="muted">Statistics are re-fitted on the training fold only (no data leakage).</span>`;

  const p = profile(d, target);
  $("profileBody").innerHTML = p.cols.map(c => `<tr>
    <td class="fw-semibold">${esc(c.name)}${c.name === target ? ' <span class="chip blue">target</span>' : ""}</td>
    <td>${c.unique}</td>
    <td>${c.missing ? `<span class="chip red">${c.missing}</span>` : "0"}</td>
    <td class="small-13">${c.numeric ? `μ ${c.mean.toFixed(2)} · σ ${c.std.toFixed(2)} · med ${c.median}` : esc(c.top || "-")}</td></tr>`).join("");

  // target distribution
  draw("chartTarget", {
    type: "bar",
    data: { labels: Object.keys(p.classes), datasets: [{ label: "Rows per class", data: Object.values(p.classes), backgroundColor: ["#4f46e5", "#7c3aed", "#16a34a", "#f59e0b", "#ef4444"] }] },
    options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } }
  });

  // numeric histograms
  const nums = p.cols.filter(c => c.numeric && c.name !== target);
  $("histSel").innerHTML = nums.map(c => `<option>${esc(c.name)}</option>`).join("");
  const drawHist = () => {
    const col = $("histSel").value; if (!col) return;
    const vals = d.rows.map(r => Number(r[col])).filter(v => !isNaN(v));
    const min = Math.min(...vals), max = Math.max(...vals), B = 14, w = (max - min) / B || 1;
    const bins = new Array(B).fill(0);
    vals.forEach(v => bins[Math.min(B - 1, Math.floor((v - min) / w))]++);
    draw("chartHist", {
      type: "bar",
      data: {
        labels: bins.map((_, i) => (min + i * w).toFixed(1)),
        datasets: [{ label: col, data: bins, backgroundColor: "#7c3aed" }]
      },
      options: { plugins: { legend: { display: false } }, scales: { x: { ticks: { maxRotation: 60, autoSkip: true, maxTicksLimit: 10 } }, y: { beginAtZero: true } } }
    });
  };
  $("histSel").onchange = drawHist;
  drawHist();

  draw("chartSep", {
    type: "bar",
    data: { labels: p.separation.map(s => s[0]), datasets: [{ label: "η²", data: p.separation.map(s => s[1]), backgroundColor: "#0891b2" }] },
    options: { indexAxis: "y", plugins: { legend: { display: false } }, scales: { x: { beginAtZero: true, max: 1 } } }
  });
}

$("file").onchange = async e => {
  const f = e.target.files[0]; if (!f) return;
  try { loadDatasetFrom(parseCSV(await f.text()), f.name); }
  catch { toast("Could not parse that CSV file.", "err"); }
};
$("sampleBtn").onclick = () => loadDatasetFrom(makeSample(800), "sample_dataset.csv (synthetic, 800 rows)");
$("sampleDl").onclick = () => {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([toCSV(makeSample(800))], { type: "text/csv" }));
  a.download = "sample_dataset.csv"; a.click();
};
$("target").onchange = () => { if (STATE.data) renderPrepAndProfile(); };

/* ================= TRAINING ================= */
$("trainBtn").onclick = async () => {
  if (!STATE.data) return toast("Load a dataset first.", "err");
  const btn = $("trainBtn"); btn.disabled = true;
  loader(true, "Training models…", "Preparing…", 8);
  try {
    const res = await trainPipeline(STATE.data, $("target").value, msg => progress(msg));
    STATE.trained = res;
    renderTrain(res);
    loader(false);
    await saveModelToServer(res);
    toast(`${res.best} trained — test accuracy ${pct(res.testMetrics.accuracy)}`, "ok");
  } catch (ex) {
    loader(false);
    toast(ex.message, "err");
    $("trainResult") && ($("trainResult").classList.add("d-none"));
  }
  btn.disabled = false;
};

function renderTrain(r) {
  $("splitTr").textContent = r.split.train;
  $("splitVa").textContent = r.split.val;
  $("splitTe").textContent = r.split.test;
  $("trainResult").classList.remove("d-none");

  $("cvBody").innerHTML = r.results.map((x, i) => `<tr class="${i === 0 ? "table-success" : ""}">
    <td class="fw-semibold">${esc(x.name)} ${i === 0 ? '<span class="chip green">best</span>' : ""}</td>
    <td>${pct(x.cvAcc)} <span class="muted small-13">±${(x.cvAccStd * 100).toFixed(1)}</span></td>
    <td>${pct(x.cvF1)} <span class="muted small-13">±${(x.cvF1Std * 100).toFixed(1)}</span></td>
    <td>${pct(x.valAcc)}</td></tr>`).join("");

  const t = r.testMetrics;
  $("bestName").textContent = r.best;
  $("bestMeta").innerHTML = `target <b>${esc(r.target)}</b> · ${r.nRows} rows · ${r.classes.length} classes · trained in ${r.trainMs} ms<br>
    <span class="muted">Test set evaluated once (${r.split.test} rows) — no peeking during selection.</span>`;
  $("mAuc").textContent = pct(r.roc.macro);
  $("mAcc").textContent = pct(t.accuracy);
  $("mPre").textContent = pct(t.macro.precision);
  $("mRec").textContent = pct(t.macro.recall);
  $("mF1").textContent = pct(t.macro.f1);

  $("perClassBody").innerHTML = t.perClass.map(c => `<tr>
    <td>${badgeFor(c.label)}</td><td>${pct(c.precision)}</td><td>${pct(c.recall)}</td>
    <td>${pct(c.f1)}</td><td>${c.support}</td></tr>`).join("");

  $("cmBox").innerHTML = `<div class="tbl-wrap"><table class="table table-bordered table-sm text-center mb-0">
    <tr><th class="text-start">Actual ↓ / Pred →</th>${r.classes.map(c => `<th>${esc(c)}</th>`).join("")}</tr>
    ${t.confusion.map((row, i) => `<tr><th class="text-start">${esc(r.classes[i])}</th>${row.map((v, j) =>
      `<td class="${i === j ? "table-success" : v > 0 ? "table-danger-subtle" : ""} fw-semibold">${v}</td>`).join("")}</tr>`).join("")}</table></div>`;

  const palette = ["#4f46e5", "#7c3aed", "#16a34a", "#f59e0b", "#ef4444", "#06b6d4", "#db2777"];
  draw("rocChart", {
    type: "line",
    data: {
      labels: Array.from({ length: 21 }, (_, i) => (i / 20).toFixed(2)),
      datasets: [
        ...r.roc.perClass.map((c, i) => ({
          label: `${c.label} (AUC ${c.auc.toFixed(3)})`,
          data: resample(c.fpr, c.tpr, 21), borderColor: palette[i % palette.length], tension: .2, pointRadius: 0, borderWidth: 2
        })),
        { label: `micro (AUC ${r.roc.micro.toFixed(3)})`, data: resample(r.roc.microCurve.fpr, r.roc.microCurve.tpr, 21), borderColor: "#0f172a", borderDash: [6, 4], pointRadius: 0, borderWidth: 2 }
      ]
    },
    options: {
      scales: { x: { title: { display: true, text: "False positive rate" }, min: 0, max: 1 }, y: { title: { display: true, text: "True positive rate" }, min: 0, max: 1 } },
      plugins: { legend: { position: "bottom" } }
    }
  });

  draw("cmpChart", {
    type: "bar",
    data: {
      labels: r.results.map(x => x.name),
      datasets: [
        { label: "CV Accuracy %", data: r.results.map(x => x.cvAcc * 100), backgroundColor: "#4f46e5" },
        { label: "CV Macro-F1 %", data: r.results.map(x => x.cvF1 * 100), backgroundColor: "#7c3aed" },
        { label: "Validation Accuracy %", data: r.results.map(x => x.valAcc * 100), backgroundColor: "#16a34a" }
      ]
    },
    options: { scales: { y: { beginAtZero: true, max: 100 } }, plugins: { legend: { position: "bottom" } } }
  });

  draw("impChart", {
    type: "bar",
    data: { labels: r.importance.map(i => i.name), datasets: [{ label: "Macro-F1 drop", data: r.importance.map(i => i.drop), backgroundColor: "#f59e0b" }] },
    options: { indexAxis: "y", plugins: { legend: { display: false } }, scales: { x: { beginAtZero: true } } }
  });

  $("savedBadge").innerHTML = `<i class="bi bi-hourglass-split"></i> saving to server…`;
}

function resample(fpr, tpr, n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const x = i / (n - 1);
    let j = 0;
    while (j < fpr.length - 1 && fpr[j + 1] < x) j++;
    const x0 = fpr[j], x1 = fpr[j + 1] ?? 1;
    const y0 = tpr[j], y1 = tpr[j + 1] ?? 1;
    out.push(x1 === x0 ? y0 : +(y0 + ((x - x0) / (x1 - x0)) * (y1 - y0)).toFixed(4));
  }
  return out;
}

async function saveModelToServer(r) {
  const metrics = {
    testAccuracy: r.testMetrics.accuracy, macroF1: r.testMetrics.macro.f1,
    macroPrecision: r.testMetrics.macro.precision, macroRecall: r.testMetrics.macro.recall,
    weightedF1: r.testMetrics.weighted.f1, rocAuc: r.roc.macro, rocAucMicro: r.roc.micro,
    cvF1: r.results[0].cvF1, cvF1Std: r.results[0].cvF1Std, trainMs: r.trainMs
  };
  const res = await api("POST", "/api/models", {
    name: `${r.best} · ${r.target} · ${new Date().toLocaleDateString()}`,
    target: r.target, algorithm: r.best, metrics, nRows: r.nRows,
    pre: r.pre, classes: r.classes, model: r.model
  });
  $("savedBadge").className = "chip green";
  $("savedBadge").innerHTML = `<i class="bi bi-cloud-check"></i> saved on server as model #${res.id}`;
  await loadModels(res.id);
  loadDashboard();
  return res.id;
}

/* ================= PREDICT ================= */
async function loadModels(preferId) {
  try {
    const r = await api("GET", "/api/models");
    STATE.models = r.models;
    const sel = $("modelSel");
    sel.innerHTML = r.models.map(m => `<option value="${m.id}">#${m.id} · ${esc(m.name)}</option>`).join("") || `<option value="">— no models —</option>`;
    if (preferId) sel.value = String(preferId);
    renderModelsGrid(r.models);
    renderLeaderboard(r.models);
    refreshPredictUI();
  } catch { /* ignore */ }
}

function renderLeaderboard(models) {
  const withMetrics = models.filter(m => m.metrics && m.metrics.testAccuracy != null);
  $("leaderCard").style.display = withMetrics.length >= 2 ? "block" : "none";
  if (withMetrics.length < 2) return;
  draw("leaderChart", {
    type: "bar",
    data: {
      labels: withMetrics.map(m => `#${m.id} ${m.algorithm}`),
      datasets: [
        { label: "Test Accuracy %", data: withMetrics.map(m => (m.metrics.testAccuracy * 100).toFixed(1)), backgroundColor: "#4f46e5" },
        { label: "Macro F1 %", data: withMetrics.map(m => ((m.metrics.macroF1 || 0) * 100).toFixed(1)), backgroundColor: "#7c3aed" },
        { label: "ROC-AUC %", data: withMetrics.map(m => ((m.metrics.rocAuc || 0) * 100).toFixed(1)), backgroundColor: "#16a34a" }
      ]
    },
    options: { scales: { y: { beginAtZero: true, max: 100 } }, plugins: { legend: { position: "bottom" } } }
  });
}

async function refreshPredictUI() {
  const id = $("modelSel").value;
  if (!id) { $("noModel").classList.remove("d-none"); $("predictArea").classList.add("d-none"); return; }
  try {
    if (!STATE.activeModel || String(STATE.activeModel.id) !== String(id)) {
      const r = await api("GET", "/api/models/" + id);
      STATE.activeModel = r.model;
    }
    const m = STATE.activeModel;
    $("noModel").classList.add("d-none");
    $("predictArea").classList.remove("d-none");
    const pre = m.preprocessing;
    $("formFields").innerHTML = pre.features.map(f => f.type === "number"
      ? `<div class="col-sm-6"><label class="form-label">${esc(f.name)} <span class="muted small-13">(${f.min}–${f.max})</span></label>
         <input class="form-control" type="number" step="any" min="${f.min}" max="${f.max}" name="${esc(f.name)}" value="${(+f.mean.toFixed(2))}" required></div>`
      : `<div class="col-sm-6"><label class="form-label">${esc(f.name)}</label>
         <select class="form-select" name="${esc(f.name)}">${f.cats.map(o => `<option>${esc(o)}</option>`).join("")}</select></div>`).join("");
  } catch (ex) { toast(ex.message, "err"); }
}
$("modelSel").onchange = () => { STATE.activeModel = null; refreshPredictUI(); };

$("predictForm").onsubmit = async e => {
  e.preventDefault();
  const btn = $("predictBtn"); btn.disabled = true;
  try {
    const input = Object.fromEntries(new FormData(e.target));
    const r = await api("POST", "/api/predict", { modelId: Number($("modelSel").value), input });
    STATE.lastResult = r;
    renderResult(r);
    loadHistory(); loadDashboard();
    toast(`Predicted: ${r.prediction} (${r.confidence}%)`, "ok");
  } catch (ex) { toast(ex.message, "err"); }
  btn.disabled = false;
};

function renderResult(r) {
  $("resBox").style.display = "block";
  $("resTarget").textContent = `Predicted ${r.target}`;
  $("resPred").textContent = r.prediction;
  $("resModelName").textContent = `${r.model.algorithm} · #${r.model.id}`;
  $("resConf").style.width = r.confidence + "%";
  $("resConf").textContent = r.confidence + "%";

  const palette = ["#4f46e5", "#7c3aed", "#16a34a", "#f59e0b", "#ef4444", "#06b6d4"];
  draw("probChart", {
    type: "doughnut",
    data: { labels: Object.keys(r.probabilities), datasets: [{ data: Object.values(r.probabilities), backgroundColor: palette }] },
    options: { cutout: "58%", plugins: { legend: { position: "bottom" } } }
  });

  const top = r.explanation.top, max = Math.max(0.01, ...top.map(t => Math.abs(t.contribution)));
  $("explainBox").innerHTML = `<div class="small-13 muted mb-2">Effect of each factor on the probability of <b>${esc(r.prediction)}</b> (vs. an average student):</div>` +
    top.map(t => {
      const w = Math.min(50, (Math.abs(t.contribution) / max) * 50);
      const up = t.contribution >= 0;
      return `<div class="reason">
        <div style="min-width:118px"><b>${esc(t.feature)}</b><div class="small-13 muted">${esc(t.value)}</div></div>
        <div class="bar">${up ? `<i class="up" style="left:50%;width:${w}%"></i>` : `<i class="down" style="right:50%;width:${w}%"></i>`}</div>
        <div class="val ${up ? "text-success" : "text-danger"}">${up ? "+" : ""}${t.contribution.toFixed(2)}%</div>
      </div>`;
    }).join("");

  const iconMap = { book: "book", "calendar-check": "calendar-check", "graph-up": "graph-up", "clipboard-check": "clipboard-check", moon: "moon-stars", phone: "phone", people: "people", trophy: "trophy", "exclamation-triangle": "exclamation-triangle", "arrow-up-right": "arrow-up-right", star: "star" };
  $("recBox").innerHTML = r.recommendations.map(t =>
    `<div class="rec ${t.priority}"><div class="ric"><i class="bi bi-${iconMap[t.icon] || "lightbulb"}"></i></div>
     <div><b>${esc(t.title)}</b><p>${esc(t.text)}</p></div></div>`).join("");
};

/* ================= BATCH PREDICTION ================= */
const BATCH = { rows: [], headers: [], results: [] };

$("batchFile").onchange = async e => {
  const f = e.target.files[0]; if (!f) return;
  try {
    const d = parseCSV(await f.text());
    if (!d.rows.length || !d.cols.length) throw new Error("empty");
    BATCH.rows = d.rows; BATCH.headers = d.cols; BATCH.results = [];
    const pre = STATE.activeModel && STATE.activeModel.preprocessing;
    const need = pre ? pre.features.map(x => x.name) : [];
    const missing = need.filter(n => !d.cols.includes(n));
    $("batchInfo").innerHTML = `<b>${d.rows.length}</b> rows · ${d.cols.length} columns — ` +
      (missing.length
        ? `<span class="chip red">missing: ${missing.join(", ")}</span> (values will fall back to training medians/modes)`
        : `<span class="chip green">all ${need.length} feature columns present</span>`);
    $("batchRun").disabled = false;
    $("batchResults").style.display = "none";
    $("batchDownload").style.display = "none";
  } catch { toast("Could not parse that CSV file.", "err"); }
};

$("batchRun").onclick = async () => {
  const modelId = Number($("modelSel").value);
  if (!modelId) return toast("Select a model first.", "err");
  if (!BATCH.rows.length) return toast("Choose a CSV file first.", "err");
  const btn = $("batchRun"); btn.disabled = true;
  loader(true, "Running batch prediction…", `${Math.min(500, BATCH.rows.length)} rows via POST /api/predict/batch`, 45);
  try {
    const r = await api("POST", "/api/predict/batch", { modelId, rows: BATCH.rows.slice(0, 500), save: $("batchSave").checked });
    BATCH.results = r.results;
    $("batchInfo").innerHTML = `<b>${r.count}</b> predictions from <b>${esc(r.model.name)}</b>` +
      (r.saved ? ` · <span class="chip green">${r.saved} saved to history</span>` : "") +
      (BATCH.rows.length > 500 ? ` · <span class="chip amber">first 500 of ${BATCH.rows.length} rows</span>` : "");
    $("batchResults").style.display = "block";
    $("batchResults").innerHTML = `<table class="table table-sm table-hover mb-0">
      <thead><tr><th>#</th><th>Key inputs</th><th>Predicted ${esc(r.model.target)}</th><th>Confidence</th></tr></thead><tbody>` +
      r.results.slice(0, 100).map((x, i) => `<tr><td>${i + 1}</td>
        <td class="small-13 muted">${esc(Object.values(x.input).slice(0, 3).join(", "))}</td>
        <td>${badgeFor(x.prediction)}</td><td>${x.confidence}%</td></tr>`).join("") + `</tbody></table>` +
      (r.results.length > 100 ? `<div class="small-13 muted p-2">Showing first 100 of ${r.results.length} — download the CSV for all.</div>` : "");
    $("batchDownload").style.display = "inline-block";
    if (r.saved) { loadHistory(); loadDashboard(); }
    toast(`${r.count} batch predictions completed`, "ok");
  } catch (ex) { toast(ex.message, "err"); }
  loader(false); btn.disabled = false;
};

$("batchDownload").onclick = () => {
  if (!BATCH.results.length) return toast("Run the batch first.", "err");
  const cols = ["prediction", "confidence", ...BATCH.headers];
  const lines = [cols.join(",")].concat(BATCH.results.map(x =>
    [`"${x.prediction}"`, x.confidence, ...BATCH.headers.map(h => `"${String(x.input[h] ?? "").replace(/"/g, '""')}"`)].join(",")));
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" }));
  a.download = "spps_batch_predictions.csv"; a.click();
  toast("Batch results downloaded", "ok");
};

/* ================= HISTORY (search · filter · pagination) ================= */
const HIST = { q: "", cls: "", page: 1, limit: 10 };

async function loadHistory() {
  try {
    const qs = new URLSearchParams({ q: HIST.q, prediction: HIST.cls, page: HIST.page, limit: HIST.limit });
    const r = await api("GET", "/api/history?" + qs);
    STATE.history = r.history;
    $("histCount").textContent = r.total + " records";
    $("histEmpty").style.display = r.history.length ? "none" : "block";
    $("histWrap").style.display = r.history.length ? "block" : "none";
    $("histPager").style.display = r.pages > 1 ? "flex" : "none";

    // class filter options from server-side counts
    const keep = $("histFilter").value;
    $("histFilter").innerHTML = `<option value="">All classes (${r.total})</option>` +
      r.counts.map(c => `<option value="${esc(c.prediction)}">${esc(c.prediction)} (${c.c})</option>`).join("");
    $("histFilter").value = keep && [...$("histFilter").options].some(o => o.value === keep) ? keep : "";

    $("histPageInfo").textContent = `Page ${r.page} of ${r.pages}`;
    $("histRange").textContent = r.total ? `${(r.page - 1) * r.limit + 1}–${Math.min(r.total, r.page * r.limit)} of ${r.total}` : "0 records";
    $("histPrev").disabled = r.page <= 1;
    $("histNext").disabled = r.page >= r.pages;

    $("histBody").innerHTML = r.history.map(h => `<tr>
      <td>${h.id}</td>
      <td class="small-13">${esc(h.modelName || "—")}</td>
      <td class="small-13 muted" style="max-width:260px">${esc(Object.values(h.input).slice(0, 4).join(", "))}${Object.keys(h.input).length > 4 ? "…" : ""}</td>
      <td>${badgeFor(h.prediction)}</td>
      <td>${h.confidence}%</td>
      <td class="small-13 muted">${new Date(h.createdAt).toLocaleString()}</td>
      <td class="text-end">
        <button class="btn btn-sm btn-outline-primary" onclick="viewHistory(${h.id})"><i class="bi bi-eye"></i></button>
        <button class="btn btn-sm btn-outline-danger" onclick="deleteHistory(${h.id})"><i class="bi bi-trash"></i></button>
      </td></tr>`).join("");
  } catch { /* ignore */ }
}
let histTimer = null;
$("histSearch").oninput = e => {
  clearTimeout(histTimer);
  histTimer = setTimeout(() => { HIST.q = e.target.value.trim(); HIST.page = 1; loadHistory(); }, 300);
};
$("histSearch").onsearch = () => { HIST.q = $("histSearch").value.trim(); HIST.page = 1; loadHistory(); };
$("histFilter").onchange = e => { HIST.cls = e.target.value; HIST.page = 1; loadHistory(); };
$("histLimit").onchange = e => { HIST.limit = Number(e.target.value); HIST.page = 1; loadHistory(); };
$("histPrev").onclick = () => { if (HIST.page > 1) { HIST.page--; loadHistory(); } };
$("histNext").onclick = () => { HIST.page++; loadHistory(); };
window.viewHistory = id => {
  const h = STATE.history.find(x => x.id === id); if (!h) return;
  const probs = Object.entries(h.probabilities).map(([k, v]) => `<tr><td>${esc(k)}</td><td>${v}%</td></tr>`).join("");
  const inputs = Object.entries(h.input).map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join("");
  const expl = (h.explanation && h.explanation.top || []).map(t =>
    `<div class="reason"><div style="min-width:130px"><b>${esc(t.feature)}</b> <span class="muted small-13">${esc(t.value)}</span></div>
     <div class="val ${t.contribution >= 0 ? "text-success" : "text-danger"}">${t.contribution >= 0 ? "+" : ""}${t.contribution}%</div></div>`).join("");
  const recs = (h.recommendations || []).map(t =>
    `<div class="rec ${t.priority}"><div class="ric"><i class="bi bi-lightbulb"></i></div><div><b>${esc(t.title)}</b><p>${esc(t.text)}</p></div></div>`).join("");
  $("histModalBody").innerHTML = `
    <div class="row g-3">
      <div class="col-md-5"><div class="result-hero"><div class="small" style="opacity:.85">Predicted ${esc(h.prediction)}</div>
        <div class="pred" style="font-size:34px">${esc(h.prediction)}</div><div>${h.confidence}% confidence</div></div></div>
      <div class="col-md-7"><div class="card"><div class="card-header">Inputs</div><div class="card-body p-0">
        <div class="tbl-wrap" style="border:0"><table class="table table-sm mb-0"><tbody>${inputs}</tbody></table></div></div></div></div>
      <div class="col-md-6"><div class="card"><div class="card-header">Probabilities</div><div class="card-body p-0">
        <div class="tbl-wrap" style="border:0"><table class="table table-sm mb-0"><thead><tr><th>Class</th><th>Probability</th></tr></thead><tbody>${probs}</tbody></table></div></div></div></div>
      <div class="col-md-6"><div class="card"><div class="card-header">Why?</div><div class="card-body">${expl}</div></div></div>
      <div class="col-12"><div class="card"><div class="card-header">Recommendations</div><div class="card-body">${recs}</div></div></div>
      <div class="col-12 text-end"><button class="btn btn-outline-danger btn-sm" onclick="downloadReport(${h.id})"><i class="bi bi-download me-1"></i>Report</button></div>
    </div>`;
  new bootstrap.Modal($("histModal")).show();
};
window.deleteHistory = async id => {
  try { await api("DELETE", "/api/history/" + id); toast("Entry deleted", "ok"); loadHistory(); loadDashboard(); }
  catch (ex) { toast(ex.message, "err"); }
};
$("clearHist").onclick = async () => {
  if (!STATE.history.length) return;
  if (!confirm("Delete ALL of your prediction history?")) return;
  try { await api("DELETE", "/api/history"); toast("History cleared", "ok"); loadHistory(); loadDashboard(); }
  catch (ex) { toast(ex.message, "err"); }
};
$("exportCsv").onclick = () => {
  if (!STATE.history.length) return toast("Nothing to export.", "err");
  const cols = ["id", "model", "prediction", "confidence", "when", ...Object.keys(STATE.history[0].input)];
  const lines = [cols.join(",")].concat(STATE.history.map(h => [
    h.id, `"${h.modelName || ""}"`, h.prediction, h.confidence, `"${h.createdAt}"`,
    ...Object.values(h.input).map(v => `"${v}"`)
  ].join(",")));
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" }));
  a.download = "spps_predictions.csv"; a.click();
};

/* ================= MODELS ================= */
function renderModelsGrid(models) {
  $("modelsEmpty").style.display = models.length ? "none" : "block";
  $("modelsGrid").innerHTML = models.map(m => `
    <div class="col-md-6 col-xl-4"><div class="card h-100"><div class="card-body">
      <div class="d-flex justify-content-between align-items-start mb-2">
        <div><h5 class="mb-0">#${m.id} · ${esc(m.name)}</h5>
          <div class="muted small-13">${new Date(m.created_at).toLocaleString()} · ${m.n_rows} rows</div></div>
        <span class="chip blue">${esc(m.algorithm)}</span>
      </div>
      <div class="row g-2 text-center my-2">
        <div class="col-4"><div class="metric"><div class="v" style="font-size:18px">${pct(m.metrics?.testAccuracy)}</div><div class="k">Accuracy</div></div></div>
        <div class="col-4"><div class="metric"><div class="v" style="font-size:18px">${pct(m.metrics?.macroF1)}</div><div class="k">F1</div></div></div>
        <div class="col-4"><div class="metric"><div class="v" style="font-size:18px">${pct(m.metrics?.rocAuc)}</div><div class="k">AUC</div></div></div>
      </div>
      <div class="muted small-13 mb-2">Target: <b>${esc(m.target)}</b></div>
      <div class="d-flex gap-2">
        <button class="btn btn-sm btn-primary flex-fill" onclick="useModel(${m.id})"><i class="bi bi-stars"></i> Predict</button>
        <a class="btn btn-sm btn-outline-secondary" href="/api/models/${m.id}/export"><i class="bi bi-download"></i></a>
        <button class="btn btn-sm btn-outline-danger" onclick="deleteModel(${m.id})"><i class="bi bi-trash"></i></button>
      </div>
    </div></div></div>`).join("");
}
window.useModel = id => { $("modelSel").value = String(id); STATE.activeModel = null; go("predict"); };
window.deleteModel = async id => {
  if (!confirm("Delete this model from the server?")) return;
  try { await api("DELETE", "/api/models/" + id); toast("Model deleted", "ok"); loadModels(); loadDashboard(); }
  catch (ex) { toast(ex.message, "err"); }
};

/* ================= ADMIN ================= */
async function loadAdmin() {
  if (!STATE.user || STATE.user.role !== "admin") return;
  try {
    const [s, u, p] = await Promise.all([
      api("GET", "/api/admin/stats"), api("GET", "/api/admin/users"), api("GET", "/api/admin/predictions")
    ]);
    $("admUsers").textContent = s.users;
    $("admPreds").textContent = s.predictions;
    $("admModels").textContent = s.models;
    $("admToday").textContent = s.today;
    $("admConf").textContent = (s.avgConfidence || 0) + "%";
    $("admUserBody").innerHTML = u.users.map(x => `<tr>
      <td>${x.id}</td><td>${esc(x.name)}</td><td class="small-13">${esc(x.email)}</td>
      <td>${x.role === "admin" ? '<span class="chip red">admin</span>' : '<span class="chip gray">user</span>'}</td>
      <td>${x.predictions}</td><td>${x.models}</td>
      <td class="text-end">${x.role === "admin" ? "" :
        `<button class="btn btn-sm btn-outline-danger" onclick="deleteUser(${x.id}, '${esc(x.email)}')"><i class="bi bi-person-x"></i></button>`}</td>
    </tr>`).join("");
    $("admPredBody").innerHTML = p.predictions.length ? p.predictions.map(x => `<tr>
      <td>${x.id}</td><td class="small-13">${esc(x.name)}</td><td>${badgeFor(x.prediction)}</td>
      <td>${x.confidence}%</td><td class="small-13 muted">${new Date(x.created_at).toLocaleString()}</td></tr>`).join("")
      : `<tr><td colspan="5" class="text-center muted py-3">No predictions yet</td></tr>`;
  } catch (ex) { toast(ex.message, "err"); }
}

window.deleteUser = async (id, email) => {
  if (!confirm(`Delete ${email} and ALL their data (models + history)?`)) return;
  try { const r = await api("DELETE", "/api/admin/users/" + id); toast(r.message, "ok"); loadAdmin(); loadDashboard(); }
  catch (ex) { toast(ex.message, "err"); }
};

/* ================= REPORT ================= */
window.downloadReport = id => {
  const h = STATE.history.find(x => x.id === id) || (STATE.lastResult && STATE.lastResult.id === id ? STATE.lastResult : null);
  if (!h) return toast("Report not found.", "err");
  const inputs = Object.entries(h.input).map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join("");
  const probs = Object.entries(h.probabilities).map(([k, v]) => `<tr><td>${esc(k)}</td><td>${v}%</td></tr>`).join("");
  const expl = (h.explanation && h.explanation.top || []).map(t =>
    `<tr><td>${esc(t.feature)}</td><td>${esc(t.value)}</td><td class="${t.contribution >= 0 ? "g" : "r"}">${t.contribution >= 0 ? "+" : ""}${t.contribution}%</td></tr>`).join("");
  const recs = (h.recommendations || []).map(t => `<li><b>${esc(t.title)}</b> — ${esc(t.text)}</li>`).join("");
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>SPPS Prediction Report #${h.id}</title>
<style>body{font-family:Arial,Helvetica,sans-serif;max-width:760px;margin:34px auto;color:#0f172a;padding:0 16px}
h1{font-size:24px;border-bottom:3px solid #4f46e5;padding-bottom:8px}
table{border-collapse:collapse;width:100%;margin:10px 0 20px}td,th{border:1px solid #cbd5e1;padding:7px 9px;text-align:left;font-size:14px}
th{background:#f1f5f9}.g{color:#16a34a;font-weight:700}.r{color:#dc2626;font-weight:700}
.box{background:#eef2ff;border-left:5px solid #4f46e5;padding:12px 16px;border-radius:8px}
footer{margin-top:26px;color:#64748b;font-size:12.5px;border-top:1px solid #e2e8f0;padding-top:10px}</style></head><body>
<h1>Student Performance Prediction Report</h1>
<p class="box"><b>Predicted ${esc(h.target || "performance")}:</b> ${esc(h.prediction)} &nbsp;·&nbsp;
<b>Confidence:</b> ${h.confidence}%<br>Model: ${esc(h.model?.algorithm || h.modelName || "—")} &nbsp;·&nbsp; ${new Date(h.createdAt || Date.now()).toLocaleString()}</p>
<h3>1. Student inputs</h3><table>${inputs}</table>
<h3>2. Class probabilities</h3><table><tr><th>Class</th><th>Probability</th></tr>${probs}</table>
<h3>3. Why this prediction?</h3><table><tr><th>Factor</th><th>Value</th><th>Effect on probability</th></tr>${expl}</table>
<h3>4. Recommendations</h3><ul>${recs}</ul>
<footer>Generated by SPPS — Student Performance Prediction System · ML workflow: preprocessing → 70/15/15 split → 5-fold CV → test metrics (Precision/Recall/F1/Accuracy/ROC-AUC) → explainable prediction.</footer>
</body></html>`;
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([html], { type: "text/html" }));
  a.download = `SPPS_report_${h.id}.html`; a.click();
  toast("Report downloaded — open it and Ctrl+P to save as PDF", "ok");
};
$("reportBtn").onclick = () => STATE.lastResult && downloadReport(STATE.lastResult.id);

/* ================= BOOT ================= */
(async function boot() {
  setMode("login");
  try {
    const me = await api("GET", "/api/auth/me");
    showApp(me.user);
  } catch {
    showAuth();
  }
})();
