/* ============================================================
   SPPS shared core — runs BOTH in the browser and in Node.js
   (encoding, inference, explanation, recommendations)
   ============================================================ */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Core = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const dot = (w, x) => { let s = 0; for (let i = 0; i < x.length; i++) s += w[i] * x[i]; return s; };
  const argmax = a => a.indexOf(Math.max(...a));
  const sm = z => {
    const m = Math.max.apply(null, z), e = z.map(v => Math.exp(v - m)), s = e.reduce((a, b) => a + b, 0);
    return e.map(v => v / s);
  };
  const walk = (nd, x) => { while (nd.p === undefined) nd = x[nd.f] <= nd.t ? nd.l : nd.r; return nd.p; };

  /* ---------- column layout of the encoded vector ---------- */
  function layout(pre) {
    const out = [];
    for (const f of pre.features) {
      const from = out.length;
      if (f.type === "number") out.push({ feature: f.name, kind: "number", from, to: from, mean: f.mean });
      else {
        const to = from + f.cats.length - 1;
        out.push({ feature: f.name, kind: "category", from, to, cats: f.cats, mode: f.mode });
        for (let i = 1; i < f.cats.length; i++) out.push({ feature: f.name, kind: "category_dummy", from, to });
      }
    }
    return out;
  }

  /* ---------- encode one row into a numeric vector ---------- */
  function enc(pre, row) {
    const x = [];
    for (const f of pre.features) {
      const v = row[f.name], missing = v === "" || v === null || v === undefined;
      if (f.type === "number") {
        const n = missing || isNaN(Number(v)) ? f.median : Number(v);
        x.push((n - f.mean) / (f.std || 1));
      } else {
        const s = missing ? f.mode : String(v);
        for (const c of f.cats) x.push(c === s ? 1 : 0);
      }
    }
    return x;
  }

  /* ---------- baseline (training mean / mode) row ---------- */
  function baselineRow(pre) {
    const r = {};
    for (const f of pre.features) r[f.name] = f.type === "number" ? f.mean : f.mode;
    return r;
  }

  /* ---------- probability for every class ---------- */
  function proba(model, x, C) {
    switch (model.type) {
      case "knn": {
        const d = [];
        for (let i = 0; i < model.X.length; i++) { let s = 0; for (let j = 0; j < x.length; j++) { const df = model.X[i][j] - x[j]; s += df * df; } d.push([s, model.y[i]]); }
        d.sort((a, b) => a[0] - b[0]);
        const k = Math.min(model.k, d.length), p = new Array(C).fill(0);
        for (let i = 0; i < k; i++) p[d[i][1]] += 1 / k;
        return p;
      }
      case "lr": return sm(model.W.map(w => dot(w, x) + w[w.length - 1]));
      case "nb": return sm(model.st.map(s => {
        let a = s.prior;
        for (let j = 0; j < x.length; j++) a += -0.5 * Math.log(2 * Math.PI * s.v[j]) - Math.pow(x[j] - s.mu[j], 2) / (2 * s.v[j]);
        return a;
      }));
      case "dt": return walk(model.tree, x);
      case "rf": {
        const p = new Array(C).fill(0);
        for (const t of model.trees) { const q = walk(t, x); for (let i = 0; i < C; i++) p[i] += q[i] / model.trees.length; }
        return p;
      }
      default: return new Array(C).fill(1 / C);
    }
  }

  /* ---------- predict a raw row (object) ---------- */
  function predict(pre, model, classes, row) {
    const p = proba(model, enc(pre, row), classes.length);
    const i = argmax(p);
    const probs = {};
    classes.forEach((c, k) => probs[c] = Math.round(p[k] * 10000) / 100);
    return {
      prediction: classes[i],
      confidence: Math.round(p[i] * 10000) / 100,
      probabilities: probs,
      index: i
    };
  }

  /* ---------- prediction explanation (leave-one-feature-out) ----------
     For every feature we replace it with its training baseline
     (mean / mode) and measure how much the predicted-class
     probability drops. Positive contribution = pushed prediction UP. */
  function explain(pre, model, classes, row) {
    const lay = layout(pre);
    const x = enc(pre, row), x0 = enc(pre, baselineRow(pre));
    const p = proba(model, x, classes.length);
    const pi = argmax(p), full = p[pi];
    const names = [...new Set(lay.map(l => l.feature))];
    const items = names.map(name => {
      const idx = [];
      lay.forEach((l, j) => { if (l.feature === name) idx.push(j); });
      const ab = x.slice();
      for (const j of idx) ab[j] = x0[j];
      const pa = proba(model, ab, classes.length);
      const base = proba(model, x0, classes.length);
      return {
        feature: name,
        value: row[name],
        baseline: pre.features.find(f => f.name === name).type === "number"
          ? Math.round(pre.features.find(f => f.name === name).mean * 100) / 100
          : pre.features.find(f => f.name === name).mode,
        contribution: Math.round((full - pa[pi]) * 10000) / 100,
        absolute: Math.round((pa[pi] - base[pi]) * 10000) / 100
      };
    });
    items.sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));
    return { top: items.slice(0, 6), all: items, classIndex: pi, baseProb: Math.round(p[pi] * 10000) / 100 };
  }

  /* ---------- student recommendations ---------- */
  function recommend(pre, classes, row, predicted) {
    const tips = [];
    const get = n => { const f = pre.features.find(f => f.name === n); return f ? { f, v: row[n] } : null; };
    const num = n => { const g = get(n); if (!g || g.v === "" || g.v == null || isNaN(Number(g.v))) return null; return { f: g.f, v: Number(g.v) }; };

    const sh = num("study_hours");
    if (sh) {
      const target = Math.min(8, Math.max(4, Math.round((sh.f.median || 4) * 1.5 * 10) / 10));
      if (sh.v < (sh.f.median || 4)) tips.push({ icon: "book", priority: "high", title: "Increase study time", text: `You study ${sh.v} h/day. Raise it to at least ${target} h/day with focused, distraction-free sessions.` });
      else tips.push({ icon: "book", priority: "good", title: "Study habit is solid", text: `${sh.v} h/day of study is above the dataset median. Keep the consistency.` });
    }
    const at = num("attendance");
    if (at && at.v < 80) tips.push({ icon: "calendar-check", priority: "high", title: "Attendance below 80%", text: `Attendance is ${at.v}%. Missing classes is one of the strongest drivers of low performance — target 90%+.` });
    else if (at && at.v >= 90) tips.push({ icon: "calendar-check", priority: "good", title: "Excellent attendance", text: `${at.v}% attendance keeps you consistent with lectures and coursework.` });

    const pm = num("previous_marks");
    if (pm && pm.v < 50) tips.push({ icon: "graph-up", priority: "high", title: "Weak prior academic record", text: `Previous marks are ${pm.v}. Revise foundational topics first, then move to advanced chapters.` });

    const as = num("assignment_score");
    if (as && as.v < 60) tips.push({ icon: "clipboard-check", priority: "medium", title: "Improve assignment quality", text: `Assignment score is ${as.v}/100. Start earlier, check requirements twice and ask for feedback before submitting.` });

    const sl = num("sleep_hours");
    if (sl && (sl.v < 6 || sl.v > 9)) tips.push({ icon: "moon", priority: "medium", title: "Fix your sleep cycle", text: `You sleep ${sl.v} h/day. 7–9 hours improves memory consolidation and exam performance.` });

    const ih = num("internet_hours");
    if (ih && ih.v > 4) tips.push({ icon: "phone", priority: "medium", title: "Cut recreational screen time", text: `${ih.v} h/day online (beyond study) — use app timers to reclaim 1–2 h for revision.` });

    const ps = get("parental_support");
    if (ps && ps.v === "Low") tips.push({ icon: "people", priority: "medium", title: "Seek support outside home", text: "Parental support is low — join a study group or ask teachers/mentors for a weekly check-in." });

    const ex = get("extracurricular");
    if (ex && ex.v === "Yes" && sh && sh.v < (sh.f.median || 4)) tips.push({ icon: "trophy", priority: "low", title: "Balance activities with study", text: "Extracurriculars are great, but they compete with study time — schedule them after revision blocks." });

    if (predicted === "Low") tips.unshift({ icon: "exclamation-triangle", priority: "high", title: "High-risk prediction", text: "The model predicts LOW performance. Act on the high-priority items above within the next 2 weeks and re-run the prediction." });
    else if (predicted === "Medium") tips.unshift({ icon: "arrow-up-right", priority: "medium", title: "On track, but room to grow", text: "The model predicts MEDIUM performance. Fixing the top 2 suggestions below usually moves students into the High band." });
    else if (predicted === "High") tips.unshift({ icon: "star", priority: "good", title: "High performance likely", text: "The model predicts HIGH performance. Maintain your routine and use spare time for enrichment projects." });
    else tips.unshift({ icon: "arrow-up-right", priority: "medium", title: "Keep improving", text: `The model predicts "${predicted}". Follow the suggestions below to protect and improve this outcome.` });

    const rank = { high: 0, medium: 1, low: 2, good: 3 };
    tips.sort((a, b) => rank[a.priority] - rank[b.priority]);
    return tips;
  }

  return { dot, argmax, sm, walk, enc, layout, baselineRow, proba, predict, explain, recommend };
});
