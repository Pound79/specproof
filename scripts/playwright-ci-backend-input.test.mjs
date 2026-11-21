import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const HEADING = "### バックエンドのブランチを入力で選ぶとき";

const jobOf = (yaml, name, next) => {
  const from = yaml.indexOf(`\n  ${name}:`);
  assert.ok(from >= 0, `${name} のジョブが無い`);
  const to = next === undefined ? -1 : yaml.indexOf(`\n  ${next}:`, from);
  return to < 0 ? yaml.slice(from) : yaml.slice(from, to);
};

test("CI の手引きは、バックエンドのブランチを入力で選ぶとき、鍵を使うジョブとバックエンドのコードを動かすジョブを分ける", () => {
  const guide = read("docs/playwright-ci.md");
  // 手順 3（別の非公開リポジトリを読む）の中、手順 4 の前に置く（YAML のコメントの行を見出しと取り違えないよう、位置で切る）。
  const from = guide.indexOf(HEADING);
  const step3 = guide.indexOf("## 3. 別の非公開リポジトリを読む");
  const step4 = guide.indexOf("\n## 4. ");
  assert.ok(step3 >= 0 && step3 < from && from < step4, "手順 3 の中に無い");
  const section = guide.slice(from, step4);
  // run の ref で選べないので入力で選ぶしかないこと、同じジョブだと鍵を読めること。
  assert.match(section, /run の ref では\s*選べない/);
  assert.match(section, /鍵と App のトークンを読める/);

  const yamlFrom = section.indexOf("```yaml");
  const yaml = section.slice(yamlFrom, section.indexOf("\n```\n", yamlFrom + 1));
  // 定期実行と合わせる形を示す（schedule では入力が空になる）。
  assert.match(yaml, /\n {2}schedule:/);
  assert.match(yaml, /default: ""/);
  const fetchJob = jobOf(yaml, "fetch-backend", "e2e");
  const e2eJob = jobOf(yaml, "e2e");
  // 鍵は取ってくるジョブにだけ入れ、そこではバックエンドのコードを動かさない。
  assert.match(fetchJob, /environment: e2e/);
  assert.match(fetchJob, /permissions: \{\}/);
  assert.match(fetchJob, /persist-credentials: false/);
  assert.doesNotMatch(
    fetchJob,
    /docker|compose|npm|yarn|pnpm|bundle|make|python|\bbash |\bsh |cd backend|\.\/backend\/|uses: \.\//,
  );
  // 入力は env で渡すだけ（run: のブロックの中も含め、式で埋めない）。空は既定ブランチに読み替える。
  const inputUses = fetchJob.split("\n").filter((line) => line.includes("${{ inputs.") || line.includes("github.event.inputs"));
  assert.deepEqual(inputUses.map((line) => line.trim()), ["INPUT: ${{ inputs.backend-branch }}"]);
  assert.match(fetchJob, /BRANCH="\$\{INPUT:-<バックエンドの既定ブランチ>\}"/);
  assert.match(fetchJob, /git check-ref-format --branch "\$BRANCH"/);
  // ブランチとしてだけ解決し、SHA に解決してから checkout する。
  assert.match(fetchJob, /\/branches\/\$BRANCH"/);
  assert.doesNotMatch(fetchJob, /\/commits\/\$BRANCH/);
  // 名前を変えたブランチへの読み替えを受けないよう、返った名前も比べる。
  assert.match(fetchJob, /\[\[ "\$name" == "\$BRANCH"/);
  // 名前を変えたブランチへの読み替えを受けないよう、返った名前も比べる。
  assert.match(fetchJob, /\[\[ "\$name" == "\$BRANCH"/);
  assert.match(fetchJob, /ref: \$\{\{ steps\.sha\.outputs\.backend \}\}/);
  // 隠しファイルとパーミッションを保つため tar で渡し、成果物は短く残す。
  assert.match(fetchJob, /tar -cf/);
  assert.match(fetchJob, /actions\/upload-artifact/);
  assert.match(fetchJob, /retention-days: 1\b/);
  assert.doesNotMatch(fetchJob, /test-results|playwright-report|playwright\/\.auth/);
  // テストのジョブは秘密を持たず、書き込みの権限も持たない。
  assert.doesNotMatch(e2eJob, /environment:|secrets\.|app-token|: write/);
  assert.match(e2eJob, /actions\/download-artifact/);

  // 注意: runner の前提、入力が空の回の扱い、成果物を読める範囲、受け取ったものの扱い、秘密を戻さない。
  assert.match(section, /ジョブごとに新しい runner/);
  assert.match(section, /`inputs\.backend-branch == ''`/);
  assert.match(section, /v4\.4\.0/);
  assert.match(section, /画面のリポジトリを読める人が取れる/);
  assert.match(section, /バックエンドを読めなくても/);
  assert.match(section, /公開のときを含む）は、この型を使わない/);
  assert.match(section, /入力で選んだブランチのコード」として扱う/);
  assert.match(section, /cache と成果物に書ける/);
  assert.match(section, /ジョブを分けても、これは防げない/);
  assert.match(section, /`e2e` に secrets・`environment:`・書き込みの `permissions` を足さない/);
  assert.match(section, /信頼が要るジョブ[^。]*この成果物を受け取らない/);
  assert.match(section, /`needs: \[fetch-backend, e2e\]`/);
  assert.match(yaml, /\nconcurrency:/);
  // 分けられないときの最低限。
  const minimum = section.slice(section.indexOf("ジョブを分けられないときの最低限"));
  assert.match(minimum, /required reviewers/);
  assert.match(minimum, /prevent self-review/);
  assert.match(minimum, /承認する人の付かない\s*別の Environment/);
  assert.match(minimum, /そのジョブが出した SHA で\s*checkout/);
  assert.match(minimum, /完全に一致/);
  assert.match(minimum, /印を付けず、trace も上げない/);
});
