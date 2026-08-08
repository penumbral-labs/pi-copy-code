import assert from "node:assert/strict";
import test from "node:test";
import { npmPackFailureMessage, selectNpmInvocation } from "../scripts/npm-invocation.mjs";

test("uses npm_execpath through Node when npm supplies it", () => {
  assert.deepEqual(
    selectNpmInvocation({
      platform: "win32",
      npmExecPath: String.raw`C:\npm\bin\npm-cli.js`,
      nodeExecPath: String.raw`C:\node\node.exe`,
      npmRunCommand: "npm run verify-package",
    }),
    {
      command: String.raw`C:\node\node.exe`,
      prefixArguments: [String.raw`C:\npm\bin\npm-cli.js`],
    },
  );
});

test("falls back to npm for direct POSIX invocation", () => {
  assert.deepEqual(
    selectNpmInvocation({
      platform: "linux",
      npmExecPath: undefined,
      nodeExecPath: "/usr/bin/node",
      npmRunCommand: "npm run verify-package",
    }),
    { command: "npm", prefixArguments: [] },
  );
});

test("rejects direct Windows invocation with the documented npm run command", () => {
  assert.throws(
    () =>
      selectNpmInvocation({
        platform: "win32",
        npmExecPath: undefined,
        nodeExecPath: String.raw`C:\node\node.exe`,
        npmRunCommand: "npm run smoke-package",
      }),
    /Cannot invoke npm directly on Windows without npm_execpath\. Run `npm run smoke-package` instead\./,
  );
});

test("reports an npm pack spawn error when stderr is unavailable", () => {
  assert.equal(npmPackFailureMessage({ error: new Error("spawn npm ENOENT"), stderr: undefined }), "spawn npm ENOENT");
});

test("reports npm pack stderr when the process starts but fails", () => {
  assert.equal(npmPackFailureMessage({ error: undefined, stderr: "npm error" }), "npm error");
});

test("reports a fallback when npm pack fails without stderr", () => {
  assert.equal(npmPackFailureMessage({ error: undefined, stderr: "" }), "npm pack failed without diagnostic output");
});
