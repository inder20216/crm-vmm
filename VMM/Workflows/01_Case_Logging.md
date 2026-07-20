# VMM Workflow 01 — Case Logging

**Version:** Draft v1.1
**Date:** 2026-04-30
**Status:** Under Review
**Owner:** Open Mind Group — VMM Helpdesk

**Change from v1.0:** Complainant must be a registered member — lookup replaces manual entry for employee fields.

---

## 1. Purpose

Capture a new facility complaint raised by a store, assign it a unique Case ID, auto-calculate the Expected Date of Closure (EDC), and hand off to the Escalation workflow.

---

## 2. Trigger

A store employee contacts the VMM helpdesk (via call or any defined channel) to report a facility-related problem.

---

## 3. Actors

| Actor | Role |
|---|---|
| Store (Complainant) | Raises the complaint |
| VMM Agent | Receives complaint, logs the case in CRM |
| CRM System | Validates inputs, auto-calculates TAT & EDC, generates Case ID, triggers escalation |

---

## 4. Pre-conditions

- Store must be registered in the system (valid Store Code exists)
- **Complainant must be a registered member** in the system (valid Employee Code exists) — unregistered employees cannot raise a complaint
- Product and Vendor master data must be up to date in the system
- VMM Agent must be logged in with case-creation permissions

---

## 5. Step-by-Step Flow

```
Store contacts helpdesk
        │
        ▼
[Step 1] Agent opens New Case form in CRM
        │
        ▼
[Step 2] Agent captures Store Details
         - Store Code (lookup/search)
         - Store Name (auto-filled from Store Code)
        │
        ▼
[Step 3] Agent looks up Complainant by Employee Code
         - Agent enters Employee Code → system searches registered member master
         │
         ├── NOT FOUND → Case cannot be logged
         │              Agent informs caller: "You are not a registered member"
         │              Agent advises caller to contact [TBD — HR/Admin] to get registered
         │              Case logging STOPS here
         │
         └── FOUND ▼
         - Employee Name auto-fills from member record
         - Contact Number auto-fills from member record
         - Agent confirms details with caller (in case contact number has changed)
         - Agent can update contact number for this case only (does not update master)
        │
        ▼
[Step 4] Agent selects Product Name (from master list)
         - Vendor Name auto-fills based on product-vendor mapping
         - Agent can override Vendor if no mapping exists
        │
        ▼
[Step 5] Agent selects Nature of Complaint (dropdown)
         - System auto-sets Complaint Type (Breakdown/Repair/Maintenance/Requirement)
         - System auto-sets TAT Days
        │
        ▼
[Step 6] Agent enters Product Location in Store
        │
        ▼
[Step 7] Agent attaches images/files (see attachment rules below)
        │
        ▼
[Step 8] Agent reviews all fields and submits
        │
        ▼
[Step 9] System runs validations (see Section 7)
         │
         ├── FAIL → Show errors, return to form
         │
         └── PASS ▼
[Step 10] System creates the case:
          - Generates unique Case ID
          - Sets Status = Open
          - Records Case Logging Date & Time
          - Calculates EDC = Logging Date + TAT Days
          - Saves Vendor Ticket Number field (blank, to be filled later)
        │
        ▼
[Step 11] System triggers → Escalation Workflow (Workflow 02)
        │
        ▼
CASE LOGGED ✓
```

---

## 6. Case Fields

### 6.1 Mandatory Fields

| Field | Input Type | Source |
|---|---|---|
| Store Code | Search / Lookup | Store master |
| Store Name | Auto-fill | From Store Code |
| Employee Code | Search / Lookup | Registered member master |
| Employee Name | Auto-fill (read-only) | From registered member record |
| Contact Number | Auto-fill / Editable for this case | From registered member record |
| Product Name | Dropdown | Product master |
| Vendor Name | Auto-fill / Override | Product-Vendor mapping |
| Nature of Complaint | Dropdown | Predefined list |
| Complaint Type | Auto-fill (read-only) | From Nature of Complaint |
| TAT Days | Auto-fill (read-only) | From Nature of Complaint |
| Product Location in Store | Text | Manual entry |

### 6.2 System-Generated Fields (no agent input needed)

