import json
import os
import re
import hashlib
import threading
import time
import math
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any, TypedDict

from langgraph.graph import END, StateGraph

from agents.preprocessing.text_normalizer import normalize_text

try:
    import google.generativeai as genai
except Exception:
    genai = None

try:
    import requests as _http
except Exception:
    _http = None

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
    story_beats: list
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


def _cache_dir() -> str:
    return os.path.join(os.getcwd(), ".cache", "gemini_json")


def _cache_ttl_seconds() -> int:
    raw = (
        os.getenv("LASTMINUTE_GEMINI_CACHE_TTL_SECONDS", "").strip()
        or _read_env_file_value("LASTMINUTE_GEMINI_CACHE_TTL_SECONDS")
    )
    if not raw:
        return 60 * 60 * 24 * 7
    try:
        parsed = int(raw)
        return max(parsed, 0)
    except Exception:
        return 60 * 60 * 24 * 7


def _cache_key(system_prompt: str, user_prompt: str) -> str:
    payload = json.dumps(
        {
            "provider": "gemini",
            "model": _llm_model(),
            "system_prompt": system_prompt,
            "user_prompt": user_prompt,
        },
        ensure_ascii=False,
        sort_keys=True,
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _cache_get_json(cache_key: str) -> dict[str, Any] | None:
    ttl = _cache_ttl_seconds()
    path = os.path.join(_cache_dir(), f"{cache_key}.json")
    if not os.path.exists(path):
        return None

    try:
        with open(path, "r", encoding="utf-8") as file:
            payload = json.load(file)
        cached_at = float(payload.get("cached_at", 0))
        if ttl > 0 and time.time() - cached_at > ttl:
            return None
        data = payload.get("data", {})
        return data if isinstance(data, dict) else None
    except Exception:
        return None


def _cache_set_json(cache_key: str, data: dict[str, Any]) -> None:
    if _cache_ttl_seconds() == 0:
        return

    directory = _cache_dir()
    path = os.path.join(directory, f"{cache_key}.json")
    tmp_path = f"{path}.tmp-{os.getpid()}"
    payload = {
        "cached_at": time.time(),
        "data": data,
    }

    try:
        os.makedirs(directory, exist_ok=True)
        with open(tmp_path, "w", encoding="utf-8") as file:
            json.dump(payload, file, ensure_ascii=False)
        os.replace(tmp_path, path)
    except Exception:
        try:
            if os.path.exists(tmp_path):
                os.remove(tmp_path)
        except Exception:
            pass


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
    key = _cache_key(system_prompt, user_prompt)
    cached = _cache_get_json(key)
    if cached is not None:
        return cached, "ok"

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
        parsed = _parse_json(content)
        if parsed:
            _cache_set_json(key, parsed)
        return parsed, "ok"
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
    normalized = state.get("normalized_concepts", [])
    if not normalized:
        return {**state, "priority_concepts": []}

    # Keep broad concept coverage while preserving ranking order from concept extraction.
    # Target: at least 85% of detected concepts, capped to 10 topics.
    coverage_target = max(1, min(10, int(math.ceil(len(normalized) * 0.85))))
    priority = normalized[:coverage_target]
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


def _coverage_target(total: int, ratio: float = 0.85) -> int:
    if total <= 0:
        return 0
    return max(1, min(total, int(math.ceil(total * ratio))))


def _importance_for_rank(index: int, total: int) -> str:
    if total <= 1:
        return "high"
    rank = (index + 1) / float(total)
    if rank <= 0.3:
        return "high"
    if rank <= 0.7:
        return "medium"
    return "low"


def _normalized_subtopic_checklist(
    focus: str, concepts: list, secondary: list, llm_items: list[str], max_items: int = 30
) -> list[str]:
    cleaned: list[str] = []
    seen: set[str] = set()

    for raw_item in llm_items:
        item = re.sub(r"^\s*[-*\d\).\]]+\s*", "", str(raw_item)).strip()
        if len(item) < 4:
            continue
        key = item.lower()
        if key in seen:
            continue
        seen.add(key)
        cleaned.append(item)

    if len(cleaned) >= 4:
        return cleaned[:max_items]

    fallback: list[str] = []
    concept_pool = [str(concept).strip() for concept in concepts if str(concept).strip()]
    if not concept_pool:
        concept_pool = [str(focus).strip() or "core topic"]

    for concept in concept_pool:
        fallback.append(
            f"{concept}: explain it clearly, then solve one exam-style question."
        )
    fallback.append(f"{focus}: write a 5-line summary from memory.")
    if secondary:
        fallback.append(f"{focus} + {secondary[0]}: connect them in one worked example.")

    for item in fallback:
        key = item.lower()
        if key in seen:
            continue
        seen.add(key)
        cleaned.append(item)

    return cleaned[:max_items]


def _match_topic_to_concept(raw_topic: str, concepts: list[str], used: set[str]) -> str:
    candidate = str(raw_topic).strip().lower()
    if not candidate:
        return ""

    for concept in concepts:
        c = str(concept).strip()
        c_key = c.lower()
        if c_key == candidate and c_key not in used:
            return c

    for concept in concepts:
        c = str(concept).strip()
        c_key = c.lower()
        if c_key in used:
            continue
        if candidate in c_key or c_key in candidate:
            return c

    return ""


def _word_count(text: str) -> int:
    return len(re.findall(r"\S+", text))


def _ensure_min_words(text: str, min_words: int, topic_label: str) -> str:
    if min_words <= 0:
        return text.strip()
    result = text.strip()
    while _word_count(result) < min_words:
        result += (
            "\n\n"
            f"You pause at your desk, look at the clock, and commit to one more round on {topic_label}. "
            "You say the idea out loud, catch a weak sentence, and rebuild it into a sharp exam-ready explanation. "
            "You test yourself with one concrete example, then restate the same idea in simpler words so you can recall it under pressure."
        )
    return result.strip()


def _pair_topics(concepts: list[str]) -> list[list[str]]:
    pairs: list[list[str]] = []
    idx = 0
    while idx < len(concepts):
        pair = [concepts[idx]]
        if idx + 1 < len(concepts):
            pair.append(concepts[idx + 1])
        pairs.append(pair)
        idx += 2
    return pairs


def _story_min_words(importance: str) -> int:
    if importance == "high":
        return 620
    if importance == "medium":
        return 520
    return 450


def _fallback_story_card(topics: list[str], importance: str) -> dict[str, Any]:
    clean_topics = [str(t).strip() for t in topics if str(t).strip()]
    if not clean_topics:
        clean_topics = ["core concept"]
    if importance not in {"high", "medium", "low"}:
        importance = "medium"

    topic_label = " + ".join(clean_topics)
    first = clean_topics[0]
    second = clean_topics[1] if len(clean_topics) > 1 else clean_topics[0]
    title = f"{first} and {second}: last-minute exam sync"

    base_story = (
        f"You are one night away from the exam, and {first} plus {second} are waiting on your final revision map. "
        "You open your notes, draw a line between the two topics, and decide this is your mission for the next focused block: "
        "understand each idea, connect them in action, and speak the logic clearly enough to survive time pressure.\n\n"
        f"You begin with {first}. You don't just memorize a definition; you build a scene around it. In your head, you walk through a question step by step, "
        f"using {first} as the key move that unlocks the next line of reasoning. You catch yourself writing something vague, stop, and rewrite it as if the "
        "examiner is reading every word. The more precise your sentence gets, the more confident you feel.\n\n"
        f"Then you pivot to {second}. You imagine the question changing slightly and ask yourself what stays the same and what must change. "
        f"Now the story gets stronger: {first} sets the direction, and {second} decides how to execute it correctly. You test this link with a short worked path, "
        "and every step has a reason. If one reason sounds weak, you fix it immediately.\n\n"
        "You run a pressure moment: ninety seconds, no notes, one clean explanation. Your first attempt is rough, but you tighten it. "
        "Second attempt: better structure. Third attempt: direct, clear, exam-ready. You can now see the topic pair as one connected strategy, not two isolated definitions.\n\n"
        "Before closing the session, you summarize everything in your own words: what each topic means, how they interact, and what mistake you will avoid tomorrow. "
        "You read that summary once, close the page, and say it again from memory. This time, it sticks."
    )
    story = _ensure_min_words(base_story, _story_min_words(importance), topic_label)

    subtopics = [f"{first} core idea", f"{second} core idea", f"{first} <-> {second} exam linkage"]
    friend_explainers = [
        f"How would you explain {first} to a friend in 30 seconds with one example?",
        f"If a question mixes {first} and {second}, what clue tells you which idea to apply first?",
        "What is the most common mistake here, and how will you avoid it in the exam?",
    ]
    return {
        "title": title,
        "topics": clean_topics[:2],
        "importance": importance,
        "subtopics": subtopics,
        "story": story,
        "friend_explainers": friend_explainers,
    }


def _normalize_story_cards(
    llm_cards: Any, concepts: list[str], pairs: list[list[str]]
) -> list[dict[str, Any]]:
    if not isinstance(llm_cards, list):
        llm_cards = []

    concept_list = [str(c).strip() for c in concepts if str(c).strip()]
    pair_lookup = {
        tuple(sorted([topic.lower() for topic in pair])): pair for pair in pairs
    }
    used_pairs: set[tuple[str, ...]] = set()
    normalized_cards: list[dict[str, Any]] = []

    for idx, raw in enumerate(llm_cards):
        if not isinstance(raw, dict):
            continue

        raw_topics = raw.get("topics", [])
        if isinstance(raw_topics, str):
            raw_topics = [raw_topics]
        if not isinstance(raw_topics, list):
            continue

        mapped_topics: list[str] = []
        used_local: set[str] = set()
        for candidate in raw_topics:
            match = _match_topic_to_concept(str(candidate), concept_list, used_local)
            if match:
                used_local.add(match.lower())
                mapped_topics.append(match)

        mapped_topics = mapped_topics[:2]
        if not mapped_topics:
            continue

        pair_key = tuple(sorted([topic.lower() for topic in mapped_topics]))
        if pair_key not in pair_lookup or pair_key in used_pairs:
            continue
        used_pairs.add(pair_key)

        pair = pair_lookup[pair_key]
        importance = str(raw.get("importance", "")).strip().lower()
        if importance not in {"high", "medium", "low"}:
            importance = _importance_for_rank(idx, max(len(pairs), 1))

        fallback = _fallback_story_card(pair, importance)

        title = str(raw.get("title", "")).strip() or str(fallback.get("title", "")).strip()
        raw_subtopics = raw.get("subtopics", [])
        subtopics = (
            [str(s).strip() for s in raw_subtopics if str(s).strip()]
            if isinstance(raw_subtopics, list)
            else []
        )
        if not subtopics:
            subtopics = fallback.get("subtopics", [])

        story = str(raw.get("story", "")).strip() or str(fallback.get("story", "")).strip()
        story = _ensure_min_words(story, _story_min_words(importance), " + ".join(pair))

        raw_friend = raw.get("friend_explainers", [])
        friend_explainers = (
            [str(item).strip() for item in raw_friend if str(item).strip()]
            if isinstance(raw_friend, list)
            else []
        )
        if not friend_explainers:
            friend_explainers = fallback.get("friend_explainers", [])

        normalized_cards.append(
            {
                "title": title,
                "topics": pair,
                "importance": importance,
                "subtopics": subtopics,
                "story": story,
                "friend_explainers": friend_explainers,
            }
        )

    cards_by_key = {
        tuple(sorted([str(topic).lower() for topic in card.get("topics", [])])): card
        for card in normalized_cards
    }
    complete_cards: list[dict[str, Any]] = []
    for idx, pair in enumerate(pairs):
        key = tuple(sorted([topic.lower() for topic in pair]))
        if key in cards_by_key:
            card = cards_by_key[key]
            if card.get("importance") not in {"high", "medium", "low"}:
                card["importance"] = _importance_for_rank(idx, max(len(pairs), 1))
            complete_cards.append(card)
        else:
            complete_cards.append(
                _fallback_story_card(pair, _importance_for_rank(idx, max(len(pairs), 1)))
            )

    return complete_cards


def _story_cards_to_checklist(story_cards: list[dict[str, Any]]) -> list[str]:
    items: list[str] = []
    for card in story_cards:
        topics = card.get("topics", [])
        if isinstance(topics, list):
            clean_topics = [str(topic).strip() for topic in topics if str(topic).strip()]
        else:
            clean_topics = []
        if not clean_topics:
            continue
        topic_label = " + ".join(clean_topics)
        subtopics = card.get("subtopics", [])
        if isinstance(subtopics, list):
            for sub in subtopics[:2]:
                sub_text = str(sub).strip()
                if sub_text:
                    items.append(f"{topic_label}: revise {sub_text} with one worked example.")
        items.append(f"{topic_label}: explain the pair out loud in exam-ready language.")
    return items


def _compose_story_text(
    title: str,
    opening: str,
    checkpoint: str,
    boss_level: str,
    story_cards: list[dict[str, Any]],
    checklist: list[str],
) -> str:
    blocks: list[str] = []
    for idx, card in enumerate(story_cards):
        topics = card.get("topics", [])
        if not isinstance(topics, list):
            topics = []
        topic_label = " + ".join(str(topic).strip() for topic in topics if str(topic).strip()) or "core concepts"
        importance = str(card.get("importance", "medium")).strip().lower()
        importance_label = {
            "high": "High Priority",
            "medium": "Medium Priority",
            "low": "Low Priority",
        }.get(importance, "Priority")
        card_title = str(card.get("title", "")).strip() or f"{topic_label} story card"

        subtopics = card.get("subtopics", [])
        if not isinstance(subtopics, list):
            subtopics = []
        subtopic_text = "\n".join(f"- {str(sub).strip()}" for sub in subtopics if str(sub).strip()) or "- quick review"

        friend = card.get("friend_explainers", [])
        if not isinstance(friend, list):
            friend = []
        friend_text = "\n".join(f"- {str(item).strip()}" for item in friend if str(item).strip()) or "- explain this topic pair to a friend."

        story = str(card.get("story", "")).strip()
        block = (
            f"Story Card {idx + 1}: {card_title}\n"
            f"Topics: {topic_label} ({importance_label})\n"
            f"Subtopics:\n{subtopic_text}\n\n"
            f"Story:\n{story}\n\n"
            f"Friend-style explainers:\n{friend_text}"
        )
        blocks.append(block.strip())

    checklist_text = "\n- ".join(checklist) if checklist else "No checklist generated."
    return (
        f"{title}\n\n"
        f"Act 1 - Mission Brief:\n{opening}\n\n"
        f"Act 2 - Story Cards:\n\n"
        + "\n\n".join(blocks)
        + "\n\n"
        f"Act 3 - Checkpoint:\n{checkpoint}\n\n"
        f"Final Boss:\n{boss_level}\n\n"
        f"Mission Checklist:\n- {checklist_text}"
    )


@traceable(run_type="chain", name="generate_learning_event")
def generate_learning_event(state: PipelineState) -> PipelineState:
    seed = state.get("scenario_seed", {})
    all_concepts = [str(c).strip() for c in state.get("normalized_concepts", []) if str(c).strip()]
    prioritized = [str(c).strip() for c in state.get("priority_concepts", []) if str(c).strip()]
    if not prioritized:
        prioritized = all_concepts[:10]

    concepts: list[str] = []
    seen: set[str] = set()
    for concept in prioritized:
        key = concept.lower()
        if not key or key in seen:
            continue
        seen.add(key)
        concepts.append(concept)
        if len(concepts) >= 10:
            break

    if not concepts and all_concepts:
        for concept in all_concepts:
            key = concept.lower()
            if key in seen:
                continue
            seen.add(key)
            concepts.append(concept)
            if len(concepts) >= 10:
                break

    focus = str(seed.get("focus", "")).strip() or (concepts[0] if concepts else "general review")
    if not concepts:
        concepts = [focus]
    secondary = [c for c in concepts if c.lower() != focus.lower()]
    topic_pairs = _pair_topics(concepts)

    llm_result, llm_status = _llm_json(
        system_prompt=(
            "You are an expert educational story writer and exam-prep learning designer. "
            "Your output must be story-driven, exam-focused, and conversational. "
            "Never invent topics not present in the source text or provided concept list. "
            "Return valid JSON only."
        ),
        user_prompt=(
            "Task: build story cards for exam revision using topic PAIRS only.\n"
            "Goal: combine two topics in each card and explain them like a friend helping before the exam.\n\n"
            "Hard constraints:\n"
            "1) Create exactly one story_card for each pair in TOPIC_PAIRS.\n"
            "2) topics in each story_card must be exactly the same as one given pair.\n"
            "3) importance must be one of: high, medium, low.\n"
            "4) story must be at least 450 words per story_card.\n"
            "5) Do NOT format any formal quiz (no MCQ, no answer key blocks).\n"
            "6) Add friend_explainers as natural conversational prompts (2-4 lines), like friends teaching each other.\n"
            "7) Keep output practical for exam preparation; avoid fluff.\n"
            "8) checklist must be topic/subtopic-driven and exam actionable.\n\n"
            "9) You must write in second-person protagonist style: the learner is always 'you'.\n"
            "10) Each story must feel like a scene with progression (setup -> struggle -> breakthrough -> takeaway).\n"
            "11) Avoid textbook voice. No generic lecture tone.\n\n"
            "Writing style:\n"
            "- energetic, clear, and focused\n"
            "- cinematic but realistic exam-night tone\n"
            "- second-person protagonist narration (you/your)\n"
            "- concrete examples and reasoning steps\n"
            "- no formal quiz language\n\n"
            "Return JSON with exact keys:\n"
            "{"
            "\"title\": str, "
            "\"storytelling\": str, "
            "\"story_cards\": ["
            "{"
            "\"title\": str, "
            "\"topics\": [str, ...], "
            "\"importance\": \"high\"|\"medium\"|\"low\", "
            "\"subtopics\": [str, ...], "
            "\"story\": str, "
            "\"friend_explainers\": [str, ...]"
            "}, ..."
            "], "
            "\"subtopics\": [str, str, ...], "
            "\"checklist\": [str, ...], "
            "\"opening\": str, "
            "\"checkpoint\": str, "
            "\"boss_level\": str"
            "}\n"
            "No markdown. No extra keys. No commentary.\n\n"
            f"CONCEPTS: {concepts}\n\n"
            f"TOPIC_PAIRS: {topic_pairs}\n\n"
            f"SOURCE TEXT:\n{state.get('cleaned_text', '')[:12000]}"
        ),
    )
    if llm_result:
        title = str(llm_result.get("title", f"LastMinute Mission: {focus}")).strip()
        storytelling_summary = str(llm_result.get("storytelling", "")).strip()
        story_cards = _normalize_story_cards(
            llm_result.get("story_cards", []),
            concepts,
            topic_pairs,
        )

        llm_subtopics = llm_result.get("subtopics", [])
        llm_checklist = llm_result.get("checklist", [])
        llm_items: list[str] = []
        if isinstance(llm_subtopics, list):
            llm_items.extend(str(item).strip() for item in llm_subtopics if str(item).strip())
        if isinstance(llm_checklist, list):
            llm_items.extend(str(item).strip() for item in llm_checklist if str(item).strip())
        llm_items.extend(_story_cards_to_checklist(story_cards))

        checklist = _normalized_subtopic_checklist(
            focus,
            concepts,
            secondary,
            llm_items,
            max_items=max(1, len(concepts)),
        )
        story = {
            "title": title,
            "opening": str(llm_result.get("opening", "")).strip(),
            "checkpoint": str(llm_result.get("checkpoint", "")).strip(),
            "boss_level": str(llm_result.get("boss_level", "")).strip(),
            "topic_storylines": story_cards,
        }
        composed = _compose_story_text(
            title=title,
            opening=story["opening"] or f"Your revision starts with {focus}.",
            checkpoint=story["checkpoint"] or "Solve one timed prompt per topic before moving on.",
            boss_level=story["boss_level"] or "Teach all priority topics in plain language without notes.",
            story_cards=story_cards,
            checklist=checklist,
        )
        story_text = (
            f"{storytelling_summary}\n\n{composed}"
            if storytelling_summary
            else composed
        )
        event = {
            "title": title.lower(),
            "format": "interactive-story-pack",
            "tasks": checklist,
            "subtopics": checklist,
            "concepts": concepts,
            "topic_storylines": story_cards,
            "interactive_story": story,
            "final_storytelling": story_text,
            "coverage_ratio": round(len(concepts) / max(len(all_concepts), 1), 3),
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

    story_cards = [
        _fallback_story_card(pair, _importance_for_rank(idx, max(len(topic_pairs), 1)))
        for idx, pair in enumerate(topic_pairs)
    ]
    fallback_items = _story_cards_to_checklist(story_cards)
    checklist = _normalized_subtopic_checklist(
        focus,
        concepts,
        secondary,
        fallback_items,
        max_items=max(1, len(concepts)),
    )

    story = {
        "title": f"LastMinute Mission: {focus}",
        "opening": f"You are 24 hours from the exam. Your mission starts with {focus}.",
        "checkpoint": "Unlock each checkpoint by explaining each story card to a friend in your own words.",
        "boss_level": "Teach the concept back in plain language without notes.",
        "topic_storylines": story_cards,
    }
    story_text = _compose_story_text(
        title=story["title"],
        opening=story["opening"],
        checkpoint=story["checkpoint"],
        boss_level=story["boss_level"],
        story_cards=story_cards,
        checklist=checklist,
    )

    event = {
        "title": f"mission: {focus}",
        "format": "guided-story-pack",
        "tasks": checklist,
        "subtopics": checklist,
        "concepts": concepts,
        "topic_storylines": story_cards,
        "interactive_story": story,
        "final_storytelling": story_text,
        "coverage_ratio": round(len(concepts) / max(len(all_concepts), 1), 3),
    }
    return {
        **state,
        "learning_event": event,
        "todo_checklist": checklist,
        "interactive_story": story,
        "final_storytelling": story_text,
        "llm_status": llm_status or state.get("llm_status", "fallback"),
    }


def _get_api_key() -> str:
    """Return the Gemini/Google API key from env or .env files."""
    return (
        _read_env_file_value("GEMINI_API_KEY")
        or _read_env_file_value("GOOGLE_API_KEY")
        or os.getenv("GEMINI_API_KEY", "").strip()
        or os.getenv("GOOGLE_API_KEY", "").strip()
    )


_IMG_LOCK = threading.Lock()
_IMG_LAST_CALL = 0.0
_IMG_MIN_INTERVAL = 4.0
_IMG_MAX_RETRIES = 4
_IMG_BASE_BACKOFF = 5.0


def _generate_image(description: str) -> str | None:
    """Call Gemini image generation API with retry + rate limiting."""
    global _IMG_LAST_CALL
    api_key = _get_api_key()
    if not api_key or _http is None:
        return None

    # Use LASTMINUTE_IMAGE_MODEL if set, otherwise derive from the text model.
    # e.g. "gemini-2.5-flash" -> "gemini-2.5-flash-image" (the image-capable variant).
    image_model = os.getenv("LASTMINUTE_IMAGE_MODEL", "").strip()
    if not image_model:
        base_model = (
            os.getenv("LASTMINUTE_LLM_MODEL", "").strip()
            or _read_env_file_value("LASTMINUTE_LLM_MODEL")
        )
        if not base_model:
            return None
        # If already ends with "-image", use as-is; otherwise append "-image"
        image_model = base_model if base_model.endswith("-image") else f"{base_model}-image"
    url = (
        "https://generativelanguage.googleapis.com/v1beta/models/"
        f"{image_model}:generateContent?key={api_key}"
    )
    payload = {
        "contents": [
            {
                "parts": [
                    {
                        "text": (
                            f"{description} "
                            "Render as a single, high-clarity diagram: crisp lines, "
                            "distinct elements, no blur. Each concept must have a "
                            "unique visual — no repeated icons or duplicate labels. "
                            "No placeholder or lorem ipsum text."
                        )
                    }
                ]
            }
        ],
        "generationConfig": {"responseModalities": ["Text", "Image"]},
    }
    for attempt in range(_IMG_MAX_RETRIES):
        with _IMG_LOCK:
            now = time.monotonic()
            wait = _IMG_MIN_INTERVAL - (now - _IMG_LAST_CALL)
            if wait > 0:
                time.sleep(wait)
            _IMG_LAST_CALL = time.monotonic()
        try:
            resp = _http.post(url, json=payload, timeout=90)
            if resp.status_code in (429, 500, 502, 503):
                backoff = _IMG_BASE_BACKOFF * (2 ** attempt)
                time.sleep(backoff)
                continue
            if resp.status_code != 200:
                continue
            data = resp.json()
            candidates = data.get("candidates", [])
            if not candidates:
                return None
            parts = candidates[0].get("content", {}).get("parts", [])
            for part in parts:
                inline = part.get("inlineData")
                if inline and inline.get("data"):
                    mime = inline.get("mimeType", "image/png")
                    return f"data:{mime};base64,{inline['data']}"
            return None
        except Exception:
            if attempt < _IMG_MAX_RETRIES - 1:
                time.sleep(_IMG_BASE_BACKOFF * (2 ** attempt))
            continue
    return None


@traceable(run_type="chain", name="generate_story_visuals")
def generate_story_visuals(state: PipelineState) -> PipelineState:
    """Break the story into beats and generate up to 3 images per beat where needed."""
    story_text = state.get("final_storytelling", "")
    concepts = state.get("priority_concepts", [])
    if not story_text:
        return {**state, "story_beats": []}
    concepts_str = ", ".join(concepts) if concepts else "the main topics"
    source_text = state.get("cleaned_text", "")

    result, _ = _llm_json(
        system_prompt=(
            "You are an educational visual designer. You decide where images "
            "would genuinely help in the material — only create a beat when a "
            "concept benefits from a diagram (e.g. framework, process, comparison).\n\n"
            "STRICT RULES:\n"
            "1. Create beats ONLY where a visual adds value. Skip concepts that "
            "   are purely textual or don't need a diagram. Fewer, relevant "
            "   images are better than many filler ones.\n"
            "2. Each beat's narrative must contain ONLY information from the "
            "   source. Use the EXACT terminology from the source.\n"
            "3. The beat label must be the actual concept name.\n"
            "4. For EACH beat you create, give exactly 3 image_steps — each step "
            "   a DIFFERENT visual (no repeated icons or labels):\n"
            "     Step 1: one clear diagram (e.g. framework or definition)\n"
            "     Step 2: a different diagram (e.g. process or mechanism)\n"
            "     Step 3: a different diagram (e.g. result or comparison)\n"
            "5. Image prompts must be SPECIFIC and unique per step.\n\n"
            "Return valid JSON only. The beats array may be empty or have 1 to "
            "several items — only include beats where images are needed."
        ),
        user_prompt=(
            "Decide where images are needed in this content. Create a beat only "
            "for concepts that benefit from a diagram (e.g. the 4 Ps, a process "
            "flow, a comparison). Do NOT create a fixed number of beats; use "
            "as many or as few as needed (including zero).\n\n"
            f"CONCEPTS: {concepts_str}\n\n"
            "For each beat you create, provide:\n"
            "  - label: the concept name\n"
            "  - narrative: 2-5 sentences (second-person). Use exact terms from source.\n"
            "  - is_decision: false\n"
            "  - choices: []\n"
            "  - image_steps: EXACTLY 3 objects with step_label and prompt (detailed diagram description).\n\n"
            'Return JSON: {"beats": [{"label": "...", "narrative": "...", "is_decision": false, '
            '"choices": [], "image_steps": [{"step_label": "Step 1: ...", "prompt": "..."}, ...]}, ...]}\n'
            "Beats array: only include entries where a visual is needed.\n\n"
            f"SOURCE:\n{source_text[:8000]}\n\n"
            f"STORY (reference):\n{story_text[:4000]}"
        ),
    )
    beats_raw = result.get("beats", [])
    if not isinstance(beats_raw, list) or not beats_raw:
        return {**state, "story_beats": []}

    beats: list[dict[str, Any]] = []
    for b in beats_raw[:10]:
        raw_steps = b.get("image_steps", [])
        image_steps: list[dict[str, Any]] = []
        for s in raw_steps[:3]:
            image_steps.append({
                "step_label": str(s.get("step_label", "")).strip(),
                "prompt": str(s.get("prompt", "")).strip(),
                "image_data": "",
            })
        while len(image_steps) < 3:
            image_steps.append({"step_label": "", "prompt": "", "image_data": ""})
        beats.append({
            "label": str(b.get("label", "")).strip(),
            "narrative": str(b.get("narrative", "")).strip(),
            "is_decision": bool(b.get("is_decision", False)),
            "choices": [str(c).strip() for c in b.get("choices", []) if str(c).strip()],
            "image_steps": image_steps,
        })

    def _gen_step_image(beat_idx: int, step_idx: int, prompt_text: str) -> tuple[int, int, str | None]:
        if not prompt_text:
            return beat_idx, step_idx, None
        full_prompt = (
            f"Create a single, clear educational diagram: {prompt_text}. "
            "Style: crisp vector-style illustration, high clarity, bold shapes. "
            "Each element must have a UNIQUE icon or shape. No placeholder text."
        )
        return beat_idx, step_idx, _generate_image(full_prompt)

    jobs: list[tuple[int, int, str]] = []
    for bi, beat in enumerate(beats):
        for si, step in enumerate(beat["image_steps"]):
            if step.get("prompt"):
                jobs.append((bi, si, step["prompt"]))
    with ThreadPoolExecutor(max_workers=3) as pool:
        futures = [pool.submit(_gen_step_image, bi, si, p) for bi, si, p in jobs]
        for future in as_completed(futures):
            try:
                bi, si, img = future.result()
                if img:
                    beats[bi]["image_steps"][si]["image_data"] = img
            except Exception:
                pass
    return {**state, "story_beats": beats}


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
    graph.add_node("generate_story_visuals", generate_story_visuals)

    graph.set_entry_point("store_raw_files")
    graph.add_edge("store_raw_files", "extract_text")
    graph.add_edge("extract_text", "clean_text")
    graph.add_edge("clean_text", "chunk_text")
    graph.add_edge("chunk_text", "concept_extraction")
    graph.add_edge("concept_extraction", "normalize_concepts")
    graph.add_edge("normalize_concepts", "estimate_priority")
    graph.add_edge("estimate_priority", "select_scenario_seed")
    graph.add_edge("select_scenario_seed", "generate_learning_event")
    graph.add_edge("generate_learning_event", "generate_story_visuals")
    graph.add_edge("generate_story_visuals", END)
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
        "story_beats": [],
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
        "story_beats": [],
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
