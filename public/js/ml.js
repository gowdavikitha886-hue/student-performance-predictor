/* ============================================================
   SPPS ML ENGINE — runs in the browser
   preprocessing · splits · cross-validation · 5 algorithms
   metrics (precision/recall/F1/accuracy) · ROC-AUC · importance
   ============================================================ */
"use strict";

const { dot, argmax, sm, enc } = Core;

/* ---------- deterministic RNG ---------- */
const rng = seed => {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};
const shuffle = (a, r) => {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
};

/* ================= SAMPLE DATASET ================= */
function makeSample(n = 800) {
  const r = rng(42), u = (a, b) => +(a + r() * (b - a)).toFixed(1), ch = a => a[Math.floor(r() * a.length)];
  const nrm = () => { let s = 0; for (let i = 0; i < 6; i++) s += r(); return (s - 3) * 1.414; };
  const rows = [], sc = [];
  for (let i = 0; i < n; i++) {
    const o = {
      student_id: "S" + String(1000 + i),
      study_hours: u(0, 10), attendance: u(40, 100), previous_marks: u(20, 100),
      assignment_score: u(0, 100), sleep_hours: u(4, 9), internet_hours: u(0, 8),
      parental_support: ch(["Low", "Medium", "High"]), extracurricular: ch(["Yes", "No"])
    };
    sc.push(3.5 * o.study_hours + 0.25 * o.attendance + 0.35 * o.previous_marks + 0.15 * o.assignment_score +
      o.sleep_hours - 1.2 * o.internet_hours + ({ Low: -4, Medium: 0, High: 4 })[o.parental_support] + 5 * nrm());
    rows.push(o);
  }
  const s = [...sc].sort((a, b) => a - b), q1 = s[Math.floor(n / 3)], q2 = s[Math.floor((2 * n) / 3)];
  rows.forEach((o, i) => (o.performance = sc[i] < q1 ? "Low" : sc[i] < q2 ? "Medium" : "High"));
  return { cols: Object.keys(rows[0]), rows };
}

/* ================= CSV ================= */
function parseCSV(t) {
  const lines = t.trim().split(/\r?\n/);
  const split = line => {
    const out = []; let cur = "", q = false;
    for (const ch of line) {
      if (ch === '"') q = !q;
      else if (ch === "," && !q) { out.push(cur); cur = ""; }
      else cur += ch;
    }
    out.push(cur); return out;
  };
  const head = split(lines[0]).map(s => s.trim());
  const rows = lines.slice(1).map(split).filter(r => r.length === head.length)
    .map(r => Object.fromEntries(head.map((h, i) => [h, r[i].trim()])));
  return { cols: head, rows };
}
const toCSV = d => d.cols.join(",") + "\n" + d.rows.map(r => d.cols.map(c => `"${r[c]}"`).join(",")).join("\n");

/* ================= PREPROCESSING ================= */
function fitPre(rows, cols, target) {
  const features = [], skipped = [], report = [];
  for (const c of cols) {
    if (c === target) continue;
    const raw = rows.map(r => r[c]);
    const vals = raw.filter(v => v !== "" && v != null && v !== undefined);
    if (!vals.length) { skipped.push({ name: c, reason: "Column is empty" }); continue; }
    const missing = raw.length - vals.length;
    const nums = vals.filter(v => !isNaN(Number(v)));

    if (nums.length / vals.length >= 0.9) {
      const a = nums.map(Number);
      const m = a.reduce((x, y) => x + y, 0) / a.length;
      const sd = Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / a.length) || 1;
      const s = [...a].sort((x, y) => x - y);
      const f = { name: c, type: "number", mean: m, std: sd, median: s[s.length >> 1], min: s[0], max: s[s.length - 1] };
      features.push(f);
      report.push({
        column: c, detected: "Numeric", missing,
        action: missing ? "Imputed (median) → Standardized (z-score)" : "Standardized (z-score)",
        detail: `mean ${f.mean.toFixed(2)} · std ${f.std.toFixed(2)} · median ${f.median}`
      });
    } else {
      const cnt = {}; vals.forEach(v => (cnt[v] = (cnt[v] || 0) + 1));
      const cats = Object.keys(cnt).sort();
      if (cats.length > 30) { skipped.push({ name: c, reason: `Too many unique values (${cats.length}) — ID/name-like column` }); continue; }
      const mode = cats.reduce((a, b) => (cnt[a] >= cnt[b] ? a : b));
      features.push({ name: c, type: "category", cats, mode });
      report.push({
        column: c, detected: "Categorical", missing,
        action: missing ? "Imputed (mode) → One-hot encoded" : `One-hot encoded (${cats.length} levels)`,
        detail: cats.slice(0, 5).join(", ") + (cats.length > 5 ? ` +${cats.length - 5} more` : "")
      });
    }
  }
  skipped.forEach(s => report.push({ column: s.name, detected: "Skipped", missing: 0, action: "Dropped", detail: s.reason }));
  return { target, features, skipped, report };
}

