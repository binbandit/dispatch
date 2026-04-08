import { spawn } from "node:child_process";

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      shell: process.platform === "win32",
    });

    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${command} ${args.join(" ")} exited with code ${code ?? "unknown"}`));
    });

    child.on("error", (error) => {
      reject(error);
    });
  });
}

const builderArgs = process.argv.slice(2);
const hasPublishMode = builderArgs.some(
  (arg) => arg === "--publish" || arg === "-p" || arg.startsWith("--publish="),
);

if (!hasPublishMode) {
  builderArgs.push("--publish", "never");
}

await run("bun", ["run", "build"]);
await run("node_modules/.bin/electron-builder", builderArgs);
