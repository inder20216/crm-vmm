# VMM CRM — Project Guide

## What this project is

VMM CRM is a complaint management system for Open Mind Group's VMM (Vendor Management & Maintenance) division. Store staff log equipment complaints (AC, CCTV, lifts, etc.), agents follow up with vendors, and the system tracks escalations and closures.

**Users:** CRM agents at Open Mind (call centre), store managers, facility managers, vendors.
**Deployed at:** `https://inder20216.github.io/crm-vmm/`

---

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | React + Vite, deployed to GitHub Pages |
| Core API | PHP REST (`vmm.openmindservices.in/webhook/`) — direct MySQL |
| Email workflows | n8n self-hosted (`automation.openmindhelpline.com`) |
| Cloud workflows | n8n cloud (`inder20216.app.n8n.cloud`) |
| Email sending | Microsoft Outlook via n8n VMM2 credential |
| Auth / Inbox | Microsoft MSAL — signed in as `inder@openmind.in` |
| Shared mailbox | `vmm.helpdesk@openmind.in` |
| SparkTG CTI | `https://telephonycloud.co.in/sparktg-iframe/` |
| Database | MySQL, table prefix `vmm_`, currently on `demo_vmm` |

---

## Environment variables

### `.env` (local dev)
```
VITE_PHP_BASE=https://vmm.openmindservices.in/webhook
VITE_AZURE_CLIENT_ID=23cc525a-0ef9-420f-b82d-b5be71d2caa1
VITE_AZURE_TENANT_ID=6fb82fad-19c7-41e5-b5e1-e7e1b02b0323
VITE_SHARED_MAILBOX=vmm.helpdesk@openmind.in
VITE_SPARKTG_WIDGET_URL=https://telephonycloud.co.in/sparktg-iframe/
```

### `.env.production` (GitHub Pages build)
```
VITE_PHP_BASE=https://vmm.openmindservices.in/webhook
VITE_API_BASE=https://automation.openmindhelpline.com/webhook
VITE_CLOUD_API_BASE=https://inder20216.app.n8n.cloud/webhook
VITE_SPARKTG_WIDGET_URL=https://telephonycloud.co.in/sparktg-iframe/
```

---

## API routing — where each call goes

All API calls are in `src/api/vmm.js`. Three base URLs:

### `PHP` → `vmm.openmindservices.in/webhook` — core DB operations
All complaint and reference data operations hit the PHP REST API directly on the MySQL database.

| Function | Endpoint |
|---|---|
| `lookupStore(code)` | `vmm-sp-store` |
| `lookupEmployee(code)` | `vmm-sp-employee` |
| `getProducts()` | `vmm-sp-products` |
| `getNatures()` | `vmm-sp-natures` |
| `getDelayReasons()` | `vmm-sp-delay-reasons` |
| `getVendors()` | `vmm-sp-vendors` |
| `getEscalationMatrix(params)` | `vmm-sp-escalation-matrix` |
| `logComplaint(data)` | `vmm-log-complaint` |
| `getComplaint(no)` | `vmm-get-complaint` |
| `getComplaintDetail(ref)` | `vmm-complaint-detail` |
| `updateComplaint(data)` | `vmm-update-complaint` |
| `escalateComplaint(data)` | `vmm-escalate-complaint` |
| `closeComplaint(data)` | `vmm-close-complaint` |
| `notConnected(data)` | `vmm-not-connected` |
| `updateEdc(data)` | `vmm-update-edc` |
| `getFollowUpComplaints()` | `vmm-followup-complaints` |
| `searchComplaints(params)` | `vmm-search-complaints` |
| `dashboardStats(params)` | `vmm-dashboard-stats` |
| `getRecentComplaints(code)` | `vmm-recent-complaints` |
| `getUserRole(email)` | `vmm-user-role` |
| `lookupCaller(mobile)` | `vmm-sparktg-inbound` |

### `BASE` → n8n self-hosted — email workflows only
| Function | Endpoint | Purpose |
|---|---|---|
| `sendCaseLogEmail(data)` | `vmm-email-case-log` | Email vendor + CC store/FM/HO on new complaint |
| `sendEscalationEmail(data)` | `vmm-email-escalate` | Reply to thread with escalation notice |
| `sendClosureEmail(data)` | `vmm-email-case-close` | Email store + FM on closure |
| `fetchInbox()` | `vmm-email-inbox` | Fetch shared mailbox inbox via VMM2 Outlook |
| `fetchThread(convId)` | `vmm-email-thread` | Fetch conversation thread |
| `searchSentEmail(no, date)` | `vmm-search-sent-email` | Search sent items by complaint number |
| `sendFollowupEmail(data)` | `vmm-send-followup-email` | Send/reply follow-up email |
| `polishRemarks(text)` | `vmm-ai-polish` | AI text improvement (OpenAI via n8n) |

### `CLOUD` → n8n cloud — attachments & templates
| Function | Endpoint |
|---|---|
| `fetchAttachments(msgId)` | `vmm-fetch-attachments` |
| `getEmailTemplates()` | `vmm-email-templates` |

---

## PHP REST API — server files

Located in `server/webhook/` — **upload these to `public_html/webhook/` on `vmm.openmindservices.in`** after any change.

