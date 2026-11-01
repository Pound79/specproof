// specproof.config.yaml のキーの一覧。綴りを誤ったキーは、どの consumer（このエンジン、
// skill、テンプレートの設定読み込み）にも読まれず既定値に落ちるので、check が
// unknown-config-key として知らせる。
//
// 検査の深さの規則: consumer がキーの名前を決め打ちで読む mapping は、キーの集合を固定して
// 検査する（トップレベル、layout、commands、projects[] と environments[] の各要素など）。
// キーの名前を利用者が決める mapping（fixtures のフィクスチャ名、tags のタグ名、env の論理名、
// environments[].envOverrides の環境変数名）は中を見ない。値の型はここでは確かめない
// （エンジンが読むキーの型は config.ts が、テンプレートが読むキーはテンプレートが確かめる）。
//
// 一覧の根拠: config.ts、plugins/specproof/skills の {{config:...}}、templates/*/specproof.config.yaml、
// templates/playwright/src/config/specproof-config.ts、docs/config-schema.md。キーを足すときは
// docs/config-schema.md と同時に更新する。

/** 値の中を見ないキー（文字列・真偽値・文字列の配列などの値）。 */
const VALUE = "value";
/** 名前を利用者が決める mapping。中を見ない。 */
const FREE_FORM = "free-form";

type KeySchema =
  | typeof VALUE
  | typeof FREE_FORM
  | { readonly keys: Readonly<Record<string, KeySchema>> }
  | { readonly items: KeySchema };

const mapping = (keys: Record<string, KeySchema>): KeySchema => ({ keys });

const arrayOf = (items: KeySchema): KeySchema => ({ items });

const fixed = (keys: readonly string[]): KeySchema =>
  mapping(Object.fromEntries(keys.map((key) => [key, VALUE])));

const CONFIG_SCHEMA: KeySchema = mapping({
  adapter: VALUE,
  bddRunner: VALUE,
  bddGenTool: VALUE,
  language: VALUE,
  strictUnregisteredImpl: VALUE,
  strictUnregisteredSpecHeadings: VALUE,
  strictFeatureLint: VALUE,
  commands: fixed([
    "generate",
    "typecheck",
    "lint",
    "productTypecheck",
    "productLint",
    "smoke",
    "install",
    "traceabilityUpdate",
    "traceabilityCheck",
    "traceabilityList",
    "traceabilityStats",
  ]),
  layout: fixed([
    "e2eRoot",
    "featuresDir",
    "stepsDir",
    "stepFileSuffix",
    "stepFileExt",
    "pagesDir",
    "candidateSuffix",
    "textConstants",
    "i18nSource",
    "manifest",
    "specDir",
    "implGlobs",
    "scratchDir",
    "testRunnerConfig",
    "idiomGuide",
    "e2eReadme",
  ]),
  fixtures: FREE_FORM,
  tags: FREE_FORM,
  projects: arrayOf(
    mapping({
      name: VALUE,
      tags: VALUE,
      features: VALUE,
      storageState: VALUE,
      setup: VALUE,
      conditional: VALUE,
      credentialsEnv: fixed(["username", "password", "newPassword"]),
    }),
  ),
  env: FREE_FORM,
  environments: arrayOf(
    mapping({
      name: VALUE,
      default: VALUE,
      dotenvFile: VALUE,
      auth: fixed(["provider", "description"]),
      excludeTags: VALUE,
      envOverrides: FREE_FORM,
      // playwright の雛形が読む（localhost 以外への http を明示で許す）。
      allowInsecureHttp: VALUE,
    }),
  ),
  implement: fixed(["blastRadiusGlobs"]),
  git: fixed(["commitScope", "branchPrefix"]),
  agents: fixed(["codeReviewer", "securityReviewer"]),
  conventions: fixed(["agentsDoc", "i18nLintPlugin", "stepFrameworkPattern", "pendingStubBody"]),
  examples: fixed(["domainName", "specDoc", "internalConstants"]),
  runner: fixed(["device", "webServerCommand", "globalTeardown", "i18nLocaleStorageKey"]),
  flutter: fixed([
    "gherkinParser",
    "testEntry",
    "device",
    "buildRunnerPin",
    "buildYamlSources",
    "traceabilityHashSource",
  ]),
});

const isMapping = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/** キーの経路を `layout.featureDir` / `projects[0].tag` / `["a b"]` の形にする。 */
const joinKey = (parent: string, key: string): string =>
  IDENTIFIER.test(key)
    ? parent === ""
      ? key
      : `${parent}.${key}`
    : `${parent}[${JSON.stringify(key)}]`;

/**
 * 返す未知のキーの上限。設定は PR の作者が書け、YAML の alias で同じ mapping を何度も参照させると
 * 経路の数が掛け算で増える。上限を 1 件超えた時点で走査を止め、超えたことを呼び出し側に示す。
 */
export const MAX_UNKNOWN_CONFIG_KEYS = 100;

const isFull = (found: string[]): boolean => found.length > MAX_UNKNOWN_CONFIG_KEYS;

const collect = (value: unknown, schema: KeySchema, at: string, found: string[]): void => {
  if (schema === VALUE || schema === FREE_FORM || isFull(found)) return;
  if ("items" in schema) {
    if (!Array.isArray(value)) return;
    for (const [index, item] of value.entries()) {
      if (isFull(found)) return;
      collect(item, schema.items, `${at}[${index}]`, found);
    }
    return;
  }
  if (!isMapping(value)) return;
  for (const key of Object.keys(value)) {
    if (isFull(found)) return;
    const where = joinKey(at, key);
    const child = Object.hasOwn(schema.keys, key) ? schema.keys[key] : undefined;
    if (child === undefined) {
      found.push(where);
    } else {
      collect(value[key], child, where, found);
    }
  }
};

/**
 * 読み込んだ設定（YAML の mapping）から、どの consumer も読まないキーの経路を出現順に返す。
 * mapping でない値の中は見ない。MAX_UNKNOWN_CONFIG_KEYS を超えるときは、その数より 1 件多い
 * ところで止める（長さが上限を超えていれば、ほかにもある）。
 */
export const collectUnknownConfigKeys = (config: unknown): string[] => {
  const found: string[] = [];
  collect(config, CONFIG_SCHEMA, "", found);
  return found;
};
