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
  /** Full extracted text (capped for very large docs to avoid huge responses) */
  text: string;
  learningEvent: Record<string, unknown>;
  concepts: string[];
  checklist: string[];
  interactiveStory: Record<string, unknown>;
  finalStorytelling: string;
  llmUsed: boolean;
  llmStatus: string;
  pipelineTrace: Array<Record<string, unknown>>;
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
import os
import sys
from agents.loaders.loader_factory import get_loader

path = sys.argv[1]
try:
    debug_mode = os.getenv("LASTMINUTE_DEBUG_PIPELINE", "").strip().lower() in ("1", "true", "yes")
    text = get_loader(path).load(path)
    learning_event = {}
    concepts = []
    checklist = []
    interactive_story = {}
    final_storytelling = ""
    llm_used = False
    llm_status = ""
    pipeline_trace = []
    try:
        if debug_mode:
            from pipeline_graph import run_pipeline_with_trace
            pipeline_state, pipeline_trace = run_pipeline_with_trace([path], extracted_text=text)
        else:
            from pipeline_graph import run_pipeline
            pipeline_state = run_pipeline([path], extracted_text=text)
        learning_event = pipeline_state.get("learning_event", {})
        concepts = pipeline_state.get("priority_concepts", [])
        checklist = pipeline_state.get("todo_checklist", [])
        interactive_story = pipeline_state.get("interactive_story", {})
        final_storytelling = pipeline_state.get("final_storytelling", "")
        llm_used = bool(pipeline_state.get("llm_used", False))
        llm_status = str(pipeline_state.get("llm_status", ""))
    except Exception:
        learning_event = {
            "title": "mission: general review",
            "format": "guided practice",
            "tasks": ["read", "practice", "summarize"]
        }
        concepts = ["general", "review", "practice"]
        checklist = ["read core sections", "practice key questions", "summarize notes"]
        interactive_story = {
            "title": "LastMinute Mission: General Review",
            "opening": "Start from your most important chapter.",
            "checkpoint": "Solve one mixed question.",
            "boss_level": "Teach back without notes."
        }
        final_storytelling = """LastMinute Mission: General Review

Act 1 - The Briefing:
You have limited time, so focus on the biggest topics first.

Act 2 - The Route:
Use your uploaded notes to map key ideas and examples.

Act 3 - The Checkpoint:
Solve one mixed question without looking at notes.

Final Boss:
Teach the chapter in simple words from memory."""
        llm_used = False
        llm_status = "pipeline import/exec failed"
    # Cap at 100k chars so API response stays reasonable
    max_chars = 100000
    truncated = len(text) > max_chars
    out_text = text[:max_chars] if truncated else text
    print(json.dumps({
        "ok": True,
        "chars": len(text),
        "preview": text[:200],
        "text": out_text,
        "truncated": truncated,
        "learning_event": learning_event,
        "concepts": concepts,
        "checklist": checklist,
        "interactive_story": interactive_story,
        "final_storytelling": final_storytelling,
        "llm_used": llm_used,
        "llm_status": llm_status,
        "pipeline_trace": pipeline_trace
    }))
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
            text: String(payload.text ?? ""),
            learningEvent: (payload.learning_event ?? {}) as Record<string, unknown>,
            concepts: Array.isArray(payload.concepts)
              ? payload.concepts.map((item) => String(item))
              : [],
            checklist: Array.isArray(payload.checklist)
              ? payload.checklist.map((item) => String(item))
              : [],
            interactiveStory: (payload.interactive_story ?? {}) as Record<
              string,
              unknown
            >,
            finalStorytelling: String(payload.final_storytelling ?? ""),
            llmUsed: Boolean(payload.llm_used ?? false),
            llmStatus: String(payload.llm_status ?? ""),
            pipelineTrace: Array.isArray(payload.pipeline_trace)
              ? (payload.pipeline_trace as Array<Record<string, unknown>>)
              : [],
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
      text: result.text,
      learning_event: result.learningEvent,
      concepts: result.concepts,
      checklist: result.checklist,
      interactive_story: result.interactiveStory,
      final_storytelling: result.finalStorytelling,
      llm_used: result.llmUsed,
      llm_status: result.llmStatus,
      pipeline_trace: result.pipelineTrace,
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
