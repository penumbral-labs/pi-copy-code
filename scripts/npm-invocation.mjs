export function selectNpmInvocation({ platform, npmExecPath, nodeExecPath, npmRunCommand }) {
  if (npmExecPath) {
    return { command: nodeExecPath, prefixArguments: [npmExecPath] };
  }

  if (platform === "win32") {
    throw new Error(`Cannot invoke npm directly on Windows without npm_execpath. Run \`${npmRunCommand}\` instead.`);
  }

  return { command: "npm", prefixArguments: [] };
}

export function assertMinimumNpmVersion(version, minimumVersion) {
  const parse = (value) => {
    const match = /^(\d+)\.(\d+)\.(\d+)(?:-|$)/.exec(value);
    if (!match) throw new Error(`Cannot parse npm version: ${value}`);
    return match.slice(1).map(Number);
  };
  const current = parse(version);
  const minimum = parse(minimumVersion);
  for (let index = 0; index < current.length; index += 1) {
    if (current[index] > minimum[index]) return;
    if (current[index] < minimum[index]) {
      throw new Error(`npm ${minimumVersion} or newer is required; found npm ${version}`);
    }
  }
}

export function npmPackFailureMessage({ error, stderr }) {
  return error?.message || stderr || "npm pack failed without diagnostic output";
}
