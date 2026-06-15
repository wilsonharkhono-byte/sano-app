# SAN — Project Progress Forecasting
## Research on Advanced Algorithms + Claude-as-Brain Architecture

**Author's framing:** This document answers three questions.
1. What forecasting signals does the SAN data model already expose?
2. Which forecasting method (out of the serious literature) fits that data shape?
3. Where exactly does Claude add value that a pure statistical engine cannot?

---

## 1. What data SAN already has (the forecasting raw material)

Looking at the current schema and the product requirements, SAN is already producing a surprisingly good dataset for construction forecasting. Most apps in this space cannot do real forecasting because their data is destructive and disconnected. SAN is neither.

**Time-series signal (the core input):**
- `progress_entries` — append-only, timestamped, per BoQ item, with `quantity`, `work_status`, `reported_by`, `payroll_support`, `client_charge_support`, `linked_vo_id`, `linked_rework_id`. This is the cleanest possible input for cumulative progress modeling.
- `opname_headers` + `opname_lines` — weekly cadence with `cumulative_pct`, `verified_pct`, `prev_cumulative_pct`, `this_week_pct`. Already an equal-interval series. Perfect for time-series methods.
- `opname_line_revisions` — the correction history itself is a feature (how often does supervisor-reported progress get revised down by the estimator?).

**Planned baseline (the target):**
- `boq_items.planned`, `boq_items.progress`, `ahs_lines`, frozen baseline versions.
- `milestones.planned_date` + `milestones.revised_date` + `milestone_revisions` — both the original plan and the revision log are available, so slip can be measured.

**Cost + labor rate signal (productivity input):**
- `opname_lines.contracted_rate` vs `boq_labor_rate`, `this_week_amount`.
- `attendance_hok`, `per_worker_overtime`, `kasbon_ledger`, `harian_cost_allocations` — labor intensity per week per mandor. Critical because progress rate is a function of labor deployed.

**Disruption / risk events (covariates that explain pace deviation):**
- `vo_entries` (cause ∈ {client_request, design_revision, estimator_error, site_execution, unforeseen_condition, owner_supplied, contractor_rework}; grade ∈ {low, medium, high, critical_margin}).
- `rework_entries`, `defects` (with severity + status lifecycle).
- `site_changes`.
- `material_request_headers.urgency`, `approval_tasks` delays, PO → receipt latency (material starvation signal).

**Cross-project context (Bayesian pooling raw material):**
- Multiple projects using the same BoQ / AHS vocabulary → the estimator can literally ask "how did past `Kolom tipe K24` items actually burn compared to plan?" — this is the basis of reference-class forecasting, and SAN is one of the few apps that can do it because its baselines are project-specific but share a catalog.

**Summary:** SAN has a cumulative curve per BoQ, a weekly series per mandor, labor intensity, disruption events tagged by cause, and cross-project comparables. This is enough for *probabilistic* forecasting, not just a simple linear projection.

---

## 2. What "project progress forecasting" actually means

Before picking a method, the target has to be specified. These are the questions a good SAN forecast should answer:

1. **Completion-date forecast** — given current burn, when does BoQ item *X* / milestone *M* / project *P* hit 100%? With an uncertainty band, not a single date.
2. **At-risk classification** — is this milestone going to be late, and with what probability? (This feeds the existing `milestones.status` enum.)
3. **Schedule-at-completion (SAC) / cost-at-completion (EAC)** — the earned-value answer.
4. **Resource exhaustion** — will Tier-1 material run out before installation finishes at the current pace? (Already hinted at by the Gate-5 burn-rate report.)
5. **Shock-response forecast** — "if a high-grade VO lands this week, what's the new expected finish?" — counterfactual forecasting.

Different methods answer different subsets. The architecture below answers all five.

---

## 3. Candidate methods, honestly evaluated

Ranked roughly by fit to SAN, not by buzz.

