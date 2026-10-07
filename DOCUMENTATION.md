# SPPS — Student Performance Prediction System
## Complete Project Documentation

| | |
|---|---|
| **Project name** | Student Performance Prediction System (SPPS) |
| **Version** | 2.0 |
| **Type** | Full-stack Machine Learning Web Application |
| **Stack** | HTML/CSS/JavaScript (frontend) · Node.js REST API (backend) · SQLite (database) |
| **Dependencies** | None (zero npm packages) |
| **Runtime** | Node.js ≥ 22.5 |
| **Default URL** | http://localhost:3000 |
| **Local demo admin** | admin@spps.local / admin123 |

---

## 1. Abstract

SPPS is a full-stack machine-learning application that predicts student performance
(Low / Medium / High, or any categorical target in the user's own data) and explains
*why* a prediction was made. The system implements the complete ML lifecycle —
data ingestion, preprocessing, stratified splitting, cross-validation, model
comparison, evaluation (Accuracy, Precision, Recall, F1, ROC-AUC), explainability,
and recommendations — entirely in code written from scratch (no scikit-learn,
no TensorFlow).

The **frontend** is a responsive single-page HTML/CSS/JS interface with 7 pages and
a login/register flow. The **backend** is a dependency-free Node.js HTTP server that
provides real REST endpoints, session-based authentication, a SQLite database for
users/models/prediction-history, and **server-side inference** — the trained model is
saved to the database and predictions are computed by `POST /api/predict`, not in the
browser.

---

## 2. Objectives

1. Predict student performance from academic and behavioural features.
2. Show a professional ML workflow: preprocessing summary → 70/15/15 split → 5-fold CV → test evaluation.
3. Evaluate with more than accuracy: Precision, Recall, F1 (per-class/macro/weighted) and ROC-AUC.
4. Explain every prediction and give actionable student recommendations.
5. Use a real backend API + database instead of browser-only storage.
6. Provide login/logout, per-user history and an admin dashboard.
7. Keep the project runnable anywhere with a single command (`npm start`).

### Feature → Implementation map

| Feature | Priority | Where it is implemented |
|---|---|---|
| Data preprocessing summary | ⭐⭐⭐⭐⭐ | `public/js/ml.js:67` `fitPre()` + `renderPrepAndProfile()` (`app.js:215`) |
| Train/Test/Validation split | ⭐⭐⭐⭐⭐ | `ml.js:163` `stratifiedSplit()` (70/15/15) |
| Cross-validation | ⭐⭐⭐⭐⭐ | `ml.js:180` `kFoldStratified()` + `trainPipeline()` (`ml.js:372`) |
| Precision, Recall, F1, Accuracy | ⭐⭐⭐⭐⭐ | `ml.js:305` `metrics()` |
| ROC-AUC curve | ⭐⭐⭐⭐ | `ml.js:332` `rocAuc()` (OvR + macro + micro) |
| Data visualization dashboard | ⭐⭐⭐⭐ | Dataset page: 4 Chart.js charts + column profiling |
| Model download/export | ⭐⭐⭐⭐ | `GET /api/models/:id/export` (`server.js:279`) |
| Prediction explanation | ⭐⭐⭐⭐ | `public/js/inference.js:102` `explain()` |
| Student recommendations | ⭐⭐⭐⭐⭐ | `inference.js:130` `recommend()` |
| Real backend API | ⭐⭐⭐⭐⭐ | `server.js` (18 REST routes) |
| Login / admin dashboard | ⭐⭐⭐ | `server.js:183-226`, Admin page (`app.js:589`) |
| Database for prediction history | ⭐⭐⭐⭐ | SQLite tables `predictions`, `models`, `users`, `sessions` |
| Cloud deployment | ⭐⭐⭐⭐ | `README.md` → Deploy section (Render / Railway / Fly.io / VPS) |

### Added in v2.1 (required feature pack)

| Feature | Endpoint / location |
|---|---|
| Account settings — display name | `PUT /api/account` + Account modal |
| Change password (verification + logout other sessions) | `POST /api/account/password` |
| Active session list / log out other devices | `GET` · `DELETE /api/account/sessions` |
| Delete own account (password confirmation, cascades data) | `DELETE /api/account` |
| History search + class filter + pagination | `GET /api/history?q=&prediction=&page=&limit=` |
| Batch CSV prediction (≤ 500 rows) + results CSV export | `POST /api/predict/batch` + Predict page |
| Saved-model leaderboard (Accuracy / F1 / AUC) | Models page (`renderLeaderboard`, `app.js`) |
| Dark mode toggle (persisted) | `themeBtn` + `[data-theme="dark"]` in `styles.css` |
| Admin: delete user + all their data | `DELETE /api/admin/users/:id` |

---

## 3. System Architecture

```
┌────────────────────────────────────────────────────────────────────────┐
│  BROWSER  (public/)                                                   │
│                                                                        │
│  index.html ── styles.css (design system)                              │
│      │                                                                 │
│      ├── app.js      UI controller · API client · charts               │
│      ├── ml.js       preprocessing · splits · CV · 5 algorithms        │
│      │                · metrics · ROC-AUC · importance                 │
│      └── inference.js enc · proba · explain · recommend  ◄── SHARED     │
└───────────────┬────────────────────────────────────────────────────────┘
                │  HTTPS/HTTP  JSON  (cookie session "sid")
┌───────────────▼────────────────────────────────────────────────────────┐
│  NODE SERVER  (server.js, zero dependencies)                           │
│                                                                        │
│  http.Server ── router ── static files (public/)                       │
│                       ├── auth: scrypt hash · sessions · rate-limit    │
│                       ├── API: models · predict · history · dashboard  │
│                       ├── inference: requires inference.js (same file) │
│                       └── security headers · path-traversal guard      │
└───────────────┬────────────────────────────────────────────────────────┘
                │  node:sqlite (DatabaseSync)
┌───────────────▼────────────────────────────────────────────────────────┐
│  SQLite DB  data/spps.db                                               │
│  users · sessions · models · predictions                               │
└────────────────────────────────────────────────────────────────────────┘
```

**Design decision — where does ML run?**
Training runs in the browser (fast feedback, no upload of large datasets). The trained
model is then serialized to the server (`POST /api/models`) and **all predictions are
executed by the backend** (`POST /api/predict`), so history is trustworthy, per-user,
and device-independent. The file `public/js/inference.js` is a UMD module used by **both**
the browser and Node (`require()`), so client and server always agree on encoding,
inference, explanations and recommendations.

---

## 4. Technology Stack

| Layer | Technology | Why |
|---|---|---|
| Markup / styling | HTML5, Bootstrap 5.3.3, custom CSS | Fast, responsive, consistent design system |
| Icons / charts | Bootstrap Icons, Chart.js 4.4.3 | Lightweight dashboard visuals |
| Frontend logic | Vanilla JavaScript (ES2022) | No build step, no framework overhead |
| ML algorithms | Written from scratch in JS | Full control, transparency, teachable code |
| Backend | Node.js `node:http` | Native HTTP server, no dependencies |
| Database | `node:sqlite` (`DatabaseSync`) | Built-in SQLite, no native module compilation |
| Passwords | `node:crypto` scrypt (64-byte, per-user salt) | Memory-hard, timing-safe comparison |
| Sessions | Random 32-byte token in HttpOnly cookie | XSS-resistant, stored in `sessions` table |

---

## 5. Project Structure

```
machine-learning on SPPS/
├── server.js                  # Backend: server, auth, REST API, SQLite, inference
├── package.json               # npm start / npm run dev
├── README.md                  # Quick start + cloud deployment
├── DOCUMENTATION.md           # This file
├── index.html                 # (legacy) original browser-only version — not served
├── data/
│   └── spps.db                # SQLite database (auto-created on first run)
└── public/
    ├── index.html             # Application UI (login + 7 pages)
    ├── css/styles.css         # Design system (tokens, shell, components)
    └── js/
        ├── inference.js       # SHARED core: encoding, inference, explanation, advice
        ├── ml.js              # ML engine: preprocessing → splits → CV → models → metrics
        └── app.js             # UI controller, API client, rendering
```

---

## 6. Module Documentation

### 6.1 Frontend pages (`public/index.html`)

| # | Page | Purpose |
|---|---|---|
| — | **Login / Register** | Split-screen auth; demo credentials shown; validation errors inline |
| 1 | **Dashboard** | Stat cards (predictions, models, avg confidence, best accuracy), 14-day activity line chart, class-distribution doughnut, latest model card, recent predictions |
| 2 | **Dataset** | Upload CSV or load synthetic sample; preprocessing summary table; column profiling; target distribution; numeric histogram; η² feature-separation chart; data preview |
| 3 | **Train & Evaluate** | Split counts, one-click training, CV table, best-model card, metric cards, per-class table, confusion matrix, ROC curves, comparison bars, permutation importance |
| 4 | **Predict** | Model selector (from server), input form auto-generated from the model's preprocessing spec, API prediction, probabilities doughnut, explanation bars, recommendation cards, report download |
| 5 | **History** | Server-side records, detail modal (inputs/probabilities/why/advice), delete one / clear all, CSV export |
| 6 | **Saved models** | Cards with accuracy/F1/AUC, *Predict* shortcut, JSON download, delete |
| 7 | **Admin panel** | Platform stats, user table with per-user counts, recent predictions across all users (role-restricted) |

### 6.2 Backend (`server.js`)

| Concern | Location | Notes |
|---|---|---|
| DB bootstrap | `server.js:24-70` | WAL mode, 4 tables, indexes, admin seed, expired-session cleanup |
| Password hashing | `server.js:74` | `scryptSync(password, salt, 64)` hex |
| Sessions | `server.js:95-111` | Token created on login/register, read from `sid` cookie, 7-day expiry |
| Router | `server.js:174-181` | Pattern compiler supports `:params` |
| Rate limiting | `server.js:166` | 10 failed logins / 10 min / IP+email |
| Static files | `server.js:399` | Path-traversal guard (`startsWith(PUBLIC)`), MIME map, SPA fallback |
| Security headers | `server.js:133` | `nosniff`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy` |

### 6.3 ML engine (`public/js/ml.js`)

| Step | Function | Line |
|---|---|---|
| Sample data generator (800 rows, seeded) | `makeSample()` | `ml.js:27` |
| CSV parse / export | `parseCSV()` / `toCSV()` | `ml.js:48` |
| Preprocessing fit + audit report | `fitPre()` | `ml.js:67` |
| Profiling & η² separation | `profile()` | `ml.js:107` |
| Stratified 70/15/15 split | `stratifiedSplit()` | `ml.js:163` |
| Stratified k-fold | `kFoldStratified()` | `ml.js:180` |
| Logistic Regression (early stopping) | `trLR()` | `ml.js:197` |
| Naive Bayes (Gaussian) | `trNB()` | `ml.js:236` |
| Decision Tree (CART, Gini) | `buildTree()` | `ml.js:250` |
| Random Forest (30 trees) | `trRF()` | `ml.js:286` |
| Classification metrics | `metrics()` | `ml.js:305` |
| ROC curves + AUC | `rocAuc()` | `ml.js:332` |
| Full workflow orchestrator | `trainPipeline()` | `ml.js:372` |

---

## 7. Machine Learning Methodology

### 7.1 Data cleaning
- Rows with missing/empty target are dropped.
- Exact duplicate rows are removed.
- Target must have 2–15 distinct classes and ≥ 40 usable rows, otherwise training aborts with a clear error.

### 7.2 Preprocessing (`fitPre`, `ml.js:67`)
Per column (excluding target):

| Detected type | Rule | Action |
|---|---|---|
| Numeric | ≥ 90 % of values parse as numbers | Impute missing with **median**, standardize **z = (x − μ) / σ** |
| Categorical | otherwise, ≤ 30 unique values | Impute missing with **mode**, **one-hot encode** (k levels → k columns) |
| Rejected | \> 30 unique values (ID/name-like) | Dropped, listed in the summary as *Skipped* |

All statistics (mean, std, median, mode) are **fitted on the training fold only**
(`trainPipeline`, `ml.js:391`) to prevent data leakage, then reused unchanged for
validation, test and future predictions.

The **preprocessing summary table** in the UI shows, for every column: detected type,
missing-cell count, action taken and key statistics — satisfying the
“data preprocessing summary” requirement.

### 7.3 Splitting (`stratifiedSplit`, `ml.js:163`)
Stratified (per-class) shuffle with a fixed seed → **70 % train / 15 % validation / 15 % test**.
- **Train** — fit model + preprocessing, run cross-validation.
- **Validation** — Logistic Regression early stopping; per-model validation accuracy for the results table.
- **Test** — touched **once**, after model selection, for the headline metrics (no test-set peeking).

### 7.4 Cross-validation (`kFoldStratified`, `ml.js:180`)
5-fold stratified CV is run **inside the training set** for every algorithm
(`trainPipeline`, `ml.js:400`): mean ± standard deviation of CV accuracy and CV macro-F1.
The model with the highest mean CV macro-F1 wins.

### 7.5 Algorithms (all implemented from scratch)

| Model | Idea | Key implementation details |
|---|---|---|
| **K-Nearest Neighbors** | Majority vote of k = 5 closest training points | Euclidean distance on the standardized vector |
| **Logistic Regression** | Softmax regression, gradient descent | 300–400 epochs, L2 = 0.001, learning rate 0.4, **early stopping** on validation log-loss checked every 25 epochs (best weights kept) |
| **Naive Bayes** | Gaussian likelihood per feature | Priors with Laplace-style smoothing, variance + 1e-2 for stability |
| **Decision Tree** | CART with Gini impurity | Max depth 6, ≤ 12 split candidates per feature, min leaf 2 |
| **Random Forest** | Bootstrap ensemble of trees | 30 trees, depth 8, `mtry = ⌈√D⌉` random feature subsets |

Probability function for each model lives in `inference.js:58` (`proba`) and is shared
by training evaluation (browser) and production prediction (Node server).

### 7.6 Evaluation metrics (`metrics`, `ml.js:305`)

```
Accuracy  = TP+TN / N
Precision = TP / (TP+FP)          Recall = TP / (TP+FN)
F1        = 2·Precision·Recall / (Precision+Recall)
Macro     = unweighted mean over classes      Weighted = support-weighted mean
Confusion matrix C[i][j] = actual class i predicted as class j
```

Reported on the **test set**: overall accuracy, macro precision/recall/F1, weighted F1,
per-class table (precision, recall, F1, support) and the confusion matrix.

### 7.7 ROC-AUC (`rocAuc`, `ml.js:332`)
- **One-vs-rest** curve per class: sort by predicted probability, sweep thresholds,
  integrate TPR vs FPR with the trapezoidal rule.
- **Macro AUC** = mean of per-class AUCs; **micro AUC** = AUC over all flattened
  one-vs-rest pairs. Both are shown, plus a ROC chart with one line per class and a
  dashed micro-average line.

### 7.8 Feature importance (`trainPipeline`, `ml.js:449`)
Permutation importance on the test set: each feature column is randomly shuffled
3× and the resulting drop in macro-F1 is recorded. Higher drop = more important.
Displayed as a horizontal bar chart.

### 7.9 Prediction explanation (`explain`, `inference.js:102`)
Leave-one-feature-out contribution: the model's probability for the predicted class is
recomputed with one feature replaced by its training baseline (mean / mode). The change
in probability is that feature's contribution:

```
contribution(f) = P(predicted | all features) − P(predicted | f replaced by baseline)
```

Category features replace all their one-hot columns together (via `layout()`,
`inference.js:20`). Results are shown as signed bars: **green = pushed the prediction up,
red = pulled it down**.

### 7.10 Student recommendations (`recommend`, `inference.js:130`)
Rule engine over the raw inputs and the training statistics, producing prioritized
(`high / medium / low / good`) cards: study hours vs. median, attendance < 80 %,
previous marks < 50, assignment score < 60, sleep outside 6–9 h, > 4 h recreational
internet, low parental support, extracurricular-vs-study conflict, plus a class-level
headline (high-risk / on-track / maintain).

---

## 8. Database Design

```sql
users        (id PK, name, email UNIQUE, password_hash, salt, role, created_at)
sessions     (token PK, user_id FK, expires_at, created_at)
models       (id PK, user_id FK, name, target, algorithm, metrics JSON,
              preprocessing JSON, classes JSON, model JSON, n_rows, created_at)
predictions  (id PK, user_id FK, model_id FK, input JSON, prediction,
              confidence, probabilities JSON, explanation JSON,
              recommendations JSON, created_at)
```

Indexes: `predictions(user_id)`, `models(user_id)`.
Stored as JSON **text** columns for schema flexibility (feature sets vary per model).
The database file is created automatically at `data/spps.db` (override with `DB_PATH`).

**Seed data:** on first local run an admin row is created —
`admin@spps.local / admin123`. In production, set `ADMIN_PASSWORD` to a unique
password of at least 12 characters; the local demo password is never used.
`ADMIN_EMAIL` optionally overrides the seeded admin email.

---

## 9. REST API Reference

Base URL: `http://localhost:3000` · All bodies are JSON · Auth = `sid` HttpOnly cookie
· Errors: `{ "error": "message" }` with proper HTTP status.

### Authentication

| Method | Path | Auth | Body | Response |
|---|---|---|---|---|
| POST | `/api/auth/register` | — | `{name, email, password}` | `201 {user}` + sets cookie |
| POST | `/api/auth/login` | — | `{email, password}` | `200 {user, message}` + sets cookie |
| POST | `/api/auth/logout` | session | — | `200 {message}`, clears cookie |
| GET | `/api/auth/me` | session | — | `200 {user}` / `401` |

Validation: name ≥ 2 chars, RFC-like email regex, password ≥ 6 chars, duplicate email → `409`.
Login is rate-limited (10 attempts / 10 min / IP+email → `429`).

### Application

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/dashboard` | user | Totals, class distribution, 14-day activity, recent 5, latest model |
| GET | `/api/models` | user | Own models (metrics parsed, no heavy payload) |
| POST | `/api/models` | user | Save trained model `{name,target,algorithm,metrics,pre,classes,model,nRows}` → `201 {id}` |
| GET | `/api/models/:id` | owner | Full model incl. preprocessing (used to build the input form) |
| GET | `/api/models/:id/export` | owner | `Content-Disposition: attachment` JSON file (`.spps-model.json`) |
| DELETE | `/api/models/:id` | owner | Delete model |
| POST | `/api/predict` | user | `{modelId, input}` → **server-side inference**: `{id, prediction, target, confidence, probabilities, explanation, recommendations, createdAt}` + row in `predictions` |
| POST | `/api/predict/batch` | user | `{modelId, rows[], save?}` → up to **500 rows**; `{count, results[], saved?}`; `save: true` appends each result to history |
| GET | `/api/history` | user | Own history, joined with model name. Query: `q` (search inputs/prediction/model), `prediction` (class filter), `page`, `limit` (5–100) → `{history, total, page, pages, limit, counts}` |
| DELETE | `/api/history/:id` | owner | Delete one entry |
| DELETE | `/api/history` | user | Clear own history |
| PUT | `/api/account` | user | `{name}` (≥ 2 chars) → `200 {user}` |
| POST | `/api/account/password` | user | `{currentPassword, newPassword}` (≥ 6); on success **logs out all other sessions** |
| GET | `/api/account/sessions` | user | Active sessions: `{id, createdAt, ip, lastSeen, current}` + `{count}` |
| DELETE | `/api/account/sessions` | user | Log out every session except the current one |
| DELETE | `/api/account` | user | `{password}` required; deletes own account + models + predictions + sessions |

### Admin (role = `admin`, otherwise `403`)

| Method | Path | Response |
|---|---|---|
| GET | `/api/admin/stats` | `{users, predictions, models, today, avgConfidence}` |
| GET | `/api/admin/users` | All users with per-user prediction/model counts |
| GET | `/api/admin/predictions` | Last 100 predictions platform-wide with user name/email |
| DELETE | `/api/admin/users/:id` | Deletes that user **and all their data** (models, predictions, sessions). Blocks deleting yourself → `400` |

**Example — predict from any HTTP client:**

```bash
curl -c c.txt -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@spps.local","password":"admin123"}'

curl -b c.txt -X POST http://localhost:3000/api/predict \
  -H "Content-Type: application/json" \
  -d '{"modelId":1,"input":{"study_hours":8,"attendance":92,"previous_marks":78,
       "assignment_score":85,"sleep_hours":7,"internet_hours":2,
       "parental_support":"High","extracurricular":"Yes"}}'
