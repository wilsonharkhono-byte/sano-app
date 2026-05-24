# How to deploy SANO BoQ Triage as a Claude Project

> One-time setup by whoever runs estimator training. After this, estimators just paste cases — no copy-paste-the-spec ritual.

## Why Project, not paste-the-doc

A Claude Project holds the system instructions and reference files once, server-side. Every conversation against the Project inherits them automatically. This solves four problems with the paste-the-doc workflow:

1. **No drift.** Estimators can't accidentally start a chat without the spec, or strip out "long" sections.
2. **Real catalog matching.** With the actual `Material` sheet attached as a Project file, Claude can fuzzy-match `Bata Mrh` against real SKUs — not just theoretical rules.
3. **Versioning.** One Project to update when parser rules change. Not 70 stale Markdown copies floating around the office.
4. **Telemetry.** Project conversations are reviewable. When Claude guesses wrong, you can see the case and improve the prompt or the parser.

## Steps

### 1. Pick the workspace

In `claude.ai`, click **Projects** in the left sidebar → **New project**.

Settings:
- **Name:** `SANO BoQ Triage`
- **Description:** `Decide if a BoQ row will parse cleanly in SANO, or what to fix.`
- **Privacy:** Workspace-shared (anyone on the team can use it). For sensitive projects, set to invite-only.

### 2. Paste the system prompt

Open `docs/BOQ_TRIAGE_SYSTEM_PROMPT.md`. Copy the content from "Output mode" down to the end of the file (everything below the "## System prompt" line, **not** the deployment note at the top).

Paste into the Project's **Custom instructions** field. Save.

### 3. Attach knowledge files

In the Project's **Files** section, upload:

| File | Why |
|---|---|
| Latest `Material` sheet (export the Material tab from your canonical RAB as a standalone xlsx or csv) | Lets Claude fuzzy-match material names against real SKUs. Without this, name normalization is theoretical. |
| Latest `Upah` sheet | Same purpose for labor roles. |
| One canonical RAB workbook (e.g., AAL-5 or whichever project's BoQ best represents your house style) | Lets Claude see real examples of every pattern it might be asked about. |
| `docs/BOQ_TRANSLATION_RULES.md` (optional) | Adds the messy-workbook-to-clean-workbook transformation playbook for when an estimator asks "how do I convert this old BoQ?". |

Don't attach the entire SANO repo. The system prompt embeds all the parser rules Claude needs; the attached files are for grounded reference matching.

### 4. Test before rolling out

In the Project, paste this test case:

```
Excel: RAB (A) sheet, row 51
NO: 1
Description: - Poer PC.1
Unit: m3
D: =H51
E: =N51*'REKAP RAB'!$O$4
F: =D51*E51
I: =AF51
J: =AG51
K: =AH51

What is this row?
```

Expected response: Concise mode, identifies it as a sub-item of an umbrella row (the `- ` prefix), notes the AF-composite pattern in col I traverses to Analisa, and confirms the parser handles this case cleanly. Confidence: High. No fix needed.

If Claude gives a Full-mode answer or asks for screenshots, the prompt isn't tight enough — review and iterate.

### 5. Share the link

Click **Share** on the Project. Copy the link. Send to estimators with a one-line instruction:

> "Bookmark this. When you have a BoQ row you're not sure about, paste it into a new chat here. No need to explain anything else."

That's the entire user-facing onboarding.

## When to update the prompt

Open the Project, edit Custom Instructions, save. The version label at the top of `BOQ_TRIAGE_SYSTEM_PROMPT.md` is the changelog — bump it when you change behavior (`v1.0` → `v1.1`) and note what changed in the file's commit message.

## Feedback loop

Project conversations are visible to project members. Set a weekly 15-minute review: scan the past week's conversations, find ones where Claude was wrong or asked the estimator something the prompt should have answered. Two outcomes per case:

1. **Prompt needs improvement** → edit Custom Instructions, ship.
2. **Parser needs fix** → file a ticket in the SANO repo, mention the conversation.

This loop is the reason a Project beats a Markdown copy-paste. Without it, you're throwing away the most valuable data: where the parser confuses real estimators.
