import { isMap, isScalar, parseDocument, visit } from "yaml";

export const assertScaffoldDirectory = (dir: string): void => {
  if (/[\x00-\x1f\x7f]/.test(dir)) {
    throw new Error("--dir must not contain control characters");
  }
};

/** CDPATH や単独「-」に依存せず、相対配置先を現在地から指定する。 */
export const shellCdCommand = (dir: string): string => {
  const operand = dir === "." ? "." : `./${dir}`;
  return /^[A-Za-z0-9_./-]+$/.test(operand)
    ? `cd ${operand}`
    : `cd -- '${operand.replaceAll("'", "'\\''")}'`;
};

/** コメントを保持しながら、配置パスと shell コマンドを別々に更新する。 */
export const rewriteScaffoldConfig = (
  source: string,
  templateDir: string,
  targetDir: string,
): string => {
  const document = parseDocument(source);
  if (document.errors.length > 0) throw document.errors[0];
  if (!isMap(document.contents)) throw new Error("Template config must be a YAML mapping");
  let changed = false;

  for (const key of ["layout", "fixtures", "flutter"]) {
    const section = document.get(key, true);
    if (!isMap(section)) continue;
    visit(section, {
      Scalar(key, node) {
        if (key === "key" || typeof node.value !== "string") return;
        if (
          targetDir !== templateDir &&
          (node.value === templateDir || node.value.startsWith(`${templateDir}/`))
        ) {
          node.value = targetDir + node.value.slice(templateDir.length);
          changed = true;
        }
      },
    });
  }

  const commands = document.get("commands", true);
  if (isMap(commands)) {
    const prefix = `cd ${templateDir} && `;
    for (const pair of commands.items) {
      if (isScalar(pair.value) && typeof pair.value.value === "string") {
        if (pair.value.value.startsWith(prefix)) {
          pair.value.value = `${shellCdCommand(targetDir)} && ${pair.value.value.slice(prefix.length)}`;
          changed = true;
        }
      }
    }
  }
  return changed ? document.toString({ lineWidth: 0 }) : source;
};
