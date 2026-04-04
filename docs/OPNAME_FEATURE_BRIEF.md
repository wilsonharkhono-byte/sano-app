# SANO — Opname & Mandor Payment Feature Brief

> **Purpose:** Pass this document to another agent or developer for evaluation, extension, or debugging of the mandor labor tracking and weekly payment (opname) feature.

---

## 1. Business Context

### What is an Opname?

An **opname** is a weekly progress payment claim submitted by a **mandor** (subcontractor foreman) in Indonesian construction practice. The mandor submits a list of BoQ work items with their claimed cumulative completion percentage. The payment is calculated as:

```
Payment = Volume × Negotiated Rate × Progress%
```

The payment goes through a waterfall deduction:
```
Gross Total (sum of all line amounts)
  − Retensi (retention, typically 10%)
  = Net to Date (cumulative earned)
  − Yang Dibayarkan s/d Minggu Lalu (prior weeks' cumulative paid)
  − Kasbon (cash advance this week, variable)
  = SISA BAYAR MINGGU INI (net payment due this week)
```

### Key Business Rules

1. **Multiple mandors per project** — each mandor has their own scope (trade category) and their own weekly opname sheet. A concrete mandor and a rebar mandor are separate.
2. **Negotiated rate ≠ BoQ rate** — the agreed borongan price per unit often differs from the AHS (unit price analysis) labor rate. The system tracks both for variance visibility.
3. **Progress is cumulative** — each week the mandor claims total completion to date. Delta = this week − last week.
4. **TDK ACC (Tidak Disetujui)** — estimator can reject specific line items from a payment claim. Those lines are excluded from gross total that week.
5. **Rework policy** — if work is rejected, estimator can downgrade cumulative % during the VERIFIED step. The delta becomes the opening balance for next week.
6. **Kasbon is variable** — cash advance amount is determined by admin each week based on conditions.

---

## 2. Opname Sample File Analysis

Two real opname files were analyzed from `assets/BOQ/`:

### File 1: `Opname 10 - Embong Kenongo 40.xlsx`
- **Sheet:** `Opname_9` (prior week's sheet name, contains week 10 data)
- **Size:** 196 rows × 13 columns
- **Structure:**
  - Col A: Item number / Roman numeral chapter header
  - Col B: Work description (main item)
  - Col C: Sub-item description (3-level hierarchy)
  - Col E: Budget volume
  - Col F: Unit (m³, m², m', kg, ls)
  - Col G: H. Satuan (unit price) — formula references prior opname workbook
  - Col H: Progress % (cumulative, 0–1 decimal, manually entered)
  - Col I: Selesai (Rp) = `E × G × H`
  - Col J: Prior opname % (cumulative from last week)
  - Col K: Delta % = `H − J`
  - Col L: TDK ACC flag for disputed items
- **Payment waterfall** (rows 169–176):
  - Grand total: `=SUM(I11:I168)`
  - Retensi 10%: `=0.1 × I171`
  - Net to date: `=I171 − I172`
  - Prior paid: `=[3]Opname_9!$I$173` (external file ref)
  - Kasbon: hardcoded sum
  - **Net this week**: `=I173 − I174 + I175`
- **Signature block:** 6 signatories — Mandor (H. Kholik), Supervisor, Approval, MK, 2 admin

### File 2: `Opname 34 - Citraland GA7-45.xlsx`
- **Sheet:** `OPM34`
- **Size:** 49 rows × 18 columns (leaner/earlier template format)
- **Structure:**
  - Col E: Budget volume
  - Col G: Cumulative done volume = `E × cumulative_fraction` (formula-driven)
  - Col H: This-week volume = `E × this_week_fraction`
  - Col J: H. Satuan (unit price)
  - Col K: Harga Total = `(G + H) × J` (cumulative earned)
  - Col L: Cumulative % = `(G+H)/E`
  - Col O: This-week payment = `H × J`
- **Prior paid** is an additive chain: `41895900 + [2]OPM6!K28 + [2]OPM7!K32 + ...`
- **Mandor:** Abd. Kholik (single mandor for entire sheet)

### Key Structural Differences Between Files

| Aspect | File 1 (Embong Kenongo) | File 2 (Citraland) |
|--------|------------------------|---------------------|
| Progress tracking | Single cumulative % col | Split: cumulative vol + this-week vol |
| Prior opname ref | Single cell `[3]Opname_9!$I$173` | Hardcoded chain sum |
| TDK ACC handling | Explicit col L flag | Not present |
| Item depth | 3-level (chapter/item/sub) | Flat list |
| Template age | More mature/complete | Earlier/simpler |

---

## 3. AHS Labor Component Structure

The AHS (Analisa Harga Satuan) for structural work contains both **material** and **labor** components. Key finding: labor is often split across two separate mandors within the same BoQ item.

Example — `Kolom Beton 30×30`:
```
AHS Block: 1 m³ Kolom Beton 30×30
  Materials:  Semen, Pasir, Split, Additive      → material_catalog
  Labor:
    Tukang Cor    0.275 HOK × Rp 120,000         → trade: beton_bekisting
    Pekerja       0.825 HOK × Rp 90,000           → trade: beton_bekisting
    Tukang Besi   0.200 HOK × Rp 130,000          → trade: besi
    Pekerja Besi  0.400 HOK × Rp 90,000           → trade: besi
    Mandor        0.028 HOK × Rp 150,000          → trade: beton_bekisting
```

This means:
- **Mandor Beton** gets paid for: Tukang Cor + Pekerja (beton) + Mandor lines per m³
- **Mandor Besi** gets paid for: Tukang Besi + Pekerja Besi lines per m³
- Each mandor negotiates their own borongan rate against the total AHS labor rate for their trade

### Trade Categories (9 defined)
| Category | Indonesian Label | Example labor descriptions |
|---|---|---|
| `beton_bekisting` | Beton & Bekisting | Tukang beton, tukang cor, bekisting, cetakan beton |
| `besi` | Pembesian (Besi) | Tukang besi, pembesian, besi beton, wiremesh |
| `pasangan` | Pasangan Bata/Batu | Tukang bata, pasangan bata, hebel, bata ringan |
| `plesteran` | Plesteran & Acian | Tukang plester, plesteran, tukang aci, acian |
| `finishing` | Finishing | Tukang cat, keramik, granit, gypsum, plafon |
| `kayu` | Pekerjaan Kayu | Kusen, daun pintu, rangka atap, kuda-kuda |
| `mep` | MEP (Listrik/Air/AC) | Instalasi listrik, tukang pipa, sanitasi |
| `tanah` | Pekerjaan Tanah | Tukang gali, urugan, pemadatan, alat berat |
| `lainnya` | Lainnya | Catch-all for unmatched |

---

## 4. Data Model

### New Tables (migration `008_labor_opname.sql`)

```
ahs_lines (extended)
  + trade_category TEXT  — auto-detected, estimator-confirmed
  + trade_confirmed BOOLEAN

mandor_contracts
  id, project_id, mandor_name
  trade_categories JSONB   — e.g. ["beton_bekisting"] or ["besi"]
  retention_pct NUMERIC    — default 10
  is_active BOOLEAN

mandor_contract_rates
  id, contract_id, boq_item_id
  contracted_rate NUMERIC  — agreed borongan (Rp/unit)
  boq_labor_rate NUMERIC   — frozen from AHS (read-only comparison)
  unit TEXT

opname_headers
  id, project_id, contract_id
  week_number INT, opname_date DATE
  status: DRAFT → SUBMITTED → VERIFIED → APPROVED → PAID
  submitted_by, verified_by, approved_by → profiles
  gross_total, retention_pct, retention_amount
  net_to_date, prior_paid, kasbon, net_this_week
  verifier_notes TEXT

opname_lines
  id, header_id, boq_item_id
  description, unit, budget_volume
  contracted_rate, boq_labor_rate   — snapshot at time of opname
  cumulative_pct                     — submitted by supervisor/mandor
  verified_pct                       — adjusted by estimator (nullable)
  prev_cumulative_pct                — auto from prior opname
  this_week_pct GENERATED            — COALESCE(verified, cumul) − prev
  cumulative_amount, this_week_amount
  is_tdk_acc BOOLEAN
  tdk_acc_reason TEXT
```

### New Views
- `v_labor_boq_rates` — labor cost per BoQ item per trade category (HOK breakdown)
- `v_opname_progress_summary` — weekly payment dashboard with variance % per opname

### New RPCs
- `get_prior_paid(contract_id, week_number)` — sum of all prior APPROVED/PAID opname `net_to_date`
- `get_prev_line_pct(contract_id, boq_item_id, week_number)` — last verified cumulative % for a line

---

## 5. Feature Implementation

### Files Created

| File | Purpose |
|------|---------|
| `supabase/migrations/008_labor_opname.sql` | Schema migration |
| `tools/laborTrade.ts` | Auto-detect + tag trade categories on AHS labor lines |
| `tools/opname.ts` | CRUD, approval workflow, Excel export |
| `workflows/screens/MandorSetupScreen.tsx` | Estimator UI: review trades + set contract rates |
| `workflows/screens/OpnameScreen.tsx` | Weekly opname entry, verify, approve, export |

### Navigation Entry Points
- **Office app** (`office/navigation.tsx`): Two new bottom tabs — **Mandor** and **Opname** — visible to `estimator`, `admin`, `principal` roles
- Both screens accept `onBack: () => void` prop (used when embedded as takeover in other screens)

---

## 6. User Flows

### Flow A: One-time Setup (Estimator)

```
Mandor tab → Review Trade (tab 1)
  ↓
System auto-detects trade categories from AHS labor descriptions
Estimator reviews AI groupings (confidence: high/medium/low)
Estimator taps "Konfirmasi [Trade]" for each group
  ↓
Mandor tab → Kontrak Mandor (tab 2)
  ↓
Estimator creates mandor: name + trade scope + retention %
Taps "Set Harga" → enters borongan rate per BoQ item
System shows variance vs BoQ AHS rate (e.g. +21%)
```

### Flow B: Weekly Opname (Recurring)

```
Opname tab
  ↓
[Supervisor/Admin] Tap "Opname Minggu Baru"
Enter week number + date → system auto-fills prev % for all lines
  ↓
DRAFT: Enter cumulative % per line item
Tap "Ajukan ke Estimator" → status: SUBMITTED
  ↓
SUBMITTED: Estimator reviews
  - Can adjust verified_pct (reduces if work not accepted)
  - Can flag lines as TDK ACC (excluded from payment)
  - Adds verifier notes
Tap "Verifikasi & Teruskan ke Admin" → status: VERIFIED
  ↓
VERIFIED: Admin reviews payment summary
  - Waterfall shown: gross → retention → net → prior → kasbon
  - Admin enters kasbon amount
Tap "Setujui Pembayaran" → status: APPROVED
  ↓
APPROVED: Admin taps "Export Excel Opname"
  - Excel generated matching Embong Kenongo template format
  - Share sheet opens (WhatsApp, email, etc.)
  - Status → PAID
```

---

## 7. Excel Export Format

The export matches the `Opname 10 - Embong Kenongo 40.xlsx` template:

```
Row 1:    OPNAME PEKERJAAN FISIK
Row 3:    Pemilik : [owner]
Row 4:    Lokasi  : [location]
Row 5:    Tgl     : [date]    Opname Minggu ke: [N]
Row 7:    Column headers
Row 8:    (blank)
Row 9+:   Line items
          No | Uraian | Vol | Sat | H.Satuan | Progress% | Selesai | Prog.Lalu | Delta | TDK ACC
...
          Total Pekerjaan
          Retensi N%
          Yang Dibayarkan s/d Minggu Ini
          Yang Dibayarkan s/d Minggu Lalu
          Kasbon
          SISA BAYAR MINGGU INI
...
          [Signature block: Mandor | Estimator | Admin]
```

---

## 8. Known Gaps / Future Work

1. **TDK ACC reason input** — current implementation uses a hardcoded string. Should be a proper text input dialog (Alert.prompt on iOS, custom modal on Android).

2. **Rework partial reversal** — when cumulative % is reduced (rework), the system correctly reflects it in next week's prev_pct. But there is no explicit "rework event" logged for audit trail. Consider adding a `opname_line_revisions` table.

3. **Multi-mandor same BoQ item** — if both Mandor Beton and Mandor Besi claim progress on the same BoQ item (e.g., Kolom Beton), their progress % should be independent. Currently `get_prev_line_pct` is scoped per `contract_id` so this works, but the UI should clarify the rate being shown is trade-specific.

4. **Kasbon running balance** — kasbon is entered per-week and deducted from payment. There is currently no separate kasbon ledger to track total outstanding advances against a mandor. Could be useful for long projects.

5. **Project type field** — `Project` type in `tools/types.ts` only has `id, code, name`. The Excel export uses `client_name` and `location` with `as any` cast. These fields exist in the database but not the TypeScript type — extend `Project` interface to include them.

6. **promote_verified_pct RPC** — referenced in `tools/opname.ts` `verifyOpname()` but not defined in the migration. This RPC should update `prev_cumulative_pct` on all lines of a verified opname to prepare them for the next week's `initOpnameLines`. Add it to the migration or as a separate migration.

---

## 9. Dependencies

- `expo-file-system/legacy` — for writing Excel file to device before Share
- `xlsx` — for Excel generation (already in project)
- Supabase tables: `ahs_lines`, `boq_items`, `profiles`, `projects`, `project_assignments`
- Migration must run AFTER `002_baseline_tables.sql`, `004_boq_parser_extensions.sql`
