import json
import os
import re
from collections import Counter
from typing import Any, TypedDict

from langgraph.graph import END, StateGraph

from agents.preprocessing.text_normalizer import normalize_text

try:
    import google.generativeai as genai
except Exception:
    genai = None

try:
    from langsmith import traceable
except Exception:
    def traceable(*_args, **_kwargs):
        def decorator(func):
            return func
        return decorator


class PipelineState(TypedDict):
    raw_files: list
    extracted_text: str
    cleaned_text: str
    chunks: list
    concepts: list
    normalized_concepts: list
    priority_concepts: list
    scenario_seed: dict
    learning_event: dict
    todo_checklist: list
    interactive_story: dict
    final_storytelling: str
    llm_used: bool
    llm_status: str


def _read_env_file_value(key: str) -> str:
    for filename in (".env.local", ".env"):
        if not os.path.exists(filename):
            continue
        try:
            with open(filename, "r", encoding="utf-8") as file:
                for raw_line in file:
                    line = raw_line.strip()
                    if not line or line.startswith("#") or "=" not in line:
                        continue
                    left, right = line.split("=", 1)
                    left = left.strip()
                    if left.startswith("export "):
                        left = left[len("export ") :].strip()
                    if left != key:
                        continue
                    value = right.strip()
                    if (value.startswith('"') and value.endswith('"')) or (
                        value.startswith("'") and value.endswith("'")
                    ):
                        value = value[1:-1]
                    elif "#" in value:
                        value = value.split("#", 1)[0].strip()
                    return value.strip()
        except Exception:
            continue
    return ""


def _llm_client():
    if genai is None:
        return None, "google-generativeai not installed"
    api_key = (
        _read_env_file_value("GEMINI_API_KEY")
        or _read_env_file_value("GOOGLE_API_KEY")
        or os.getenv("GEMINI_API_KEY", "").strip()
        or os.getenv("GOOGLE_API_KEY", "").strip()
    )
    if not api_key:
        return None, "missing GEMINI_API_KEY/GOOGLE_API_KEY"
    genai.configure(api_key=api_key)
    return genai, "ok"


def _llm_model() -> str:
    return (
        os.getenv("LASTMINUTE_LLM_MODEL", "").strip()
        or _read_env_file_value("LASTMINUTE_LLM_MODEL")
        or "gemini-1.5-flash"
    )


def _parse_json(text: str) -> dict[str, Any]:
    text = text.strip()
    if not text:
        return {}
    try:
        return json.loads(text)
    except Exception:
        start = text.find("{")
        end = text.rfind("}")
        if start != -1 and end != -1 and end > start:
            try:
                return json.loads(text[start : end + 1])
            except Exception:
                return {}
        return {}


@traceable(run_type="llm", name="gemini_json_call")
def _llm_json(system_prompt: str, user_prompt: str) -> tuple[dict[str, Any], str]:
    client, status = _llm_client()
    if client is None:
        return {}, status
    try:
        model = client.GenerativeModel(_llm_model())
        prompt = (
            f"{system_prompt}\n\n"
            "Return strictly valid JSON. Do not wrap in markdown.\n\n"
            f"{user_prompt}"
        )
        response = model.generate_content(
            prompt,
            generation_config={"temperature": 0.2},
        )
        content = response.text or "{}"
        return _parse_json(content), "ok"
    except Exception as error:
        return {}, f"gemini request failed: {error}"


@traceable(run_type="chain", name="store_raw_files")
def store_raw_files(state: PipelineState) -> PipelineState:
    stored = [f"stored::{name}" for name in state.get("raw_files", [])]
    return {**state, "raw_files": stored}


@traceable(run_type="chain", name="extract_text")
def extract_text(state: PipelineState) -> PipelineState:
    existing_text = state.get("extracted_text", "").strip()
    if existing_text:
        return {**state, "extracted_text": existing_text}

    files = state.get("raw_files", [])
    combined = "\n".join(f"dummy extracted text from {name}" for name in files)
    if not combined:
        combined = "dummy extracted text."
    return {**state, "extracted_text": combined}


@traceable(run_type="chain", name="clean_text")
def clean_text(state: PipelineState) -> PipelineState:
    text = state.get("extracted_text", "")
    cleaned = normalize_text(text)
    return {**state, "cleaned_text": cleaned}


