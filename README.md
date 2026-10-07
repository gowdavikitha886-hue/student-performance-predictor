# SPPS — Student Performance Prediction System

Full-stack ML web app: **HTML/CSS/JS frontend + Node.js REST API + SQLite database**.
Zero npm dependencies — Node 22.5+ only.

## Run

```bash
npm start          # or: node server.js
```

Open **http://localhost:3000**

| Account | Password | Role |
|---|---|---|
| `admin@spps.local` | `admin123` | local demo admin (admin panel) |
| Register any new email | your own | user |

Production deployments require `ADMIN_PASSWORD` to be set to a unique password
of at least 12 characters. The local demo password is never used in production.

## Features

- **Login / register / logout** — scrypt-hashed passwords, HTTP-only session cookies, login rate-limiting, admin role gate
- **Data preprocessing summary** — per-column: numeric → median impute + z-score, categorical → mode impute + one-hot, ID-like columns dropped (no leakage: stats fit on the training fold only)
- **Train / Validation / Test split** — stratified 70/15/15
- **5-fold stratified cross-validation** — model selection by CV macro-F1; test set scored once
- **Metrics** — accuracy, per-class + macro/weighted precision, recall, F1, confusion matrix
- **ROC-AUC** — one-vs-rest curves per class + micro-average
- **Visualization dashboard** — target distribution, numeric histograms, feature separation (η²), prediction trends
- **5 algorithms from scratch** — KNN, Logistic Regression (early stopping), Naive Bayes, Decision Tree, Random Forest
- **Real backend API** — model saved to DB, inference executed by `POST /api/predict`
- **Prediction explanation** — leave-one-feature-out effect on the predicted-class probability
- **Student recommendations** — rule-based, prioritized advice per student profile
- **Prediction history in SQLite** — per-user, available on any device, CSV export, detail modal
- **Model export** — `GET /api/models/:id` / `/:id/export` downloads deployable JSON
- **Admin dashboard** — users, predictions, models, today's activity
- **Report download** — standalone HTML report (Ctrl+P → PDF)
- **Account settings** — change display name, change password (verifies current password, logs out other sessions), active-session list, "log out other devices", delete own account with password confirmation
- **History search / filter / pagination** — server-side search, class filter, 10/25/50 per page, live counts
- **Batch prediction (CSV)** — upload ≤ 500 rows → `POST /api/predict/batch` → optional save to history → download results CSV
- **Ready-made example files** (`public/examples/`, linked in the UI) — `students-sample.csv` (60 rows, clean), `students-sample-missing.csv` (40 rows with blanks — shows imputation), `students-batch.csv` (10 rows for batch prediction)
- **Model leaderboard** — saved models compared on Accuracy / F1 / ROC-AUC
- **Dark mode** — theme toggle, remembered in `localStorage`
- **Admin user management** — delete any user together with their models and history

## API

```
POST   /api/auth/register | /login | /logout     GET /api/auth/me
GET    /api/dashboard
GET    /api/models        POST /api/models       GET /api/models/:id
GET    /api/models/:id/export    DELETE /api/models/:id
POST   /api/predict                 (server-side inference + explanation)
POST   /api/predict/batch           (≤ 500 rows, optional save-to-history)
GET    /api/history?q=&prediction=&page=&limit=
DELETE /api/history     DELETE /api/history/:id
PUT    /api/account                     (update display name)
POST   /api/account/password            (change password)
GET    /api/account/sessions            DELETE /api/account/sessions
DELETE /api/account                     (delete own account + data)
GET    /api/admin/stats | /admin/users | /admin/predictions   (admin only)
DELETE /api/admin/users/:id             (admin only — delete user + data)
```

## Deploy on Render

This repository includes a Render Blueprint (`render.yaml`) that configures the
Node service and a 1 GB persistent disk for SQLite. The paid Starter plan is
required for the disk; without it, the database would be lost on redeploy.

1. Push the repository to GitHub.
2. In the [Render Dashboard](https://dashboard.render.com), choose **New →
   Blueprint**, then select this repository.
3. When prompted, set `ADMIN_PASSWORD` to a unique password of at least 12
   characters. Do not commit or share this value.
4. Review the Starter plan and disk costs, then approve creation. Render builds
   with `npm install --omit=dev` and starts with `npm start`.

The seeded admin email defaults to `admin@spps.local`; set `ADMIN_EMAIL` in
Render if you prefer another login. SQLite is stored on the mounted disk at
`/opt/render/project/src/data/spps.db`.

**Any VPS**
```bash
npm start                       # behind a proxy, or
npx serve -s .  # static only — not needed, server.js serves static too
node server.js                  # then proxy with nginx/Caddy for TLS
```

## Project layout

```
server.js              REST API · auth · sessions · SQLite · static files · inference
public/index.html      UI (auth screen + 7-page app shell)
public/css/styles.css  design system
public/js/inference.js shared encode/predict/explain/recommend (browser + Node)
public/js/ml.js        preprocessing, splits, CV, algorithms, metrics, ROC-AUC
public/js/app.js       controller: auth, navigation, charts, all pages
data/spps.db           SQLite database (auto-created; not committed)
```
