import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { parse } from "yaml";

// この CI ジョブが空の作業ディレクトリに生成した足場だけを対象にする。
const key = process.argv[2];
if (!["generate", "typecheck"].includes(key)) throw new Error("Unknown scaffold check");
const config = parse(readFileSync("specproof.config.yaml", "utf8"));
const command = config?.commands?.[key];
if (typeof command !== "string" || !command.trim()) throw new Error(`Missing commands.${key}`);

const result = spawnSync("bash", ["-e", "-c", command], { stdio: "inherit" });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
