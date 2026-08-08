import assert from "node:assert/strict";
import test from "node:test";
import { selectNpmInvocation } from "../scripts/npm-invocation.mjs";

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
