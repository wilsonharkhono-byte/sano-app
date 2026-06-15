// Trigger the CLI's extractBekistingTemplates / extractConcreteTemplates to
// see what gets generated for PD3. Diagnose why itemized matched 0 rows.
import { extractBekistingTemplates } from '../tools/normalizer/cli-deterministic.ts';
// Above won't work — it's not exported. Just re-run a subset of the logic
// using parseBoqV2.
