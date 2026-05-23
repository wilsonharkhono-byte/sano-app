# Recipe Detail Normalizer — Rollout Verification Checklist

For each of the three reference workbooks listed below, run the full upload → normalize → parse flow with `SANO_BOQ_RECIPE_DETAIL=on` and tick the boxes.

## Workbook 1: `assets/BOQ/RAB R1 Pakuwon Indah AAL-5.xlsx`
- [ ] Probe returns rows_needing_expansion ≥ 40
- [ ] Normalize completes in < 90s
- [ ] Recipe Index sheet shows zero ⚠ flags
- [ ] IV.A.2.7 row has 13 components matching spec Appendix A
- [ ] Total at-cost per row reconciles within Rp 5

## Workbook 2: `assets/BOQ/RAB Nusa Golf I4 no. 29_R3.xlsx`
- [ ] Probe returns rows_needing_expansion > 0
- [ ] Normalize completes
- [ ] Recipe Index sheet shows zero ⚠ flags (or each flag has a documented reason)
- [ ] Spot-check three Balok rows; per-material qty matches manual estimate ±5%

## Workbook 3: `assets/BOQ/RAB R2 Pakuwon Indah PD3 no. 23.xlsx`
- [ ] Probe returns rows_needing_expansion > 0
- [ ] Normalize completes
- [ ] Recipe Index sheet shows zero ⚠ flags
- [ ] Spot-check three Sloof / Kolom / Plat rows

## Sign-off
- [ ] One team member (non-programmer) opens a normalized workbook in Excel and confirms readability
- [ ] After all three pass, flip `SANO_BOQ_RECIPE_DETAIL=on` in production env and `sanoBoqRecipeDetail: true` in `app.json`