/* ================= DATA PROFILING ================= */
function profile(d, target) {
  const cols = d.cols.map(c => {
    const raw = d.rows.map(r => r[c]);
    const vals = raw.filter(v => v !== "" && v != null);
    const missing = raw.length - vals.length;
    const nums = vals.filter(v => !isNaN(Number(v))).map(Number);
    const numeric = vals.length > 0 && nums.length / vals.length >= 0.9;
    const unique = new Set(vals.map(String)).size;
    const base = { name: c, missing, unique, numeric, n: vals.length };
    if (numeric) {
      const s = [...nums].sort((a, b) => a - b);
      const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
      return { ...base, mean, std: Math.sqrt(nums.reduce((a, b) => a + (b - mean) ** 2, 0) / nums.length), min: s[0], max: s[s.length - 1], median: s[s.length >> 1] };
    }
    const cnt = {}; vals.forEach(v => (cnt[v] = (cnt[v] || 0) + 1));
    const top = Object.entries(cnt).sort((a, b) => b[1] - a[1])[0];
    return { ...base, top: top ? `${top[0]} (${top[1]})` : "-" };
  });

  const cls = {};
  d.rows.forEach(r => (cls[r[target]] = (cls[r[target]] || 0) + 1));

  // eta² — how well each numeric feature separates the target classes
  const group = {};
  d.rows.forEach(r => { const t = String(r[target]); (group[t] = group[t] || []).push(r); });
  const overallMean = nums => nums.reduce((a, b) => a + b, 0) / (nums.length || 1);
  const separation = [];
  for (const f of featuresOf(d, target)) {
    const total = d.rows.map(r => Number(r[f])).filter(v => !isNaN(v));
    if (total.length < 5) continue;
    const gm = overallMean(total);
    const ssTot = total.reduce((a, b) => a + (b - gm) ** 2, 0);
    if (!ssTot) continue;
    let ssBet = 0;
    for (const k in group) {
      const v = group[k].map(r => Number(r[f])).filter(x => !isNaN(x));
      if (!v.length) continue;
      ssBet += v.length * (overallMean(v) - gm) ** 2;
    }
    separation.push([f, +(ssBet / ssTot).toFixed(3)]);
  }
  separation.sort((a, b) => b[1] - a[1]);
  return { cols, classes: cls, separation, total: d.rows.length, target };
}

function featuresOf(d, target) {
  return d.cols.filter(c => {
    if (c === target) return false;
    const vals = d.rows.map(r => r[c]).filter(v => v !== "" && v != null);
    if (!vals.length) return false;
    const nums = vals.filter(v => !isNaN(Number(v)));
    return nums.length / vals.length >= 0.9 && new Set(vals).size <= 1000;
  });
}

/* ================= SPLITS ================= */
function stratifiedSplit(labels, ratios = [0.7, 0.15, 0.15], seed = 7) {
  const r = rng(seed), byClass = {};
  labels.forEach((l, i) => (byClass[l] = byClass[l] || []).push(i));
  const train = [], val = [], test = [];
  for (const k in byClass) {
    const idx = shuffle(byClass[k].slice(), r);
    const n = idx.length;
    let nTr = Math.round(n * ratios[0]), nVa = Math.round(n * ratios[1]);
    if (nTr < 1) nTr = Math.min(1, n);
    if (nTr + nVa >= n) nVa = Math.max(0, n - nTr - 1);
    train.push(...idx.slice(0, nTr));
    val.push(...idx.slice(nTr, nTr + nVa));
    test.push(...idx.slice(nTr + nVa));
  }
  return { train: shuffle(train, r), val: shuffle(val, r), test: shuffle(test, r) };
}

