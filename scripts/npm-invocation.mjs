export function selectNpmInvocation({ platform, npmExecPath, nodeExecPath, npmRunCommand }) {
  if (npmExecPath) {
    return { command: nodeExecPath, prefixArguments: [npmExecPath] };
  }

  if (platform === "win32") {
    throw new Error(`Cannot invoke npm directly on Windows without npm_execpath. Run \`${npmRunCommand}\` instead.`);
  }

  return { command: "npm", prefixArguments: [] };
}

export function npmPackFailureMessage({ error, stderr }) {
  return error?.message || stderr || "npm pack failed without diagnostic output";
}