@traceable(run_type="chain", name="chunk_text")
def chunk_text(state: PipelineState) -> PipelineState:
    text = state.get("cleaned_text", "")
    if not text:
        return {**state, "chunks": []}

    sentences = [s.strip() for s in re.split(r"(?<=[.!?])\s+", text) if s.strip()]
    chunks = []
    current = ""
    max_len = 350

    for sentence in sentences:
        candidate = sentence if not current else f"{current} {sentence}"
        if len(candidate) <= max_len:
            current = candidate
        else:
            if current:
                chunks.append(current)
            current = sentence

    if current:
        chunks.append(current)

    return {**state, "chunks": chunks}


@traceable(run_type="chain", name="concept_extraction")
def concept_extraction(state: PipelineState) -> PipelineState:
    text = state.get("cleaned_text", "")
    llm_result, llm_status = _llm_json(
        system_prompt=(
            "You extract high-signal study concepts from course materials. "
            "Return valid JSON only."
        ),
        user_prompt=(
            "Task: extract only explainable study concepts from the source text.\n"
            "Hard constraints:\n"
            "1) Return 12-30 concepts when available (do not stop at 12 if more strong concepts exist).\n"
            "2) Keep only explainable academic concepts: principles, methods, formulas, algorithms, models, "
            "processes, or technical terms.\n"
            "3) Keep only concepts useful for learning, revision, or exam questions.\n"
            "4) Exclude all administrative/logistics content: course title/number, instructor names, dates, grading, "
            "URLs, room numbers, office hours, submission rules, textbook metadata.\n"
            "5) Exclude sentences and long clauses.\n"
            "6) Each concept must be a short noun phrase (1-6 words), lowercase.\n"
            "7) Deduplicate and normalize synonyms to one canonical concept label.\n"
            "8) Rank concepts by exam usefulness (most important first).\n"
            "9) If not clearly explainable, exclude it.\n"
            "Output JSON only with exact schema: {\"concepts\": [\"...\"]}\n"
            "No markdown. No extra keys. No commentary.\n\n"
            f"SOURCE TEXT:\n{text[:12000]}"
        ),
    )
    llm_concepts = llm_result.get("concepts", [])
    if isinstance(llm_concepts, list):
        cleaned_llm = [str(item).strip().lower() for item in llm_concepts if str(item).strip()]
        if cleaned_llm:
            return {
                **state,
                "concepts": cleaned_llm,
                "llm_used": True,
                "llm_status": "ok",
            }

    words = re.findall(r"\b[a-z][a-z0-9]{2,}\b", text)
    stopwords = {
        "the",
        "and",
        "for",
        "with",
        "from",
        "that",
        "this",
        "are",
        "was",
        "were",
        "have",
        "has",
        "not",
        "you",
        "your",
        "into",
        "about",
        "can",
        "will",
        "they",
        "their",
        "then",
        "than",
        "also",
        "but",
        "all",
    }
    filtered = [w for w in words if w not in stopwords]
    freq = Counter(filtered)
    concepts = [word for word, _ in freq.most_common(12)]
    if not concepts:
        concepts = ["core-topic", "key-idea", "review-focus"]
    return {**state, "concepts": concepts, "llm_status": llm_status}


@traceable(run_type="chain", name="normalize_concepts")
def normalize_concepts(state: PipelineState) -> PipelineState:
    seen = set()
    normalized = []
    for concept in state.get("concepts", []):
        value = str(concept).strip().lower()
        if value and value not in seen:
            seen.add(value)
            normalized.append(value)
    return {**state, "normalized_concepts": normalized}


@traceable(run_type="chain", name="estimate_priority")
def estimate_priority(state: PipelineState) -> PipelineState:
    priority = state.get("normalized_concepts", [])[:5]
    return {**state, "priority_concepts": priority}


@traceable(run_type="chain", name="select_scenario_seed")
def select_scenario_seed(state: PipelineState) -> PipelineState:
    priority = state.get("priority_concepts", [])
    seed = {
        "focus": priority[0] if priority else "general review",
        "secondary": priority[1:],
        "mode": "deterministic-placeholder",
    }
    return {**state, "scenario_seed": seed}