function kFoldStratified(labels, k = 5, seed = 11) {
  const r = rng(seed), byClass = {};
  labels.forEach((l, i) => (byClass[l] = byClass[l] || []).push(i));
  const folds = Array.from({ length: k }, () => []);
  for (const key in byClass) {
    const idx = shuffle(byClass[key].slice(), r);
    idx.forEach((v, i) => folds[i % k].push(v));
  }
  return folds.map((testIdx, i) => ({
    test: testIdx,
    train: folds.filter((_, j) => j !== i).flat()
  }));
}

/* ================= ALGORITHMS ================= */
const trKNN = (X, y, C, opt = {}) => ({ type: "knn", k: opt.k || 5, X, y });

function trLR(X, y, C, opt = {}) {
  const D = X[0].length, n = X.length, lr = 0.4;
  let W = Array.from({ length: C }, () => new Array(D + 1).fill(0));
  const epochs = opt.epochs || 300;
  const val = opt.valX && opt.valX.length ? opt.valX : null;
  const lossOf = w => {
    if (!val) return null;
    let L = 0;
    for (let i = 0; i < val.length; i++) {
      const p = sm(w.map(ww => dot(ww, val[i]) + ww[D]));
      L -= Math.log(Math.max(1e-9, p[opt.valY[i]]));
    }
    return L / val.length;
  };
  let best = W.map(w => w.slice()), bestLoss = Infinity, wait = 0;
  const step = opt.stepEvery || 25;
  for (let ep = 1; ep <= epochs; ep++) {
    const G = W.map(() => new Array(D + 1).fill(0));
    for (let i = 0; i < n; i++) {
      const p = sm(W.map(w => dot(w, X[i]) + w[D]));
      for (let c = 0; c < C; c++) {
        const e = p[c] - (y[i] === c ? 1 : 0);
        for (let j = 0; j < D; j++) G[c][j] += e * X[i][j];
        G[c][D] += e;
      }
    }
    for (let c = 0; c < C; c++)
      for (let j = 0; j <= D; j++)
        W[c][j] -= lr * (G[c][j] / n + (j < D ? 0.001 * W[c][j] : 0));

    if (val && ep % step === 0) {
      const L = lossOf(W);
      if (L < bestLoss - 1e-5) { bestLoss = L; best = W.map(w => w.slice()); wait = 0; }
      else if (++wait >= 4) break;
    }
  }
  return { type: "lr", W: val ? best : W };
}

function trNB(X, y, C) {
  const D = X[0].length, st = [];
  for (let c = 0; c < C; c++) {
    const rs = X.filter((_, i) => y[i] === c), n = rs.length || 1;
    const mu = new Array(D).fill(0), v = new Array(D).fill(0);
    rs.forEach(r => r.forEach((a, j) => (mu[j] += a / n)));
    rs.forEach(r => r.forEach((a, j) => (v[j] += (a - mu[j]) ** 2 / n)));
    st.push({ prior: Math.log((rs.length + 1) / (X.length + C)), mu, v: v.map(a => a + 1e-2) });
  }
  return { type: "nb", st };
}

const gini = (cnt, n) => { let s = 1; for (const c of cnt) s -= (c / n) ** 2; return s; };