```

---

## 10. Authentication & Security

| Measure | Implementation |
|---|---|
| Password storage | scrypt (64-byte key, 16-byte random salt per user), never stored/reversed |
| Comparison | `crypto.timingSafeEqual` (constant time) |
| Sessions | 32-byte random token, server-side `sessions` row, 7-day expiry, deleted on logout |
| Cookie | `HttpOnly` (not readable by JS → XSS protection) + `SameSite=Lax` + `Path=/` |
| Rate limiting | 10 failed logins per 10 minutes per IP+email |
| Authorization | Every query filtered by `user_id`; admin routes check `role` |
| Path traversal | `path.normalize` + `startsWith(PUBLIC)` check → `403` |
| Headers | `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy` |
| Payload limits | 30 MB JSON body cap, invalid JSON → 400/500 handled |
| XSS | All dynamic UI output passed through `esc()` in `app.js` |

---

## 11. UI / UX Design

**Design tokens** (`css/styles.css`): indigo→violet brand gradient (`#4f46e5 → #7c3aed`),
slate ink `#0f172a`, background `#f1f5f9`, 14 px card radius, layered soft shadows,
“Segoe UI / system-ui” type scale.

**Patterns used**

- **Auth screen** — two-column hero (value proposition + feature bullets) and a focused
  form card with inline error alerts and a demo-credentials chip.
