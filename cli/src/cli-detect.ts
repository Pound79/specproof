import { collectSnapshot, detectAdapter } from "./detect.js";

export interface DetectOptions {
  json?: boolean;
}

export async function runDetect(opts: DetectOptions): Promise<void> {
  const root = process.cwd();
  const snapshot = await collectSnapshot(root);
  const result = detectAdapter(snapshot);

  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (result.candidates.length === 0) {
    console.log(
      "No framework detected. No pubspec.yaml (Flutter) or package.json found.",
    );
    console.log(
      "Run: bdd-kit init --adapter <playwright|flutter> to scaffold manually.",
    );
    return;
  }

  console.log("Detected adapter candidates:\n");
  for (const c of result.candidates) {
    console.log(
      `  ${c.adapter} (${c.confidence}) -> ${c.dir}`,
    );
    for (const s of c.signals) console.log(`    signal: ${s}`);
  }

  if (result.hints.monorepo) {
    console.log("\n  Monorepo detected (npm workspaces).");
  }

  if (result.hints.environments.length > 0) {
    console.log("\n  Environment hints (from .env.example):");
    for (const env of result.hints.environments) {
      const provider = env.authProvider ? ` auth=${env.authProvider}` : "";
      console.log(`    ${env.name}${provider}  (${env.signals.join(", ")})`);
    }
  }

  const high = result.candidates.filter((c) => c.confidence === "high");
  if (high.length === 1) {
    console.log(
      `\nRecommendation: bdd-kit init --adapter ${high[0].adapter} --dir ${high[0].dir}`,
    );
  } else {
    console.log(
      "\nAmbiguous detection. Specify an adapter explicitly:",
    );
    console.log("  bdd-kit init --adapter <playwright|flutter>");
  }
}
