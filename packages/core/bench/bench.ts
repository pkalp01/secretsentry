import { createEngine, secretsModule } from "../src/index.ts";
import { expand } from "../tests/helpers.ts";

const engine = createEngine({ modules: [secretsModule] });

const chat = "Can you help me fix this? I keep getting a 401 from the API when I call it from my server. ".repeat(20);
const env = expand(
  [
    "DATABASE_URL=postgres://app:<<alnum:16>>@db:5432/app",
    "AWS_ACCESS_KEY_ID=AKIA<<b32:16>>",
    "STRIPE_SECRET_KEY=sk_live_<<alnum:24>>",
    "OPENAI_API_KEY=sk-proj-<<urlsafe:100>>",
    "DEBUG=true",
  ].join("\n"),
  "bench",
);
const code = (
  "import requests\n\ndef fetch(url, token):\n    headers = {'Authorization': f'Bearer {token}'}\n" +
  "    return requests.get(url, headers=headers, timeout=10).json()\n\n"
).repeat(400);

function bench(name: string, text: string, runs = 300) {
  for (let i = 0; i < 20; i++) engine.scan(text);
  const t0 = performance.now();
  let findings = 0;
  for (let i = 0; i < runs; i++) findings = engine.scan(text).findings.length;
  const ms = (performance.now() - t0) / runs;
  console.log(`${name.padEnd(28)} ${String(text.length).padStart(7)} chars  ${ms.toFixed(3).padStart(7)} ms/scan  ${findings} findings`);
}

console.log(`ruleset ${secretsModule.version}, ${secretsModule.ruleCount} rules\n`);
bench("chat message (~1.8 KB)", chat);
bench(".env file with 4 secrets", env);
bench("code paste (~70 KB)", code, 50);