### 3.1 Earned Value Management (EVM) with Earned Schedule extension
The construction industry's standard. Computes `CPI = EV/AC`, `SPI = EV/PV`, then forecasts `EAC = BAC/CPI`, `ESAC = SAC/SPI_t`.
- **Pros:** Universally accepted, auditable, dirt-cheap. SAN already has everything it needs (`boq_items.planned`, `progress_entries`, `opname_lines.amount`).
- **Cons:** Point estimates only, no uncertainty, assumes pace is stationary, poor near project endgame, blind to disruption causes.
- **Fit:** Mandatory baseline layer. Should always be shown for accountability, but shouldn't be the only forecast.

### 3.2 Parametric S-curve fitting (Gompertz / logistic / Weibull CDF)
Construction cumulative progress is almost always S-shaped. Fit a three-parameter Gompertz `y(t) = a·exp(-b·exp(-c·t))` to observed cumulative % per BoQ or milestone. Extrapolate to y=100%.
- **Pros:** Matches the physical reality of construction (slow start → fast mid → slow tail). Only 3 parameters, so it's identifiable even on sparse data. Provides the full forward curve, not just a date.
- **Cons:** Vanilla fitting is a point estimate; breaks on pace changes unless refitted with priors.
- **Fit:** Excellent as the *deterministic* forecast surface — but upgrade it with Bayesian priors (next).

### 3.3 Bayesian hierarchical S-curve (Bayesian Gompertz with partial pooling) — **recommended core**
Same S-curve, but each BoQ item inherits priors from a "reference class" (same work type across past projects). Posterior updates every time a new `progress_entry` or weekly `opname_line` arrives.
- **Pros:**
  - Natural uncertainty bands (credible intervals → fits `ON_TRACK / AT_RISK / DELAYED` enum cleanly: e.g. AT_RISK if P(late) > 0.3, DELAYED if P(late) > 0.7).
  - Partial pooling fixes the cold-start problem — a brand-new BoQ with 2 weeks of data borrows strength from its reference class.
  - Updates incrementally (matches the weekly opname cadence perfectly).
  - Explainable in plain language ("we are 82% confident this milestone finishes between May 20 and June 3").
- **Cons:** Requires a real inference engine (Stan / PyMC / NumPyro) or a well-tested Kalman-filter approximation.
- **Fit:** Best primary method.

### 3.4 Reference-Class Forecasting (Flyvbjerg, Kahneman)
Instead of forecasting from inside the project, forecast from the distribution of similar past projects. Empirically beats inside-view forecasts by large margins.
- **Pros:** Crushes planning-fallacy bias. SAN can do this natively because BoQ codes + AHS components provide a similarity key across projects.
- **Cons:** Needs a usable base of past completed projects before it's sharp.
- **Fit:** Should supply the *prior* in the Bayesian hierarchical model above. Also a standalone sanity check ("similar columns on project Alpha took a median of 34 days, P80 of 52 days").

### 3.5 Kalman filter / state-space model
Hidden state = true progress + true pace + true acceleration; observation = reported `cumulative_pct`. Handles noisy supervisor-reported data and estimator revisions elegantly.
- **Pros:** Real-time, cheap, handles missing weeks, naturally gives uncertainty. Revisions via `opname_line_revisions` plug in as measurement-noise updates.
- **Cons:** Linear-Gaussian assumption is weak at the saturating tail of an S-curve (use an extended or unscented Kalman if you care, or use it only for the mid-phase).
- **Fit:** Excellent operational layer. Good "tracker" that feeds the Bayesian model between full refits.

### 3.6 Monte Carlo simulation over a PERT/CPM dependency graph
Build a DAG of milestones + BoQ dependencies, sample durations from fitted distributions, run 10k iterations → distribution of project finish dates. This is how big-budget schedule risk analysis is actually done (e.g. Primavera Risk Analysis).
- **Pros:** Handles dependencies, parallelism, and shared-resource bottlenecks. Produces the P50/P80/P95 finish date distribution needed for principal-level reporting.
- **Cons:** SAN's milestone graph is currently light (`milestones.boq_ids` array, no explicit predecessor edges). Would need a small dependency-capture upgrade.
- **Fit:** The natural extension once you have per-BoQ forecasts. Claude can help build the dependency graph from natural-language site reports.