| File | Purpose |
|---|---|
| `server/webhook/index.php` | Main router — handles all `vmm-*` endpoints |
| `server/webhook/.htaccess` | Apache rewrite — routes all paths to `index.php` |

The PHP file includes `../common/constraints/dbconfig.php` for DB credentials (already on the server, never in git).

**Current test line in `index.php`** (line ~28):
```php
mysqli_select_db($db, 'demo_vmm'); // TEST MODE — remove when going live
```
Remove this line when switching to production database.

---

## n8n Email Workflows

All 3 email workflows are in `VMM/Workflows/` (gitignored — share directly, never commit).

| File | Webhook path | Sends to | TEST_MODE |
|---|---|---|---|
| `n8n_email_03_case_log.json` | `vmm-email-case-log` | Vendor (To), Store+FM+HO (CC) | ✅ true |
| `n8n_email_04_case_close.json` | `vmm-email-case-close` | Store (To), FM (CC) | ✅ true |
| `n8n_email_05_escalate.json` | `vmm-email-escalate` | Vendor (To), Store+FM+HO (CC) | ✅ true |

**TEST_MODE = true** means all emails go to `inder@openmindserviceslimited.in` only.
Flip `TEST_MODE = false` in each workflow's Code node to go live.

Case Log + Escalate: if `messageId` is in the payload → replies on the existing thread. Otherwise sends new email.

n8n credential used for sending: **VMM2** (`id: ZaZUH3dJiLPRt7BX`) — Microsoft Outlook.

---

## Microsoft / Graph API

- Azure App: Client ID `23cc525a-0ef9-420f-b82d-b5be71d2caa1`, Tenant `6fb82fad-19c7-41e5-b5e1-e7e1b02b0323`
- Signed-in account: `inder@openmind.in`
- Shared mailbox: `vmm.helpdesk@openmind.in`
- **Important:** `vmm.helpdesk@openmind.in` has no Azure AD user object — Graph API `/users/{email}/mailFolders` returns 404 for it. Inbox is fetched via n8n VMM2 Outlook credential instead, not Graph API directly.
- Sent tab currently uses `graph.fetchSent()` — also broken for the same reason. Pending fix via n8n `vmm-search-sent-email` workflow.

---

## Complaint workflow (business logic)

```
Log Complaint → vendor email sent (n8n)
     ↓
Follow-up calls → Update Complaint (PHP) — logs each contact attempt
     ↓
Not resolving? → Escalate (PHP) → escalation email to vendor + CC (n8n)
     ↓
Vendor confirms fix → Close Complaint (PHP) → closure email to store + FM (n8n)
```

**TAT:** Varies by product/vendor — stored in escalation matrix (`vmm_levelofescalation`).
**Escalation levels:** L1 → L2 → L3 → L4, each with different email recipients from the matrix.
**Closure types:** Closed / Partially Closed (if Partially Closed, new EDC is set).

---

## Database

- **Current:** `demo_vmm` (test)
- **Production:** ask before switching — remove the `mysqli_select_db($db, 'demo_vmm')` line in `index.php`
- **Table prefix:** `vmm_`
- **Key tables:**

| Table | Purpose |
|---|---|
| `vmm_complaints` | One row per complaint |
| `vmm_complaintstores` | Store/employee snapshot at time of logging |
| `vmm_complaintlogs` | Every follow-up action (status history) |
| `vmm_vendorescalations` | Escalation records with EDC and ticket numbers |
| `vmm_products` | Product master |
| `vmm_stores` | Store master |
| `vmm_employees` | Employee master |
| `vmm_vendors` | Vendor master |
| `vmm_vendorproducts` | Vendor–product mapping |
| `vmm_levelofescalation` | Escalation matrix per vendor-product |
| `vmm_users` | CRM user accounts with roles |
| `vmm_natureofproblem` | Nature of problem dropdown |
| `vmm_delayreasons` | Delay reason master |
| `vmm_subdelayreasons` | Sub-reason master |

Complaint number generated by stored procedure: `CALL generateReferenceNo(@lastid)`.

---

## Collaboration rules

### Branch workflow
- `main` is protected — no direct pushes. Every change goes through a PR.
- Branch naming: `fix/short-description` or `feat/short-description`
- Always `git pull origin main` before starting new work

### What is gitignored (never commit these)
- `VMM/` — all n8n workflow JSONs (contain API keys). Share via WhatsApp/Drive.
- `.env` — local dev credentials
- `dist/` — built files (exception: force-added for GitHub Pages deploy)

### Deploying to GitHub Pages
```bash
npm run build
git add -f dist/
git commit -m "Deploy: description"
git push
```
GitHub Actions picks up the push and deploys automatically.

---

## Critical rules — read before making any change

1. **Never change working things that weren't asked about.** A targeted fix only.
2. **Never expose backend names in user-facing errors** — no "n8n", "OpenAI", "MySQL" etc. in toasts or UI messages.
3. **`VMM/Workflows/` files must never be committed to git** — they contain API credentials.
4. **`PSRI/Workflows/` same rule** — also gitignored.
5. **Test on `demo_vmm` first** — do not switch to production DB without explicit instruction.
6. **Email TEST_MODE stays true** until explicitly told to flip it.
