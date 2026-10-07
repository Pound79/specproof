import { collectSnapshot, detectAdapter, selectAdapterCandidate } from "./detect.js";

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
    console.log("No supported framework detected from the repository files.");
    console.log("Run: specproof init --adapter <playwright|flutter> to scaffold manually.");
    return;
  }

  console.log("Detected adapter candidates:\n");
  for (const c of result.candidates) {
    console.log(`  ${c.adapter} (${c.confidence}) -> ${c.dir}`);
    for (const s of c.signals) console.log(`    signal: ${s}`);
  }

  if (result.hints.monorepo) {
    console.log("\n  Monorepo detected (workspace configuration).");
  }

  if (result.hints.environments.length > 0) {
    console.log("\n  Environment hints (from .env.example):");
    for (const env of result.hints.environments) {
      const provider = env.authProvider ? ` auth=${env.authProvider}` : "";
      console.log(`    ${env.name}${provider}  (${env.signals.join(", ")})`);
    }
  }

  const picked = selectAdapterCandidate(result);
  if (picked) {
    console.log(`\nRecommendation: specproof init --adapter ${picked.adapter} --dir ${picked.dir}`);
  } else {
    console.log("\nDetection is inconclusive. Specify an adapter explicitly:");
    console.log("  specproof init --adapter <playwright|flutter>");
  }
}