### 3.7 Machine-learning approaches (XGBoost, LSTM, Transformer, TFT)
Feature-based regression (XGBoost on features like `week_index`, `cumulative_pct`, `hok_this_week`, `vo_count`, `defect_count`, `weather_proxy`) or sequence models.
- **Pros:** Can absorb many covariates, often best raw accuracy once data scales.
- **Cons:** Data-hungry, not identifiable with only 10–30 weeks per BoQ, opaque, violates the explicit "AI decisions must be explainable and auditable" requirement (PRD §21.3, §26.3). XGBoost is defensible; deep nets are not, yet.
- **Fit:** Use XGBoost *only* as a second-opinion residual model on top of the Bayesian S-curve. Not a primary method until SAN has dozens of completed projects.

### 3.8 Bayesian Network / Causal DAG
Model causal relationships: `material_late → progress_slip`, `defect_high → rework → progress_slip`. Do counterfactual inference ("what would the forecast be without the April VO?").
- **Pros:** Explicitly answers shock-response and "why is this milestone slipping" — the kind of question a principal actually asks.
- **Cons:** Structure has to be hand-curated.
- **Fit:** This is where Claude shines. Claude can read the `vo_entries.description`, `defects.description`, site-change free text, and propose causal edges for estimator confirmation.

### 3.9 Gaussian Process regression
Non-parametric smooth curve with uncertainty.
- **Pros:** Mathematically elegant, no curve-shape assumption.
- **Cons:** `O(n³)` compute, loses the interpretable "S-curve" story, doesn't give a natural reference class.
- **Fit:** Skip for primary forecasting. Possibly useful for short-horizon pace smoothing.

### 3.10 Survival / hazard analysis
Treats "time until this BoQ item completes" as a survival problem; Cox proportional hazards lets VO/defect/material-delay covariates directly accelerate or decelerate the hazard.
- **Pros:** Very natural for "probability of completion by date D", handles censoring (BoQ items still in progress).
- **Cons:** Requires thoughtful covariate engineering.
- **Fit:** Strong companion model specifically for milestone-level at-risk scoring.

### Scorecard

| Method | Explains uncertainty | Works on sparse data | Explainable | Handles events/VO | Data need | SAN fit |
|---|---|---|---|---|---|---|
| EVM + Earned Schedule | ✗ | ✓ | ✓✓ | ✗ | tiny | baseline / audit layer |
| Parametric S-curve | ✗ | ✓ | ✓ | ✗ | tiny | deterministic layer |
| **Bayesian hierarchical S-curve** | ✓✓ | ✓✓ | ✓ | ✓ (via priors) | small | **primary engine** |
| Reference-class forecasting | ✓ | ✓✓ | ✓✓ | indirect | cross-project | **prior generator** |
| Kalman filter | ✓ | ✓ | ✓ | ✓ | small | real-time tracker |
| Monte Carlo PERT/CPM | ✓✓ | ✓ | ✓ | ✓ | medium | project-level aggregator |
| Bayesian network | ✓ | ✓ | ✓✓ | ✓✓ | medium | causal / shock layer |
| XGBoost | ✓ | ✗ | △ | ✓ | large | residual second-opinion |
| LSTM/Transformer | ✓ | ✗ | ✗ | ✓ | very large | defer |
| Survival / Cox PH | ✓ | ✓ | ✓ | ✓✓ | medium | milestone at-risk scorer |
| Gaussian process | ✓ | ✓ | △ | ✗ | small | skip |

---

## 4. Recommended architecture — "BaRF-MC"

**B**ayesian hierarchical S-curve, seeded by **R**eference-class priors, tracked by a Kalman **F**ilter, aggregated to project level by **M**onte **C**arlo over the milestone DAG.

