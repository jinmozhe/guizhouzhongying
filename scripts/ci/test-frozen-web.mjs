import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const checker = path.join(root, "scripts/ci/check-frozen-web.mjs");
const disabled = readFileSync(path.join(root, "scripts/disabled-web.mjs"), "utf8");
let checked = 0;
function scenario(name, alter, expectedError, initial = {}) {
  const fixture = mkdtempSync(path.join(tmpdir(), "pinjie-frozen-web-guard-"));
  const write = (file, contents) => {
    const target = path.join(fixture, file);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, contents, "utf8");
  };
  const git = (...args) => execFileSync("git", args, { cwd: fixture, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  try {
    git("init", "--quiet");
    git("config", "user.name", "Frozen Web guard fixture");
    git("config", "user.email", "fixture@example.invalid");
    const scripts = Object.fromEntries(["dev", "build", "start", "test"].map((command) => [command, "node ../../scripts/disabled-web.mjs"]));
    write("apps/web/package.json", JSON.stringify({ scripts: { ...scripts, ...initial.scripts } }));
    write("apps/web/src/page.tsx", "export default function Page() { return null; }\n");
    write("apps/web/AGENTS.md", "# Frozen Web\n");
    write("scripts/disabled-web.mjs", initial.disabled ?? disabled);
    git("add", "--", "apps/web/package.json", "apps/web/src/page.tsx", "apps/web/AGENTS.md", "scripts/disabled-web.mjs");
    git("commit", "--quiet", "-m", "guard fixture");
    const base = git("rev-parse", "HEAD");
    const args = alter({ write, git, base }) ?? ["--base", base];
    const result = spawnSync(process.execPath, [checker, "--root", fixture, ...args], { encoding: "utf8" });
    assert.ifError(result.error);
    if (expectedError) {
      assert.notEqual(result.status, 0, `${name} must fail closed`);
      assert.match(result.stderr, expectedError, name);
    } else {
      assert.equal(result.status, 0, `${name}: ${result.stderr}`);
      assert.match(result.stdout, /Frozen Web isolation passed/u);
    }
    checked += 1;
  } finally {
    // This fixture was created by this test and contains no application data.
    rmSync(fixture, { recursive: true, force: true });
  }
}

scenario("unchanged frozen source", () => {});
scenario("rule-only update", ({ write }) => write("apps/web/AGENTS.md", "# Updated freeze rules\n"));
scenario("unstaged business edit", ({ write }) => write("apps/web/src/page.tsx", "export default 1;\n"), /Frozen Web files changed/u);
scenario("staged business edit", ({ write, git }) => {
  write("apps/web/src/page.tsx", "export default 2;\n");
  git("add", "--", "apps/web/src/page.tsx");
}, /Frozen Web files changed/u);
scenario("untracked business file", ({ write }) => write("apps/web/src/new.ts", "export {};\n"), /Frozen Web files changed/u);
scenario("missing package", ({ git }) => {
  git("rm", "--quiet", "--", "apps/web/package.json");
}, /Frozen Web files changed/u);
scenario("invalid baseline", () => ["--base", "main"], /full nonzero Git commit SHA/u);
scenario("zero baseline on ordinary push", () => ["--base", "0".repeat(40)], /full nonzero Git commit SHA/u);
scenario("missing commit", () => ["--base", "a".repeat(40)], /Command failed/u);
scenario("blob baseline", ({ git }) => ["--base", git("rev-parse", "HEAD:apps/web/package.json")], /existing commit/u);
scenario("runtime already enabled", () => {}, /command dev must remain disabled/u, { scripts: { dev: "next dev" } });
scenario("disabled entry already weakened", () => {}, /entry point must fail explicitly/u, { disabled: "console.log('enabled');\n" });
scenario("first push with one root", () => ["--initial-push"]);
scenario("first push with later non-Web commit", ({ write, git }) => {
  write("README.md", "# New project\n");
  git("add", "--", "README.md");
  git("commit", "--quiet", "-m", "add readme");
  return ["--initial-push"];
});
scenario("frozen source changed after root", ({ write, git }) => {
  write("apps/web/src/page.tsx", "export default 3;\n");
  git("commit", "--quiet", "-am", "change frozen source");
  return ["--initial-push"];
}, /Frozen Web files changed/u);
scenario("first push root with enabled runtime", () => ["--initial-push"], /command dev must remain disabled/u, { scripts: { dev: "next dev" } });
scenario("first push with explicit baseline", ({ base }) => ["--initial-push", "--base", base], /cannot be combined/u);
scenario("first push with shallow history", ({ write, base }) => {
  write(".git/shallow", `${base}\n`);
  return ["--initial-push"];
}, /requires full Git history/u);
scenario("first push with multiple roots", ({ git, base }) => {
  const tree = git("rev-parse", "HEAD^{tree}");
  const otherRoot = git("commit-tree", tree, "-m", "unrelated root");
  const merge = git("commit-tree", tree, "-p", base, "-p", otherRoot, "-m", "merge roots");
  git("update-ref", "HEAD", merge);
  return ["--initial-push"];
}, /exactly one root commit/u);
console.log(`Frozen Web guard regressions passed: ${checked} cases; no application runtime started.`);
