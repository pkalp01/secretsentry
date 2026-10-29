import { writeFileSync } from "node:fs";
import { GENERATED_PATH, renderGenerated, loadAuthoredRules } from "./rules-loader.ts";

const output = renderGenerated();
writeFileSync(GENERATED_PATH, output);
const { version, rules } = loadAuthoredRules();
console.log(`Wrote ${rules.length} rules (ruleset ${version}) to src/modules/secrets/rules.generated.ts`);
