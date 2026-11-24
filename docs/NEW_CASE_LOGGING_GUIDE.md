# New Case Logging Guide — VMM CRM

**Page:** `New Case` → `Facility Complaint — VMM`
**Dev URL:** `http://localhost:5173/crm-vmm/complaints/add`

The form has one identification block at the top, a **9-step inline workflow**, an optional
**AC multi-unit** section, and a **confirm-before-submit** modal. Categories, products,
natures and vendors come from live SQL reference data — wait for
"Loading product and nature lists from SQL…" to disappear before filling the form.

### Adding an option that is not in the list
The Product, Category, Complaint nature and Vendor dropdowns include **➕ Add new…**.
Selecting it opens an inline value box; press **Enter** or **Add** to create and select
the value immediately. New natures are saved to the master sheet so they also appear in
Settings, Email Inbox and reports. Products, categories and vendors are remembered in
this browser until a master-data entry exists. The Warranty dropdown intentionally stays
fixed to the three portal statuses (`Under Warranty`, `Under AMC`, `Not Applicable`).

---

## 0. Identify Complainant & Store (above the workflow)

Both **store** and **employee** details are mandatory.

1. Use the single **smart search** box. Accepts any one of:
   - employee code (e.g. `6071291`)
   - store code (e.g. `HV24`)
   - 10-digit mobile number (e.g. `9140213091`)
2. Search starts automatically after 4 characters (600 ms pause), or press **Enter** /
   click **Search**.
3. If the store is found but the employee is not, a warning appears — search again with
   the employee code or mobile to complete the complainant details.
4. The **confirmation card** shows Store Details (code, name, city, region/zone, state,
   FM, manager, ASM) and Complainant Details (code, name, designation).
5. Enter / verify the **10-digit Contact Number** in the confirmation card.
6. If the store has a previous SQL complaint, empty fields are auto-filled from the
   latest complaint and a green review notice is shown. Always review auto-filled values.

---

## 1–9. Complaint Workflow (9 steps, shown one after another)

Store and employee verification is done once by the smart search above; the workflow
starts directly with the case details.

### Step 1 — Product
Click the field to open the dropdown. It lists **all products** (duplicates collapsed);
use the **search box inside the dropdown** to filter by product name.
Selecting a product:
- sets the category in Step 2 automatically,
- decides which natures are shown in Step 3,
- applies the special routing rules in the table below.

### Step 2 — Category
Dropdown of categories from the live SQL product list. This is **auto-selected from the
product chosen in Step 1** and locked; a green note confirms the source. To change the
category, choose a different product in Step 1.

### Step 3 — Complaint
Select **Nature of Complaint** from the live SQL list. This also sets the complaint
**type** and **TAT (days)**, which drives the Expected Date of Closure (EDC).
Temperature-related natures appear **only** for `AC` and `Server Room AC`.

### Step 4 — Warranty
Choose one of exactly three options:

| Option | Meaning |
|---|---|
| `Under Warranty` | Manufacturer warranty is active — choose a brand in Step 5. |
| `Under AMC` | Annual Maintenance Contract is active — vendor comes from the store AMC record. |
| `Not Applicable` | Warranty/AMC expired or never existed. If unsure, pick this — the team verifies during inspection. |

Special products (Sensormatic, HO-direct items, Genset, fire products) **skip** this step;
a portal-rule message is shown instead.

### Step 5 — Vendor
What you see depends on the product and the warranty choice:

| Situation | Vendor UI / result |
|---|---|
| **Sensormatic** | Auto-assigned `Adtech`; no input needed. |
| **HO-direct products** (CCTV, baggage rack, lights, chairs, civil work, etc.) | No vendor required — routed to HO / Facility Manager. |
| **Genset** | Buttons: `Kirloskar` or `Other brand (HO)`. Other sets `N/A — HO Direct`. |
| **Fire products** | Optional "sticker vendor" text field. |
| **Under Warranty** | Brand dropdown from the product→brand map (e.g. AC = Blue Star, Carrier, Hitachi, Mitsubishi). The search box filters the brands. `None of the above` sets `N/A — HO Direct`; an optional brand name can be typed and is added to Remarks as `Brand info: …`. |
| **Under AMC — AC / Server Room AC** | Store-wise vendor from live `vmmdb.vmm_amc_vendors` (`AC AMC`) is **auto-filled and selected** in the dropdown; a green message confirms it. You can still change it manually. If the store has no mapped vendor, the message says so. |
| **Under AMC — Lift / Escalator** | Same behaviour using the live `Lift AMC` rows for that store. |
| **Under AMC — Pest Control** | Same behaviour using the live `Pest Control AMC` rows for that store. |
| **Under AMC — all other products** | Full live SQL vendor dropdown (searchable) **plus** a manual entry field. |
| **Not Applicable** | Full live SQL vendor dropdown (searchable) **plus** a manual entry field (or type `NA`). |

Changing the warranty selection always clears the previous vendor value.

### Step 6 — Location
Free-text location, e.g. `Ground Floor near lift`. **Required.**

### Step 7 — Photos / files
- One file input; accepted formats: **JPG, JPEG, PNG, PDF** (multiple files allowed).
- Mandatory when the complaint type is `Breakdown` or `Repair`.
- If no image exists, tick **"No image available / will be shared later"** — this hides the
  file input and satisfies the mandatory rule.

### Step 8 — Remarks
Describe the problem. English or Hinglish is fine.
Click **✦ AI Polish** to rewrite the text professionally using the live `vmm-ai-polish`
endpoint. If the service is unavailable the original text is kept.

### Step 9 — Review
Summary of Type, Category, Product, Warranty, Vendor, Brand info (if any), Location,
Attachments and Remarks. Check it before submitting.

---

## AC multi-unit section (only when Product = `AC`)

Shown below the workflow card.

1. **Number of AC Units** — choose 1–10 with the buttons or type a custom count up to 20.
   Each unit gets its own complaint number.
2. If count > 1, choose **how many are under warranty**. The rest are logged as regular
   complaints. Warranty units automatically use the AC-Warranty nature and TAT.
3. If warranty units exist, choose the **Warranty Vendor** (manufacturer handling the
   claim) or leave it at "Same as AMC vendor".
4. **Unit Details** — for each unit, optionally set a different location and/or nature;
   blank fields inherit the main values. These appear in the escalation email.

---

## Submit

1. Click **Log Case →** (or **Log N Cases →**).
2. Validation runs. All of these are required:
   - valid store code + name
   - valid employee code + name
   - 10-digit contact number
   - product
   - nature of complaint
   - warranty status (unless auto-routed)
   - vendor where the selected mode requires it
   - location
   - remarks
   - attachment unless "No image available" is ticked (Breakdown / Repair)
3. **Confirm before logging** modal appears. It shows:
   - a warning if a similar complaint for the same store + product exists in the last 7 days,
   - the full detail summary (including unit split),
   - resolved escalation **To / CC** recipients, with optional extra **To** and **CC** emails.
      The **To** address is chosen automatically: a manually entered vendor email wins,
      then the store-wise AMC row for the product, then the OEM escalation matrix.
      If none resolves, the email falls back to the Facility Manager (when available).
4. Click **Confirm — Log Case** to post the complaint(s).
   - One complaint is logged per unit.
   - One consolidated escalation email is sent for all units.
5. Success screen shows the complaint ID(s), store, complainant, product, type, TAT and EDC.
   Use **Log New Case** to start over.

**Clear Form** resets all steps and state without submitting.

## Email Inbox — automatic missing-details request

When an incoming email is parsed and required details are still missing, the CRM
automatically replies on the original thread to the client sender, keeps the
original CC list, and marks the email **Awaiting Info** in the WIP list. No
complaint is logged from that email until the client replies and it is re-parsed.

The automatic reply lists the exact missing fields (for example store code,
product name, nature of complaint, contact number) and is sent only once per
conversation. A hidden `VMM-MISSING-INFO` marker in the reply and a local
per-thread guard prevent repeated clarification emails if the email is parsed
again. Set `AUTO_MISSING_INFO_REPLY = false` in `EmailComplaints.jsx` to return
to the manual **Ask for Missing Info** draft flow.