| Field | Logic |
|---|---|
| Case ID | Auto-generated on save (format: TBD) |
| Case Logging Date | System timestamp (date only) |
| Case Logging Time | System timestamp |
| EDC (Expected Date of Closure) | Logging Date + TAT Days |
| Case Status | Default = Open |
| Logged By | Logged-in Agent |

### 6.3 Optional Fields (filled later)

| Field | When Filled |
|---|---|
| Vendor Ticket Number | After vendor raises their own ticket |
| Attachments | Mandatory for applicable complaint types (see 6.4) |

### 6.4 Attachment Rules

| Complaint Type | Attachment Required? |
|---|---|
| Breakdown | Mandatory |
| Repair | Mandatory |
| Maintenance | Optional |
| Requirement | Optional |

- Accepted formats: JPG, PNG, PDF
- Max file size: TBD
- Min 1 image required where mandatory

---

## 7. Validation Rules

| Field | Rule |
|---|---|
| Store Code | Must exist in Store master — reject unknown codes |
| Employee Code | Must exist in registered member master — case cannot be logged for unregistered employees |
| Employee Name | Auto-filled — agent cannot manually type a name not in the system |
| Contact Number | Auto-filled from member record — agent can override for this case only (10 digits, numeric) |
| Nature of Complaint | Must be selected from predefined list — no free text |
| Attachments | Required for Breakdown and Repair types before submission |
| Product Name | Must be selected from master list |

---

## 8. TAT Auto-Calculation Logic

When agent selects **Nature of Complaint**, system automatically sets Complaint Type and TAT:

| Nature of Complaint | Complaint Type | TAT Days |
|---|---|---|
| Not Maintaining Proper Temperature | Breakdown | 1 |
| Not Working | Breakdown | 1 |
| Part Not Working | Repair | 2 |
| Repair Required | Repair | 2 |
| Servicing / Maintenance Required | Maintenance | 3 |
| Requirement / Installation / Replacement | Requirement | 10 |

**EDC Calculation:**
> EDC = Case Logging Date + TAT Days

**Open Question:** Are TAT days calendar days or working days?

---

## 9. Nature of Complaint — Predefined List

Grouped by product category. Agent selects product first, then complaint options filter accordingly.

> **Note:** Full product-wise complaint list to be defined. Below are examples from SOW.
- Not Maintaining Proper Temperature (AC, Refrigeration)
- Not Working (AC, Lift, Genset, Sensormatic, Electrical)
- Part Not Working (any product)
- Repair Required (any product)
- Servicing / Maintenance Required (any product)
- Requirement / Installation / Replacement (any product)

---

## 10. Out of Scope for Case Logging

These product categories must be **rejected** at the time of logging with an appropriate message:

- IT Equipment (UPS, Printers, Systems, Network)
- Inverter & Batteries
- Sealing Machine
- Fire NOC (route to Compliance Team)
- Store Operational Tools
- Landlord Issues

---

## 11. Post-Case Logging — Handoff

Once a case is successfully logged:

| # | Action | Owner |
|---|---|---|
| 1 | Case appears in Open Cases list | CRM System |
| 2 | Escalation email triggered automatically | CRM System → Workflow 02 |
| 3 | EDC countdown begins | CRM System |
| 4 | Agent can add Vendor Ticket Number when received | VMM Agent |

---

## 12. Open Questions (To Resolve Before Build)

| # | Question | Impact |
|---|---|---|
| Q1 | Are TAT days calendar days or working days? | EDC calculation logic |
| Q2 | What is the Case ID format? (e.g., VMM-2026-00001) | Case ID generator |
| Q3 | Should attachment be enforced at submission or can it be added within X hours? | Validation rule |
| Q4 | Is Vendor Name always mandatory? (some complaints may have no vendor) | Field validation |
| Q5 | Can a case be saved as Draft before submission? | Form state management |
| Q6 | Who can log a case — only VMM Agents, or can stores self-log? | Access control |
| Q7 | What happens if a store is not found in the master? Can agent create it on the fly? | Store master management |
| Q8 | Should Nature of Complaint filter based on selected Product? | Dropdown dependency logic |
| Q9 | If employee is not registered — who do they contact to get registered, and what is that process? | Unregistered member handling |
| Q10 | Can agent update the member's contact number permanently in the master, or only for the current case? | Member master write permissions |

---

## 13. Next Workflow

After this is reviewed and approved → **Workflow 02: Escalation**