```
           ┌────────────────────────────────────────────────────────┐
           │  Per-BoQ Bayesian Gompertz S-curve                     │
           │  prior: reference class from completed projects        │
           │  data:  opname_lines + progress_entries                │
           │  covariates: labor HOK, VO grade, defect severity,     │
           │              material-late flag                        │
           │  output: posterior distribution over (a, b, c)         │
           │  → completion-date PDF per BoQ                         │
           └────────────────┬───────────────────────────────────────┘
                            │
           ┌────────────────▼───────────────────────────────────────┐
           │  Kalman tracker (between weekly refits)                │
           │  state: (cumulative_pct, pace, accel)                  │
           │  updates on each new progress_entry                    │
           │  cheap, runs on every write                            │
           └────────────────┬───────────────────────────────────────┘
                            │
           ┌────────────────▼───────────────────────────────────────┐
           │  Milestone & project rollup via Monte Carlo            │
           │  sample each BoQ finish date 10k times                 │
           │  respect dependency edges (even just serial chains)    │
           │  output: P50 / P80 / P95 finish per milestone + project│
           │  → feeds milestones.status enum programmatically       │
           └────────────────┬───────────────────────────────────────┘
                            │
           ┌────────────────▼───────────────────────────────────────┐
           │  EVM audit layer (CPI, SPI, EAC, ESAC)                 │
           │  always computed, always shown — trust anchor          │
           └────────────────────────────────────────────────────────┘
```

This architecture is defensible because every layer is independently auditable, which matches PRD §21.3 and §27 ("AI decisions are explainable and auditable").

---

## 5. Claude as the brain — where Claude actually adds value

The statistical engine above is math. It runs in Python (PyMC / NumPyro / Stan). Claude does not do the math. Claude does the *things the math cannot do on its own*. There are seven such roles.

### Role 1 — Reference-class matcher
Given a new BoQ line `"Kolom tipe K24 — lantai 3"`, Claude retrieves the most similar past BoQ items from other projects (using AHS composition, unit, tier structure, label semantics) and returns a ranked candidate set with similarity rationale. This seeds the Bayesian prior. The estimator confirms or rejects. (Matches §15.4 "low-confidence goes to manual review.")

### Role 2 — Covariate extractor from field text
Supervisors write `note` fields on progress entries, VO descriptions, defect descriptions, and site changes in natural language. Claude converts these into structured covariates the statistical model can ingest:
- "hujan deras 3 hari, cor tertunda" → `weather_delay_days = 3`, `activity = concrete_pour`.
- VO description → `cause` + `grade` classification (already an enum in the schema, currently manual).
- Defect description → estimated repair duration.
This is the single biggest data-quality upgrade Claude can provide, because it unlocks covariates that are currently locked in free text.

### Role 3 — Causal-graph proposer
Reads the last 4 weeks of VOs, defects, material-late events, and opname revisions for a project and proposes causal edges ("material delay on PO-102 → pace drop on BoQ-K24 in week 14"). Estimator confirms edges, which then flow into the Bayesian network for counterfactual forecasting. Claude is the only viable structure-learner here because real causal discovery from a few hundred weekly points is statistically hopeless.

### Role 4 — Forecast narrator (audit-grade explanation)
Given the posterior distribution and the covariates, Claude writes the human explanation:
> "Milestone Struktur Lt.3 is forecast to finish between May 18 and June 2 (80% credible interval). The current pace is 18% slower than the reference class median, driven primarily by two high-grade VOs in weeks 12–13 and a 6-day material delay on rebar D16. If no further disruption occurs, the milestone will finish 9 days late vs. the revised plan."
This is exactly what the Principal Mobile dashboard needs and what a statistical engine alone cannot produce.

### Role 5 — Scenario / counterfactual engineer
Estimator asks: "What if we assign one more mandor next week?" Claude turns that into a model input (delta on labor-HOK covariate), re-runs the forecast, and returns the shifted distribution. Same for "what if the rainy season starts April 20" or "what if VO-045 is rejected."

