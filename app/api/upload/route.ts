import { NextResponse } from "next/server";
import { createHash, randomUUID } from "crypto";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { spawn } from "child_process";

export const runtime = "nodejs";

/** One story beat with optional images for display between topics */
export interface StoryBeat {
  label: string;
  narrative?: string;
  image_steps: Array<{ step_label: string; prompt?: string; image_data: string }>;
}

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
  storyBeats: StoryBeat[];
  llmUsed: boolean;
  llmStatus: string;
  pipelineTrace: Array<Record<string, unknown>>;
}

const UPLOAD_CACHE_DIR = path.join(process.cwd(), ".cache", "upload_results");
const UPLOAD_CACHE_VERSION = "v6";
const UPLOAD_CACHE_TTL_SECONDS = Number.parseInt(
  process.env.LASTMINUTE_UPLOAD_CACHE_TTL_SECONDS ?? "2592000",
  10
);

function uploadCacheTtlSeconds() {
  if (Number.isFinite(UPLOAD_CACHE_TTL_SECONDS)) {
    return Math.max(0, UPLOAD_CACHE_TTL_SECONDS);
  }
  return 2592000;
}

function uploadCacheKey(buffer: Buffer): string {
  const hash = createHash("sha256");
  hash.update(UPLOAD_CACHE_VERSION);
  hash.update(buffer);
  return hash.digest("hex");
}

async function readUploadCache(key: string): Promise<LoaderResult | null> {
  const ttl = uploadCacheTtlSeconds();
  const cachePath = path.join(UPLOAD_CACHE_DIR, `${key}.json`);

  try {
    const raw = await fs.readFile(cachePath, "utf-8");
    const parsed = JSON.parse(raw) as {
      cachedAt?: number;
      value?: LoaderResult;
    };

    const cachedAt = Number(parsed.cachedAt ?? 0);
    if (ttl > 0 && Date.now() - cachedAt * 1000 > ttl * 1000) {
      return null;
    }

    if (!parsed.value || typeof parsed.value !== "object") {
      return null;
    }
    return parsed.value;
  } catch {
    return null;
  }
}

async function writeUploadCache(key: string, value: LoaderResult) {
  if (uploadCacheTtlSeconds() === 0) return;

  const cachePath = path.join(UPLOAD_CACHE_DIR, `${key}.json`);
  const tmpPath = `${cachePath}.tmp-${randomUUID()}`;

  try {
    await fs.mkdir(UPLOAD_CACHE_DIR, { recursive: true });
    await fs.writeFile(
      tmpPath,
      JSON.stringify({
        cachedAt: Math.floor(Date.now() / 1000),
        value,
      }),
      "utf-8"
    );
    await fs.rename(tmpPath, cachePath);
  } catch {
    await fs.unlink(tmpPath).catch(() => undefined);
  }
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

function parseStoryBeats(raw: unknown): StoryBeat[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((b): b is Record<string, unknown> => !!b && typeof b === "object")
    .map((b) => {
      const steps = Array.isArray(b.image_steps)
        ? (b.image_steps as Array<Record<string, unknown>>).map((s) => ({
            step_label: String(s?.step_label ?? "").trim(),
            prompt: typeof s?.prompt === "string" ? s.prompt.trim() : undefined,
            image_data: String(s?.image_data ?? "").trim(),
          }))
        : [];
      return {
        label: String(b.label ?? "").trim(),
        narrative: typeof b.narrative === "string" ? b.narrative.trim() : undefined,
        image_steps: steps,
      };
    })
    .filter((beat) => beat.label || beat.image_steps.some((s) => s.image_data));
}

function envSearchRoots(): string[] {
  const cwd = process.cwd();
  const roots = [cwd];
  try {
    const fromRoute = path.resolve(__dirname, "..", "..", "..");
    if (fromRoute !== cwd) roots.push(fromRoute);
  } catch {
    // ignore
  }
  return roots;
}

async function readEnvFromDisk(): Promise<{
  GEMINI_API_KEY?: string;
  GOOGLE_API_KEY?: string;
  LASTMINUTE_LLM_MODEL?: string;
}> {
  const out: Record<string, string> = {};
  for (const root of envSearchRoots()) {
    for (const filename of [".env.local", ".env"]) {
      const filePath = path.join(root, filename);
      try {
        const raw = await fs.readFile(filePath, "utf-8");
        for (const line of raw.split("\n")) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
          const eq = trimmed.indexOf("=");
          let key = trimmed.slice(0, eq).trim();
          if (key.startsWith("export ")) key = key.slice(7).trim();
          if (!["GEMINI_API_KEY", "GOOGLE_API_KEY", "LASTMINUTE_LLM_MODEL"].includes(key)) continue;
          let value = trimmed.slice(eq + 1).trim();
          if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))
            value = value.slice(1, -1);
          else if (value.includes("#")) value = value.split("#")[0].trim();
          if (value) out[key] = value;
        }
        if (out.GEMINI_API_KEY || out.GOOGLE_API_KEY) return out;
      } catch {
        // skip
      }
    }
  }
  return out;
}