- **App shell** — fixed top bar with user dropdown (profile, role badge, logout) and a
  dark fixed sidebar with numbered ML workflow steps (`1 · Dataset → 2 · Train → 3 · Predict`);
  collapses to a horizontal scrollable strip on mobile.
- **Progressive disclosure** — pages show helpful empty states and alerts until data/model exist.
- **Feedback** — toast notifications (success/error), full-screen loader with live training
  status + progress bar, disabled buttons while busy, highlight of the winning model row.
- **Data density** — striped/hover tables inside scrollable wrappers, metric cards,
  chip-style badges (green/amber/red) for classes and warnings.
- **Accessibility** — labelled inputs, `required` fields, keyboard-reachable controls,
  responsive breakpoints at 992 px.
- **Report** — downloadable standalone HTML report (printable to PDF with Ctrl+P).

**Step-by-step user journey**

1. Register or log in → **Dashboard** shows your stats.
2. **Dataset** → upload CSV *or* click *Use sample dataset* → inspect preprocessing + charts → pick target.
3. **Train** → click *Train all models* → watch live status → read CV table, metrics, ROC, importance
   → the model is **saved to the server automatically** (badge confirms model #id).
4. **Predict** → choose model → fill the generated form → *Predict via API* → read the result,
   probability chart, **why** section and **recommendations** → download report.
5. **History / Models** → review, export CSV, download model JSON, re-use a model.
6. **Admin** (admin account only) → platform-wide users and predictions.

---

## 12. Testing & Quality Assurance

### 12.1 Automated API test (Node, 34 assertions)
Static files · path-traversal blocked · register/login/logout · session invalidation ·
validation errors · bad-password rejection · model save/list/get/export/delete ·
prediction with explanation & recommendations · history delete/clear · dashboard ·
admin stats/users/predictions · admin route blocked for normal users.

### 12.2 ML engine test (headless Node)
Sample dataset → full pipeline → split integrity, CV for all 5 algorithms, metric
correctness against hand-computed values, ROC-AUC sanity, explanation and
recommendation output.

### 12.3 Browser E2E test (headless Chrome, real UI, 34 checks)
Full journey: boot → login form → app shell → all 7 pages → sample dataset →
preprocessing tables → training → CV table → metrics → model saved badge →
prediction form → API result → explanation → recommendations → history → modal → model card.

**Result: 33/34 PASS** (the single reported failure was a wrong test expectation —
the dashboard correctly showed 0 predictions at that moment because the account was new).

### 12.4 Bug found & fixed during testing
`rocAuc()` passed the whole probability **row** instead of the class **column**, so every
AUC collapsed to 0.5. Fixed in `ml.js:332`; re-verified: macro AUC **0.968** with 89.3 %
test accuracy (perfect-separation sanity case now returns 1.00 / 1.00).

### 12.5 Observed results (sample dataset, 500 rows)

| Metric | Value |
|---|---|
| Split | 350 train / 75 validation / 75 test |
| Best model (5-fold CV) | Logistic Regression (CV macro-F1 0.764) |
| Test accuracy | 89.3 % |
| Test macro-F1 | 0.895 |
| ROC-AUC (macro / micro) | 0.968 / 0.974 |
| Top features | study_hours, previous_marks, assignment_score, attendance |

*(Numbers vary slightly with dataset and sample size.)*

---

## 13. Running & Deployment

```bash
npm start                 # production: http://localhost:3000
npm run dev               # auto-restart on file changes (node --watch)
```

Environment variables: `PORT` (default 3000), `HOST`, `DB_PATH`,
`ADMIN_EMAIL`, and `ADMIN_PASSWORD` (required in production; minimum 12 characters).

Cloud (no dependencies) — details in `README.md`:
**Render** (Blueprint + paid persistent disk at `data/`), **Railway** (`railway up` + volume),
**Fly.io** (`fly launch` + volume, `DB_PATH=/data/spps.db`), or **any VPS** behind nginx/Caddy.

---

## 14. Limitations & Future Scope

**Limitations**
- Training runs in the browser, so very large datasets (> ~50 k rows) will be slow.
- KNN stores the training matrix inside the model JSON (larger exports).
- Single-node SQLite — not intended for high-concurrency write workloads.
- Session cookie is not marked `Secure` (add it when serving over HTTPS behind a proxy).

**Future scope**
- Python (scikit-learn) microservice for training; XGBoost/deep models.
- AutoML: hyperparameter search, class-imbalance handling (SMOTE), regression targets.
- Real-time dashboards (WebSocket), multi-tenant classes/teachers, CSV bulk prediction.
- JWT/API keys for external integrations, Docker image, CI pipeline with unit tests.

---

## Appendix A — Key function index

| File:Line | Symbol | Role |
|---|---|---|
| `server.js:74` | `hashPassword` | scrypt hashing |
| `server.js:103` | `getUser` | Session → user resolution |
| `server.js:173` | `on()` | Route registration with `:param` support |
| `server.js:304` | `POST /api/predict` | Server-side inference endpoint |
| `server.js:399` | `serveStatic` | Static files + traversal guard |
| `public/js/inference.js:35` | `enc` | Row → standardized/one-hot vector |
| `public/js/inference.js:58` | `proba` | Class probabilities for all 5 models |
| `public/js/inference.js:102` | `explain` | Leave-one-feature-out explanation |
| `public/js/inference.js:130` | `recommend` | Prioritized student advice |
| `public/js/ml.js:67` | `fitPre` | Preprocessing fit + audit report |
| `public/js/ml.js:305` | `metrics` | Accuracy/P/R/F1/confusion |
| `public/js/ml.js:332` | `rocAuc` | ROC curves + macro/micro AUC |
| `public/js/ml.js:372` | `trainPipeline` | Full workflow orchestrator |
| `public/js/app.js:43` | `api` | Fetch wrapper (JSON, cookie, 401 handling) |
| `public/js/app.js:60` | `showApp` | Post-login shell activation |
| `public/js/app.js:307` | `renderTrain` | Training results rendering |
| `public/js/app.js:392` | `saveModelToServer` | Model persistence |
| `public/js/app.js:459` | `renderResult` | Prediction + explanation + advice UI |
