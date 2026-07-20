# VMM Facility Complaint CRM — Process Documentation

## Overview
A facility complaint management system for Vishal Mega Mart (VMM) stores. Store employees raise complaints (AC, lift, electrical, etc.) which get logged, assigned a vendor, tracked through follow-up, and escalated via email until closure.

## Architecture
- **Frontend**: React + Vite app at `vmm-crm/`, deployed to GitHub Pages at **https://inder20216.github.io/crm-vmm/**
- **Repo**: https://github.com/inder20216/crm-vmm (only `vmm-crm/` is pushed — `VMM/Workflows/` stays local since it contains credential references)
- **Backend**: n8n — two instances:
  - Self-hosted (`automation.openmindhelpline.com`) — core CRM workflows (case logging, search, follow-up, dashboard, products/vendors lookup)
  - Cloud (`inder20216.app.n8n.cloud`) — email-related workflows
- **Data store**: MySQL (complaints, escalations, logs) + Google Sheets (master data: Stores, Employees, Products/Vendors, Email Templates)
- **Deploy command**: `npm run deploy` from `vmm-crm/` (builds + publishes to `gh-pages` branch)

## Modules (in the React app)
| Module | Route | Purpose |
|---|---|---|
| Dashboard | `/` | Stats overview |
| Case Logging | `/complaints/add` | Log a new complaint (store + employee search, product/vendor, quantity for multi-AC, warranty split) |
| Search | `/complaints/search` | Search/filter existing complaints |
| Email Complaints | `/complaints/email` | Fetch inbox, AI-parse complaint emails, log complaints, reply |
| Complaint Detail | `/complaints/:id` | View + update a single complaint |
| Follow-up | `/followup` | Agents work through complaints needing follow-up (Not Connected, Close, Update EDC) |
| Reports | `/reports` | Reporting |

## Case Logging — Vendor Assignment Logic
Vendor resolution depends on product type:
- **AC, Server Room AC** → auto-fetched from `AC-AMC` webhook (store-specific AMC vendor)
- **Lift, Escalator** → auto-fetched from `Lift-AMC` webhook
- **Sensormatic** → fixed vendor `Adtech` (no per-store variation)
- **Genset** → Kirloskar vs Other Brand (HO Direct) buttons
- **HO-Direct products** (~50 hardcoded names: fan, CCTV, lights, etc.) → no vendor, routed straight to Facility Manager
- **Fire safety products** → vendor optional, agent checks a sticker on the unit
- **Everything else** → vendor pulled from the `Product-vendor-HO` Google Sheet's `Vendor` column for that product
- The Vendor field is **always editable**, regardless of source — auto-fill never locks the field
- AC quantity field only appears for product name exactly `"AC"` (not Server Room AC, Air Curtain, etc.)
- Multiple AC units: per-unit Nature of Complaint override available (defaults to the main selection, but each unit can differ)
- Mixed AMC/Warranty split: separate Warranty Vendor dropdown (built from unique vendors in product list) when some units are under manufacturer warranty instead of AMC

## TAT & Closure
- TAT (days) comes from the `Nature of Complaint` master list, attached per nature/type
- EDC (Expected Date of Closure) = case logged date + TAT days
- Follow-up reminders trigger "Not Connected" escalation logging with auto-calculated new EDC (+3 days), tracked via `vmm_vendorescalations` table with escalation level

## Email Workflows
All 5 email-sending workflows are standardized on a **Gmail node + editable "Email Config" Set node** (fields: `TEST_MODE`, `TEST_TO`, `ALWAYS_CC`) — change recipients in the n8n UI, no code edits needed.

| Workflow | Trigger | Sends |
|---|---|---|
| `n8n_crm_02_send_escalation_email.json` | Case logged (React app) | Escalation email with complaint table to store/vendor |
| `n8n_email_outlook_all.json` ("Send Reply") | Agent replies to a complaint email | Reply to customer |
| `n8n_email_04_send_reply.json` | Same webhook path as above (**duplicate** — only one should be active) | Reply to customer |
| `n8n_email_01_capture_complaints.json` ("Reply with Complaint No") | New complaint auto-captured from inbound email | Auto-confirmation with complaint number |
| `n8n_04_not_connected.json` ("Send Reminder Email") | Follow-Up → "Not Connected" logged | Follow-up reminder with revised EDC |

**Important rule**: user-facing error messages must never mention internal tooling (n8n, OpenAI, etc.) — always generic wording ("Could not load data. Please try again.").

**`ALWAYS_CC`** is currently set to the Teams channel: `VMM Team <54933595.openmindservices.onmicrosoft.com@in.teams.ms>` on the escalation and follow-up workflows.

Two of the reply-sending workflows originally used Microsoft Graph's native "reply" operation, which **cannot redirect recipients** (Graph always replies to the original sender) — these were converted to Gmail-compose-based test redirection instead, with the original Outlook reply node kept in the file (renamed "...LIVE — disconnected") for easy reconnection when going live.

## Known Pending Items
- `TEST_MODE` is `true` on all 5 email workflows — flip to `false` when going live
- Gmail OAuth2 credential needs to be connected on every Gmail node (placeholder `REPLACE_WITH_GMAIL_CREDENTIAL_ID`)
- `n8n_email_outlook_all.json` and `n8n_email_04_send_reply.json` share the same webhook path (`vmm-send-email-reply`) — only one can be active in n8n at a time; which one is canonical hasn't been resolved
- GitHub Pages source must be set to `gh-pages` branch (not `main`) in repo Settings → Pages

## Key Files
- `vmm-crm/` — React app source
- `VMM/Workflows/*.json` — all n8n workflow exports (local only, not in git)
- `VMM/Workflows/01_Case_Logging.md` — original case logging field/process notes