@traceable(run_type="chain", name="generate_learning_event")
def generate_learning_event(state: PipelineState) -> PipelineState:
    seed = state.get("scenario_seed", {})
    focus = seed.get("focus", "general review")
    secondary = seed.get("secondary", [])
    concepts = state.get("priority_concepts", [])

    llm_result, llm_status = _llm_json(
        system_prompt=(
            "You are an expert educational story writer and learning designer. "
            "You transform technical study material into engaging, accurate, exam-focused narratives. "
            "Never invent topics not present in the source text or concepts. "
            "Return valid JSON only."
        ),
        user_prompt=(
            "Task: write an interactive learning story using only the given concepts and source text.\n"
            "Goal: help a student understand concepts deeply and retain them for exams.\n\n"
            "Hard constraints:\n"
            "1) Use ONLY ideas grounded in the provided concepts/source text.\n"
            "2) Story must be second-person (\"you\") and engaging, but academically accurate.\n"
            "3) Keep explanations simple, concrete, and beginner-friendly.\n"
            "4) Include exactly 2 decision points in the story (Choice A / Choice B).\n"
            "5) Include exactly 1 quick recall question.\n"
            "6) Tie at least 3 priority concepts into the narrative naturally.\n"
            "7) Avoid fluff, fantasy drift, and generic motivational filler.\n"
            "8) Checklist must be practical and exam-oriented (4 to 6 items).\n"
            "9) Use concise sections so it is readable in one sitting.\n\n"
            "Writing style:\n"
            "- energetic, clear, and focused\n"
            "- short paragraphs\n"
            "- concept-first explanations with mini examples\n"
            "- each section should move learning forward\n\n"
            "Return JSON with exact keys:\n"
            "{"
            "\"title\": str, "
            "\"storytelling\": str, "
            "\"checklist\": [str, str, str, str, ...], "
            "\"opening\": str, "
            "\"checkpoint\": str, "
            "\"boss_level\": str"
            "}\n"
            "No markdown. No extra keys. No commentary.\n\n"
            f"CONCEPTS: {concepts}\n\n"
            f"SOURCE TEXT:\n{state.get('cleaned_text', '')[:12000]}"
        ),
    )
    if llm_result:
        title = str(llm_result.get("title", f"LastMinute Mission: {focus}")).strip()
        storytelling = str(llm_result.get("storytelling", "")).strip()
        llm_checklist = llm_result.get("checklist", [])
        checklist = [str(item).strip() for item in llm_checklist if str(item).strip()]
        if not checklist:
            checklist = [
                f"Read and annotate the section around '{focus}'.",
                "Write three flashcards from the material.",
                "Solve one timed practice question.",
                "Summarize the topic from memory.",
            ]
        story = {
            "title": title,
            "opening": str(llm_result.get("opening", "")).strip(),
            "checkpoint": str(llm_result.get("checkpoint", "")).strip(),
            "boss_level": str(llm_result.get("boss_level", "")).strip(),
        }
        story_text = storytelling or (
            f"{title}\n\n"
            f"Act 1 - The Briefing:\n{story['opening']}\n\n"
            f"Act 2 - The Checkpoint:\n{story['checkpoint']}\n\n"
            f"Final Boss:\n{story['boss_level']}\n\n"
            f"Mission Checklist:\n- " + "\n- ".join(checklist)
        )
        event = {
            "title": title.lower(),
            "format": "interactive-story",
            "tasks": checklist,
            "concepts": concepts,
            "interactive_story": story,
            "final_storytelling": story_text,
        }
        return {
            **state,
            "learning_event": event,
            "todo_checklist": checklist,
            "interactive_story": story,
            "final_storytelling": story_text,
            "llm_used": True,
            "llm_status": "ok",
        }

    checklist = [
        f"Read and annotate the section around '{focus}'.",
        f"Create 3 flashcards for '{focus}' and key terms.",
        "Answer 5 quick self-test questions from the uploaded material.",
        "Write a 4-line summary from memory.",
    ]
    if secondary:
        checklist.append(f"Link '{focus}' with '{secondary[0]}' in one example.")

    story = {
        "title": f"LastMinute Mission: {focus}",
        "opening": f"You are 24 hours from the exam. Your mission starts with {focus}.",
        "checkpoint": "Unlock the next checkpoint by solving one practice prompt.",
        "boss_level": "Teach the concept back in plain language without notes.",
    }
    concepts_text = ", ".join(concepts) if concepts else "core ideas"
    story_text = (
        f"{story['title']}\n\n"
        f"Act 1 - The Briefing:\n{story['opening']}\n\n"
        f"Act 2 - The Route:\n"
        f"Your guide marks these concepts as critical: {concepts_text}.\n"
        f"Every checkpoint you clear gives you more control of the final exam map.\n\n"
        f"Act 3 - The Checkpoint:\n{story['checkpoint']}\n\n"
        f"Final Boss:\n{story['boss_level']}\n\n"
        f"Mission Checklist:\n- " + "\n- ".join(checklist)
    )

    event = {
        "title": f"mission: {focus}",
        "format": "guided practice",
        "tasks": checklist,
        "concepts": concepts,
        "interactive_story": story,
        "final_storytelling": story_text,
    }
    return {
        **state,
        "learning_event": event,
        "todo_checklist": checklist,
        "interactive_story": story,
        "final_storytelling": story_text,
        "llm_status": llm_status or state.get("llm_status", "fallback"),
    }