function buildTree(X, y, idx, C, depth, maxD, mtry, minLeaf) {
  const cnt = new Array(C).fill(0);
  idx.forEach(i => cnt[y[i]]++);
  const n = idx.length;
  const leaf = () => ({ p: cnt.map(c => c / n) });
  if (depth >= maxD || n < minLeaf * 2 || cnt.some(c => c === n)) return leaf();
  const D = X[0].length;
  let fs = [...Array(D).keys()];
  if (mtry < D) { fs = shuffle(fs, rng(depth * 977 + idx.length + 1)).slice(0, mtry); }
  let best = null, bg = gini(cnt, n);
  for (const f of fs) {
    const vals = [...new Set(idx.map(i => X[i][f]))].sort((a, b) => a - b);
    if (vals.length < 2) continue;
    const step = Math.max(1, Math.floor(vals.length / 12));
    for (let k = step; k < vals.length; k += step) {
      const t = (vals[k - 1] + vals[k]) / 2;
      const lc = new Array(C).fill(0);
      let ln = 0;
      for (const i of idx) if (X[i][f] <= t) { lc[y[i]]++; ln++; }
      const rn = n - ln;
      if (ln < minLeaf || rn < minLeaf) continue;
      const rc = cnt.map((c, j) => c - lc[j]);
      const g = (ln * gini(lc, ln) + rn * gini(rc, rn)) / n;
      if (g < bg - 1e-9) { bg = g; best = { f, t }; }
    }
  }
  if (!best) return leaf();
  const L = idx.filter(i => X[i][best.f] <= best.t);
  const R = idx.filter(i => X[i][best.f] > best.t);
  return { f: best.f, t: best.t, l: buildTree(X, y, L, C, depth + 1, maxD, mtry, minLeaf), r: buildTree(X, y, R, C, depth + 1, maxD, mtry, minLeaf) };
}

const trDT = (X, y, C, opt = {}) => ({
  type: "dt", tree: buildTree(X, y, X.map((_, i) => i), C, 0, opt.maxDepth || 6, X[0].length, opt.minLeaf || 2)
});

function trRF(X, y, C, opt = {}) {
  const n = X.length, mtry = Math.max(1, Math.ceil(Math.sqrt(X[0].length))), trees = [];
  const T = opt.trees || 30;
  for (let t = 0; t < T; t++) {
    const idx = Array.from({ length: n }, () => Math.floor(Math.random() * n));
    trees.push(buildTree(X, y, idx, C, 0, opt.maxDepth || 8, mtry, 2));
  }
  return { type: "rf", trees };
}

const ALGOS = [
  { key: "knn", name: "K-Nearest Neighbors", fit: (X, y, C, o) => trKNN(X, y, C, o) },
  { key: "lr", name: "Logistic Regression", fit: (X, y, C, o) => trLR(X, y, C, o) },
  { key: "nb", name: "Naive Bayes", fit: (X, y, C, o) => trNB(X, y, C, o) },
  { key: "dt", name: "Decision Tree", fit: (X, y, C, o) => trDT(X, y, C, o) },
  { key: "rf", name: "Random Forest", fit: (X, y, C, o) => trRF(X, y, C, o) }
];

/* ================= METRICS ================= */
function metrics(yTrue, yScore, classes) {
  const yPred = yScore.map(s => argmax(s));
  const C = classes.length;
  const cm = Array.from({ length: C }, () => new Array(C).fill(0));
  yTrue.forEach((t, i) => cm[t][yPred[i]]++);
  const perClass = classes.map((label, c) => {
    const tp = cm[c][c];
    let fp = 0, fn = 0;
    for (let i = 0; i < C; i++) { if (i !== c) { fp += cm[i][c]; fn += cm[c][i]; } }
    const precision = tp + fp ? tp / (tp + fp) : 0;
    const recall = tp + fn ? tp / (tp + fn) : 0;
    const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
    const support = cm[c].reduce((a, b) => a + b, 0);
    return { label, precision, recall, f1, support, tp, fp, fn };
  });
  const acc = yTrue.length ? yTrue.filter((t, i) => t === yPred[i]).length / yTrue.length : 0;
  const avg = fn => perClass.reduce((a, b) => a + fn(b), 0) / (perClass.length || 1);
  const macro = { precision: avg(b => b.precision), recall: avg(b => b.recall), f1: avg(b => b.f1) };
  const supportSum = perClass.reduce((a, b) => a + b.support, 0) || 1;
  const weighted = {
    precision: perClass.reduce((a, b) => a + b.precision * b.support, 0) / supportSum,
    recall: perClass.reduce((a, b) => a + b.recall * b.support, 0) / supportSum,
    f1: perClass.reduce((a, b) => a + b.f1 * b.support, 0) / supportSum
  };
  return { accuracy: acc, perClass, macro, weighted, confusion: cm, yPred };
}