### Role 6 — Anomaly triager
Matches §21 "anomaly grouping." When the statistical engine flags a residual outlier (observed pace far from posterior predictive), Claude investigates: queries related VO/defect/receipt history, writes a 3-sentence diagnosis, and classifies severity. This is what turns raw anomaly scores into something a human can act on.

### Role 7 — Prior elicitation for new projects
When a brand-new project is set up with no history, Claude interviews the estimator with targeted questions about scale, complexity, crew experience, and site constraints, and translates the answers into informative priors for the Bayesian model. This is exactly the "deep interview" pattern proven to work for expert elicitation in decision analysis.

### What Claude must NOT do (matches §21.2 / §26.2)
- Must not update posteriors or issue forecasts directly without the statistical engine — Claude is the orchestrator, not the calculator.
- Must not auto-approve cost-sensitive actions triggered by a forecast (e.g. auto-raising a VO).
- Must not silently rewrite reference classes or priors — all changes are proposed, logged, and require estimator confirmation.
- Every Claude-produced artifact must carry the required triplet from §26.3: **confidence score + explanation + required reviewer if below threshold.**

---

## 6. Data-flow sketch (how this slots into the existing stack)

```
Supervisor mobile (Expo)
        │  progress_entries INSERT
        ▼
Supabase Postgres  ───► trigger ───► edge function "forecast_refresh"
                                           │
                                           ├─► Kalman update (fast, <100ms)
                                           │        │
                                           │        ▼ forecast_cache table
                                           │
                                           └─► Claude call (async, batched)
                                                 - extract covariates from note text
                                                 - anomaly triage if residual large
                                                 - write narrative if milestone at-risk
                                                        │
                                                        ▼
                                                 forecast_explanations table
                                                        │
Weekly job (Sunday 23:00):                              │
  - full Bayesian refit per BoQ (PyMC)                  │
  - Monte Carlo rollup to project / milestone           │
  - reference-class refresh via Claude                  │
  - principal weekly digest PDF                         │
                                                        ▼
                                           Estimator / Principal dashboard
                                                (Gate 5 reporting area)
```

Two new tables are enough: `forecast_runs` (per BoQ, per run, with posterior parameters + credible intervals) and `forecast_explanations` (Claude's narrated output with confidence + reviewer requirement). Everything else is derived.

---

## 7. Delivery roadmap (staged to match PRD §29)

1. **Week 1–2.** Deterministic layer — EVM (CPI/SPI/EAC/ESAC) + parametric Gompertz fit per BoQ. Fast, boring, auditable. Shipped as a Gate-5 report tile.
2. **Week 3–4.** Kalman tracker on weekly `opname_lines`. Populates `milestones.status` automatically.
3. **Week 5–8.** Bayesian hierarchical S-curve in PyMC/NumPyro. Priors bootstrapped from historical projects where possible; from Claude-elicited priors otherwise. Output: posterior + credible interval per BoQ.
4. **Week 9–10.** Claude covariate extraction on note fields + VO/defect text. Feeds the Bayesian model as observed covariates.
5. **Week 11–12.** Monte Carlo milestone/project rollup. Principal-facing "project finish date with P80 band" card.
6. **Week 13+.** Causal-graph layer (Claude-proposed, estimator-confirmed) for shock / counterfactual forecasting. Survival/Cox companion model for milestone at-risk scoring.

---

## 8. One-paragraph TL;DR

The right forecasting technique for SAN is a **Bayesian hierarchical S-curve (Gompertz) with reference-class priors**, tracked in real time by a **Kalman filter**, aggregated to milestone and project level by **Monte Carlo**, with **Earned Value** as the always-on audit baseline. Claude's role is not to forecast — forecasting is math. Claude's role is the seven things math can't do: matching reference classes, extracting covariates from field text, proposing causal edges, narrating forecasts, engineering counterfactual scenarios, triaging anomalies, and eliciting priors for new projects. This architecture fits SAN's existing schema almost exactly, respects the "AI must be explainable and human-reviewable" rules in PRD §21 and §26, and turns SAN from a field-capture app into a true probabilistic control platform.
