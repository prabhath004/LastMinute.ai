import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { spawn } from "child_process";

export const runtime = "nodejs";

interface LoaderResult {
  chars: number;
  preview: string;
}

function parseLastJsonLine(stdout: string): Record<string, unknown> {
  const lines = stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  for (let i = lines.length - 1; i >= 0; i -= 1) {
    try {
      return JSON.parse(lines[i]) as Record<string, unknown>;
    } catch {
      // Ignore non-JSON lines.
    }
  }

  throw new Error("Python loader did not return valid JSON output.");
}

async function resolvePythonCommand(): Promise<string> {
  const venvPython = path.join(process.cwd(), ".venv", "bin", "python");
  try {
    await fs.access(venvPython);
    return venvPython;
  } catch {
    return "python3";
  }
}

async function loadWithPython(filePath: string): Promise<LoaderResult> {
  const pythonCommand = await resolvePythonCommand();
  const script = `
import json
import sys
from agents.loaders.loader_factory import get_loader

path = sys.argv[1]
try:
    text = get_loader(path).load(path)
    print(json.dumps({"ok": True, "chars": len(text), "preview": text[:200]}))
except Exception as error:
    print(json.dumps({"ok": False, "error": str(error)}))
    sys.exit(1)
`;

  const result = await new Promise<LoaderResult>((resolve, reject) => {
    const child = spawn(pythonCommand, ["-c", script, filePath], {
      cwd: process.cwd(),
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    child.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("close", (code) => {
      try {
        const payload = parseLastJsonLine(stdout);
        if (code === 0 && payload.ok) {
          resolve({
            chars: Number(payload.chars ?? 0),
            preview: String(payload.preview ?? ""),
          });
          return;
        }
        reject(new Error(String(payload.error ?? "File processing failed.")));
      } catch {
        reject(new Error(stderr || "File processing failed."));
      }
    });
  });

  return result;
}

/**
 * POST /api/upload
 *
 * Accepts file uploads (syllabus, slides, notes, etc.)
 * and feeds them to the document analysis agent.
 */
export async function POST(request: Request) {
  const formData = await request.formData();
  const file = formData.get("file") as File | null;

  if (!file) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const safeName = path.basename(file.name) || "upload";
  const tempPath = path.join(os.tmpdir(), `${randomUUID()}-${safeName}`);

  await fs.writeFile(tempPath, buffer);

  try {
    const result = await loadWithPython(tempPath);
    return NextResponse.json({
      filename: file.name,
      size: file.size,
      chars: result.chars,
      preview: result.preview,
      status: "processed",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Upload failed";
    const status = message.includes("Unsupported file type") ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  } finally {
    await fs.unlink(tempPath).catch(() => {
      // Best-effort cleanup.
    });
  }
}