function rocAuc(yTrue, yScore, classes) {
  const C = classes.length;
  const aucOf = (pos, scores) => {
    const pts = scores.map((s, i) => ({ s, p: pos[i] })).sort((a, b) => b.s - a.s);
    const P = pos.reduce((a, b) => a + b, 0) || 1;
    const N = pts.length - P || 1;
    let tp = 0, fp = 0, prev = null, area = 0, prevTpr = 0, prevFpr = 0;
    const fpr = [0], tpr = [0];
    for (const pt of pts) {
      if (prev !== null && pt.s !== prev) {
        const cF = fp / N, cT = tp / P;
        area += ((cF - prevFpr) * (cT + prevTpr)) / 2;
        fpr.push(cF); tpr.push(cT);
        prevFpr = cF; prevTpr = cT;
      }
      if (pt.p) tp++; else fp++;
      prev = pt.s;
    }
    area += ((1 - prevFpr) * (1 + prevTpr)) / 2;
    fpr.push(1); tpr.push(1);
    return { auc: area, fpr, tpr };
  };

  const perClass = classes.map((label, c) => {
    const pos = yTrue.map(t => (t === c ? 1 : 0));
    const r = aucOf(pos, yScore.map(s => s[c]));
    return { label, auc: r.auc, fpr: r.fpr, tpr: r.tpr };
  });

  // micro-average OvR (flattened one-vs-rest pairs)
  const flatTrue = [], flatScore = [];
  yTrue.forEach((t, i) => classes.forEach((_, c) => { flatTrue.push(t === c ? 1 : 0); flatScore.push(yScore[i][c]); }));
  const micro = aucOf(flatTrue, flatScore);
  const macroAuc = perClass.reduce((a, b) => a + b.auc, 0) / (perClass.length || 1);
  return { perClass, micro: micro.auc, macro: macroAuc, microCurve: { fpr: micro.fpr, tpr: micro.tpr } };
}

/* ================= TRAINING PIPELINE ================= */
const tick = (ms = 20) => new Promise(r => setTimeout(r, ms));

