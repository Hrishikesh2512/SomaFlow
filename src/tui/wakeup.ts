import chalk from "chalk";
import figlet from "figlet";
import { resolveModelAuto } from "../ai";
import { setActiveModel } from "../ai";

const BANNER_FONT = "ANSI SHADOW";
const SHADOW = chalk.hex("#5b4d9e");
const FACE = chalk.hex("#e8dcf8");
const DIM = chalk.hex("#8a7fc4");

function printBanner(ascii: string) {
  const lines = ascii.replace(/\s+$/, "").split("\n");
  const maxLen = Math.max(...lines.map((l) => l.length), 0);
  const w = maxLen + 2;

  for (const line of lines) {
    process.stdout.write(SHADOW(("  " + line).padEnd(w)) + "\n");
  }
  process.stdout.write(`\x1b[${lines.length}A`);
  for (const line of lines) {
    process.stdout.write(FACE(line.padEnd(w)) + "\n");
  }
  console.log();
}

export async function runWakeup(opts?: { savedModel?: string; displayName?: string; agentName?: string }) {
  console.clear();
  // Banner
  let ascii: string;
  try {
    ascii = figlet.textSync("SomaFlow", { font: BANNER_FONT });
  } catch {
    ascii = figlet.textSync("SomaFlow", { font: "Standard" });
  }
  printBanner(ascii);

  const name = opts?.displayName ?? "Developer";
  const agentName = opts?.agentName ?? "Arthur";
  console.log(DIM(`  Hello, ${name}. ${agentName} is waking up...\n`));

  // Auto-resolve model — no menu, no prompt unless nothing detected
  const model = await resolveModelAuto(opts?.savedModel);
  setActiveModel(model);

  console.log(); // spacer before Arthur prompt
}