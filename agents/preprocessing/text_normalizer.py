import re


_PAGE_PATTERNS = [
    re.compile(r"^\d+$"),
    re.compile(r"^page\s+\d+(\s+of\s+\d+)?$", re.IGNORECASE),
    re.compile(r"^\d+\s*/\s*\d+$"),
    re.compile(r"^[\(\[]?\d{1,2}[\)\]]$"),
]


def _is_page_artifact(line: str) -> bool:
    stripped = line.strip()
    if not stripped:
        return False
    return any(pattern.match(stripped) for pattern in _PAGE_PATTERNS)


def _ends_with_sentence_punctuation(line: str) -> bool:
    return bool(re.search(r"[.!?;:][\"')\]]*$", line))


def normalize_text(raw_text: str) -> str:
    text = raw_text.replace("\r\n", "\n").replace("\r", "\n")
    text = text.strip()
    if not text:
        return ""

    lines = []
    for raw_line in text.split("\n"):
        line = re.sub(r"[ \t]+", " ", raw_line).strip()
        if _is_page_artifact(line):
            continue
        lines.append(line)

    merged_lines = []
    i = 0
    while i < len(lines):
        line = lines[i]
        if not line:
            i += 1
            continue

        current = line
        while i + 1 < len(lines):
            next_line = lines[i + 1]
            if not next_line:
                break
            if _ends_with_sentence_punctuation(current):
                break
            if not next_line[:1].islower():
                break

            if current.endswith("-"):
                current = current[:-1] + next_line.lstrip()
            else:
                current = f"{current} {next_line.lstrip()}"
            i += 1

        merged_lines.append(current)
        i += 1

    normalized = "\n".join(merged_lines)
    normalized = re.sub(r"\n{2,}", "\n", normalized)
    normalized = re.sub(r"[ \t]{2,}", " ", normalized)
    normalized = normalized.strip().lower()
    return normalized


if __name__ == "__main__":
    sample_text = """
    Page 1

    This is a SAMPLE line with   extra spaces
    and another line that should merge
    because it continues naturally.

    3 / 10
    7

    Heading
    Next line starts Lowercase so it should merge
    with the heading? No, because it starts uppercase.
    """

    normalized_text = normalize_text(sample_text)
    print("Before preview:")
    print(sample_text[:300])
    print("\nAfter preview:")
    print(normalized_text[:300])