async function resolvePythonCommand(root?: string): Promise<string> {
  const base = root ?? process.cwd();
  const venvPython = path.join(base, ".venv", "bin", "python");
  try {
    await fs.access(venvPython);
    return venvPython;
  } catch {
    return "python3";
  }
}

async function loadWithPython(filePath: string): Promise<LoaderResult> {
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
    story_beats = []
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
        story_beats = pipeline_state.get("story_beats", [])
        if not isinstance(story_beats, list):
            story_beats = []
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
        story_beats = []
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
        "story_beats": story_beats,
        "llm_used": llm_used,
        "llm_status": llm_status,
        "pipeline_trace": pipeline_trace
    }))
except Exception as error:
    print(json.dumps({"ok": False, "error": str(error)}))
    sys.exit(1)
`;

  const env = { ...process.env };
  let geminiKey =
    process.env.GEMINI_API_KEY?.trim() || process.env.GOOGLE_API_KEY?.trim();
  let llmModel = process.env.LASTMINUTE_LLM_MODEL?.trim();
  if (!geminiKey || !llmModel) {
    const fromFile = await readEnvFromDisk();
    if (!geminiKey) geminiKey = fromFile.GEMINI_API_KEY?.trim() || fromFile.GOOGLE_API_KEY?.trim();
    if (!llmModel) llmModel = fromFile.LASTMINUTE_LLM_MODEL?.trim();
  }
  if (geminiKey) {
    env.GEMINI_API_KEY = geminiKey;
    env.GOOGLE_API_KEY = geminiKey;
  }
  if (llmModel) env.LASTMINUTE_LLM_MODEL = llmModel;

  let workDir = process.cwd();
  for (const root of envSearchRoots()) {
    try {
      await fs.access(path.join(root, "pipeline_graph.py"));
      workDir = root;
      break;
    } catch {
      // not this root
    }
  }

  const pythonCommand = await resolvePythonCommand(workDir);

  const result = await new Promise<LoaderResult>((resolve, reject) => {
    const child = spawn(pythonCommand, ["-c", script, filePath], {
      cwd: workDir,
      env,
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
            storyBeats: parseStoryBeats(payload.story_beats),
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
  const cacheKey = uploadCacheKey(buffer);
  const cached = await readUploadCache(cacheKey);
  if (cached) {
    return NextResponse.json({
      filename: file.name,
      size: file.size,
      chars: cached.chars,
      preview: cached.preview,
      text: cached.text,
      learning_event: cached.learningEvent,
      concepts: cached.concepts,
      checklist: cached.checklist,
      interactive_story: cached.interactiveStory,
      final_storytelling: cached.finalStorytelling,
      story_beats: cached.storyBeats ?? [],
      llm_used: cached.llmUsed,
      llm_status: cached.llmStatus,
      pipeline_trace: cached.pipelineTrace,
      status: "processed",
      cached: true,
    });
  }

  const safeName = path.basename(file.name) || "upload";
  const tempPath = path.join(os.tmpdir(), `${randomUUID()}-${safeName}`);

  await fs.writeFile(tempPath, buffer);

  try {
    const result = await loadWithPython(tempPath);
    await writeUploadCache(cacheKey, result);
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
      story_beats: result.storyBeats,
      llm_used: result.llmUsed,
      llm_status: result.llmStatus,
      pipeline_trace: result.pipelineTrace,
      status: "processed",
      cached: false,
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
