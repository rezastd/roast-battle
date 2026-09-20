// Focused tests for the .env loader. Uses fixture files under the OS temp
// dir only — never touches the project's real .env.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseEnv, loadEnv } from "../env.js";

describe("parseEnv", () => {
  it("parses values, skips blanks/comments/garbage", () => {
    const parsed = parseEnv(
      '# comment\n\nTYPESAFE_API_KEY=abc123\nEMPTY=\nno-equals-here\n123BAD=no\n',
    );
    assert.deepEqual(parsed, { TYPESAFE_API_KEY: "abc123", EMPTY: "" });
  });

  it("strips matching quotes but keeps inner content", () => {
    const parsed = parseEnv('A="quoted value"\nB=\'single\'\nC="unclosed\n');
    assert.deepEqual(parsed, { A: "quoted value", B: "single", C: '"unclosed' });
  });

  it("keeps = inside values", () => {
    assert.deepEqual(parseEnv("TOKEN=a=b=c\n"), { TOKEN: "a=b=c" });
  });
});

describe("loadEnv", () => {
  it("loads keys into process.env without overriding real env", () => {
    const dir = mkdtempSync(join(tmpdir(), "arena-env-"));
    const file = join(dir, ".env");
    writeFileSync(file, "ARENA_TEST_A=from-file\nARENA_TEST_B=from-file\n");
    process.env.ARENA_TEST_B = "from-env";
    try {
      const parsed = loadEnv(file);
      assert.deepEqual(parsed, { ARENA_TEST_A: "from-file", ARENA_TEST_B: "from-file" });
      assert.equal(process.env.ARENA_TEST_A, "from-file");
      assert.equal(process.env.ARENA_TEST_B, "from-env");
    } finally {
      delete process.env.ARENA_TEST_A;
      delete process.env.ARENA_TEST_B;
    }
  });

  it("tolerates a missing file", () => {
    const dir = mkdtempSync(join(tmpdir(), "arena-env-"));
    assert.deepEqual(loadEnv(join(dir, "does-not-exist")), {});
  });
});