async function trainPipeline(d, target, setStatus) {
  /* --- clean --- */
  setStatus("Cleaning data…"); await tick();
  let rows = d.rows.filter(r => r[target] !== "" && r[target] != null && r[target] !== undefined);
  const seen = new Set();
  rows = rows.filter(r => { const k = JSON.stringify(r); return seen.has(k) ? false : (seen.add(k), true); });
  const classes = [...new Set(rows.map(r => String(r[target])))].sort();
  if (classes.length < 2 || classes.length > 15) throw new Error("Target must have 2–15 distinct classes. Pick a category column.");
  if (rows.length < 40) throw new Error("Need at least 40 usable rows.");
  const C = classes.length;
  const labels = rows.map(r => classes.indexOf(String(r[target])));

  /* --- split 70 / 15 / 15 --- */
  setStatus("Stratified train / validation / test split (70/15/15)…"); await tick(40);
  const sp = stratifiedSplit(labels, [0.7, 0.15, 0.15], 7);
  if (!sp.test.length || !sp.val.length) throw new Error("Dataset too small for a 70/15/15 split — need more rows per class.");
  const trR = sp.train.map(i => rows[i]), vaR = sp.val.map(i => rows[i]), teR = sp.test.map(i => rows[i]);

  /* --- preprocessing fitted on TRAIN only (no leakage) --- */
  setStatus("Fitting preprocessing on the training fold…"); await tick();
  const pre = fitPre(trR, d.cols, target);
  if (!pre.features.length) throw new Error("No usable feature columns found.");
  const encAll = rs => rs.map(r => enc(pre, r));
  const Xtr = encAll(trR), ytr = sp.train.map(i => labels[i]);
  const Xva = encAll(vaR), yva = sp.val.map(i => labels[i]);
  const Xte = encAll(teR), yte = sp.test.map(i => labels[i]);

  /* --- 5-fold cross-validation --- */
  const K = 5, results = [];
  const folds = kFoldStratified(ytr, K, 13);
  for (const algo of ALGOS) {
    setStatus(`Cross-validation (${K}-fold): ${algo.name}…`); await tick(30);
    const f1s = [], accs = [];
    for (let f = 0; f < folds.length; f++) {
      const fi = folds[f];
      const Xa = fi.train.map(i => Xtr[i]), ya = fi.train.map(i => ytr[i]);
      const Xb = fi.test.map(i => Xtr[i]), yb = fi.test.map(i => ytr[i]);
      const opt = algo.key === "lr" ? { epochs: 150 } : {};
      const m = algo.fit(Xa, ya, C, opt);
      const sc = Xb.map(x => Core.proba(m, x, C));
      const mt = metrics(yb, sc, classes);
      f1s.push(mt.macro.f1); accs.push(mt.accuracy);
      await tick(5);
    }
    const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
    const sd = a => Math.sqrt(mean(a.map(v => (v - mean(a)) ** 2)));
    const entry = { key: algo.key, name: algo.name, cvF1: mean(f1s), cvF1Std: sd(f1s), cvAcc: mean(accs), cvAccStd: sd(accs) };

    // fit on train, score on validation (test stays untouched)
    const vOpt = algo.key === "lr" ? { epochs: 250 } : {};
    const vModel = algo.fit(Xtr, ytr, C, vOpt);
    const vMt = metrics(yva, Xva.map(x => Core.proba(vModel, x, C)), classes);
    entry.valAcc = vMt.accuracy; entry.valF1 = vMt.macro.f1;
    results.push(entry);
    await tick(5);
  }

  /* --- select best by CV macro-F1 --- */
  results.sort((a, b) => b.cvF1 - a.cvF1);
  const winner = results[0];
  const winnerAlgo = ALGOS.find(a => a.key === winner.key);
  setStatus(`Fitting "${winner.name}" on the training set…`); await tick(50);
  const t0 = performance.now();
  const opt = winner.key === "lr"
    ? { epochs: 400, valX: Xva, valY: yva, stepEvery: 25 }
    : winner.key === "knn" ? { k: 5 } : {};
  const model = winnerAlgo.fit(Xtr, ytr, C, opt);
  const trainMs = Math.round(performance.now() - t0);

  /* --- validation + test evaluation --- */
  setStatus("Evaluating on validation and test sets…"); await tick(40);
  const scoreOf = X => X.map(x => Core.proba(model, x, C));
  const valM = metrics(yva, scoreOf(Xva), classes);
  const testM = metrics(yte, scoreOf(Xte), classes);
  const roc = rocAuc(yte, scoreOf(Xte), classes);

  /* --- permutation importance on the test set --- */
  setStatus("Computing permutation feature importance…"); await tick(40);
  const base = testM.macro.f1, importance = [];
  for (let fi = 0; fi < pre.features.length; fi++) {
    const f = pre.features[fi];
    let drop = 0;
    for (let rep = 0; rep < 3; rep++) {
      const r = rng(rep * 31 + fi + 1);
      const col = shuffle(teR.map(row => row[f.name]), r);
      const sh = teR.map((row, i) => ({ ...row, [f.name]: col[i] }));
      const sc = encAll(sh).map(x => Core.proba(model, x, C));
      drop += (base - metrics(yte, sc, classes).macro.f1) / 3;
    }
    importance.push({ name: f.name, drop: Math.max(0, +drop.toFixed(4)) });
    setStatus(`Permutation importance: ${f.name} (${fi + 1}/${pre.features.length})…`);
    await tick(5);
  }
  importance.sort((a, b) => b.drop - a.drop);

  setStatus("Done.");
  return {
    pre, classes, model,
    best: winner.name, bestKey: winner.key, target,
    results, importance,
    valMetrics: valM, testMetrics: testM, roc,
    split: { train: sp.train.length, val: sp.val.length, test: sp.test.length },
    nRows: rows.length, trainMs,
    encoded: { Xtr, ytr, Xva, yva, Xte, yte }   // kept for confusion chart reuse
  };
}

/* export for Node-based tests (no-op in the browser) */
if (typeof module !== "undefined" && module.exports) {
  module.exports = { makeSample, parseCSV, toCSV, fitPre, profile, stratifiedSplit, kFoldStratified, metrics, rocAuc, trainPipeline, ALGOS };
}
