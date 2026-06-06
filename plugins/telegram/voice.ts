import { spawnSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

/** Pluggable transcription backend interface */
export interface TranscriptionProvider {
  name: string;
  isAvailable(): boolean;
  transcribe(audioPath: string): Promise<string>;
}

// ─── Local Whisper via faster-whisper (free, Python) ──────────────────────────

export class FasterWhisperProvider implements TranscriptionProvider {
  readonly name = "faster-whisper (local)";

  isAvailable(): boolean {
    const r = spawnSync("python", ["-c", "import faster_whisper"], {
      encoding: "utf8",
      timeout: 5000,
    });
    if (r.status === 0) return true;
    // Try python3
    const r3 = spawnSync("python3", ["-c", "import faster_whisper"], {
      encoding: "utf8",
      timeout: 5000,
    });
    return r3.status === 0;
  }

  async transcribe(audioPath: string): Promise<string> {
    const python = this.getPython();
    const script = `
import sys
from faster_whisper import WhisperModel
model = WhisperModel("base", device="cpu", compute_type="int8")
segments, _ = model.transcribe(sys.argv[1])
print(" ".join(seg.text.strip() for seg in segments))
`.trim();

    const tmpScript = path.join(os.tmpdir(), "somaflow_whisper.py");
    fs.writeFileSync(tmpScript, script, "utf8");

    return new Promise((resolve, reject) => {
      let output = "";
      let error = "";

      const proc = spawn(python, [tmpScript, audioPath], {
        timeout: 120000, // 2 minutes max
        stdio: ["ignore", "pipe", "pipe"],
      });

      proc.stdout.on("data", (d: Buffer) => { output += d.toString(); });
      proc.stderr.on("data", (d: Buffer) => { error += d.toString(); });

      proc.on("close", (code) => {
        fs.rmSync(tmpScript, { force: true });
        if (code === 0 && output.trim()) {
          resolve(output.trim());
        } else {
          reject(new Error(`faster-whisper failed (code ${code}): ${error.slice(0, 500)}`));
        }
      });

      proc.on("error", (e) => {
        fs.rmSync(tmpScript, { force: true });
        reject(e);
      });
    });
  }

  private getPython(): string {
    const r3 = spawnSync("python3", ["--version"], { encoding: "utf8", timeout: 3000 });
    return r3.status === 0 ? "python3" : "python";
  }
}

// ─── whisper.cpp provider (C++ binary, alternative) ───────────────────────────

export class WhisperCppProvider implements TranscriptionProvider {
  readonly name = "whisper.cpp (local)";

  constructor(private readonly binaryPath: string = "whisper") {}

  isAvailable(): boolean {
    const r = spawnSync(this.binaryPath, ["--help"], {
      encoding: "utf8",
      timeout: 3000,
    });
    return r.status === 0 || r.status === 1; // whisper exits 1 on --help
  }

  async transcribe(audioPath: string): Promise<string> {
    const r = spawnSync(this.binaryPath, ["-m", "models/ggml-base.bin", "-f", audioPath, "--output-txt"], {
      encoding: "utf8",
      timeout: 120000,
      cwd: path.dirname(this.binaryPath) || process.cwd(),
    });

    if (r.status !== 0) {
      throw new Error(`whisper.cpp failed: ${r.stderr?.slice(0, 500)}`);
    }

    // whisper.cpp writes output to <audioPath>.txt
    const txtPath = audioPath + ".txt";
    if (fs.existsSync(txtPath)) {
      const text = fs.readFileSync(txtPath, "utf8").trim();
      fs.rmSync(txtPath, { force: true });
      return text;
    }

    return r.stdout.trim();
  }
}

// ─── OpenAI Whisper API (optional, requires key) ──────────────────────────────

export class OpenAIWhisperProvider implements TranscriptionProvider {
  readonly name = "OpenAI Whisper API";

  isAvailable(): boolean {
    return !!process.env.OPENAI_API_KEY;
  }

  async transcribe(audioPath: string): Promise<string> {
    const apiKey = process.env.OPENAI_API_KEY!;
    const audioData = fs.readFileSync(audioPath);
    const fileName = path.basename(audioPath);

    const form = new FormData();
    form.append("model", "whisper-1");
    form.append("file", new Blob([audioData], { type: "audio/ogg" }), fileName);

    const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      signal: AbortSignal.timeout(60000),
    });

    if (!res.ok) throw new Error(`OpenAI Whisper API error: ${res.statusText}`);
    const data = await res.json() as { text: string };
    return data.text;
  }
}

// ─── Factory: auto-pick best available provider ────────────────────────────────

export function createTranscriptionProvider(): TranscriptionProvider {
  const providers: TranscriptionProvider[] = [
    new FasterWhisperProvider(),
    new WhisperCppProvider(),
    new OpenAIWhisperProvider(),
  ];

  for (const provider of providers) {
    if (provider.isAvailable()) {
      return provider;
    }
  }

  // None available — return a stub that gives a helpful error
  return {
    name: "none",
    isAvailable: () => false,
    transcribe: async () => {
      throw new Error(
        "No transcription backend found.\n" +
        "Install faster-whisper with: pip install faster-whisper\n" +
        "Or set OPENAI_API_KEY to use the OpenAI Whisper API."
      );
    },
  };
}