def build_graph():
    graph = StateGraph(PipelineState)
    graph.add_node("store_raw_files", store_raw_files)
    graph.add_node("extract_text", extract_text)
    graph.add_node("clean_text", clean_text)
    graph.add_node("chunk_text", chunk_text)
    graph.add_node("concept_extraction", concept_extraction)
    graph.add_node("normalize_concepts", normalize_concepts)
    graph.add_node("estimate_priority", estimate_priority)
    graph.add_node("select_scenario_seed", select_scenario_seed)
    graph.add_node("generate_learning_event", generate_learning_event)

    graph.set_entry_point("store_raw_files")
    graph.add_edge("store_raw_files", "extract_text")
    graph.add_edge("extract_text", "clean_text")
    graph.add_edge("clean_text", "chunk_text")
    graph.add_edge("chunk_text", "concept_extraction")
    graph.add_edge("concept_extraction", "normalize_concepts")
    graph.add_edge("normalize_concepts", "estimate_priority")
    graph.add_edge("estimate_priority", "select_scenario_seed")
    graph.add_edge("select_scenario_seed", "generate_learning_event")
    graph.add_edge("generate_learning_event", END)
    return graph.compile()


PIPELINE_GRAPH = build_graph()


@traceable(run_type="chain", name="run_pipeline")
def run_pipeline(raw_files: list, extracted_text: str = "") -> PipelineState:
    initial_state: PipelineState = {
        "raw_files": raw_files,
        "extracted_text": extracted_text,
        "cleaned_text": "",
        "chunks": [],
        "concepts": [],
        "normalized_concepts": [],
        "priority_concepts": [],
        "scenario_seed": {},
        "learning_event": {},
        "todo_checklist": [],
        "interactive_story": {},
        "final_storytelling": "",
        "llm_used": False,
        "llm_status": "",
    }
    return PIPELINE_GRAPH.invoke(initial_state)


def _state_preview_value(value: Any) -> Any:
    if isinstance(value, str):
        return value if len(value) <= 180 else f"{value[:180]}... ({len(value)} chars)"
    if isinstance(value, list):
        if len(value) <= 6:
            return value
        return value[:6] + [f"... ({len(value)} items total)"]
    if isinstance(value, dict):
        preview = {}
        for key, inner in value.items():
            preview[key] = _state_preview_value(inner)
        return preview
    return value


@traceable(run_type="chain", name="run_pipeline_with_trace")
def run_pipeline_with_trace(
    raw_files: list, extracted_text: str = ""
) -> tuple[PipelineState, list[dict[str, Any]]]:
    initial_state: PipelineState = {
        "raw_files": raw_files,
        "extracted_text": extracted_text,
        "cleaned_text": "",
        "chunks": [],
        "concepts": [],
        "normalized_concepts": [],
        "priority_concepts": [],
        "scenario_seed": {},
        "learning_event": {},
        "todo_checklist": [],
        "interactive_story": {},
        "final_storytelling": "",
        "llm_used": False,
        "llm_status": "",
    }

    current_state: dict[str, Any] = dict(initial_state)
    trace: list[dict[str, Any]] = []

    for update in PIPELINE_GRAPH.stream(initial_state, stream_mode="updates"):
        if not isinstance(update, dict):
            continue
        for node_name, node_update in update.items():
            if not isinstance(node_update, dict):
                continue
            current_state.update(node_update)
            trace.append(
                {
                    "node": node_name,
                    "updated_fields": list(node_update.keys()),
                    "state_preview": {
                        key: _state_preview_value(current_state.get(key))
                        for key in current_state.keys()
                    },
                }
            )

    final_state = PIPELINE_GRAPH.invoke(initial_state)
    return final_state, trace


if __name__ == "__main__":
    sample = """
    Page 1
    Newton's second law explains force, mass, and acceleration.
    force equals mass times acceleration.
    Practice free-body diagrams for exam problems.
    """
    result = run_pipeline(["syllabus.pdf", "week1_notes.md"], extracted_text=sample)
    print(json.dumps(result, indent=2))
