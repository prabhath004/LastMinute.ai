# components/

All React UI components for LastMinute.ai.

---

## What we're building

The idea: you upload your study materials (syllabus, lecture slides, notes) and the app turns them into an **interactive story-driven mission** you walk through step by step — not a wall of text you stare at.

Two screens:

1. **Landing page** (`ui/v0-ai-chat.tsx`) — attach files, upload, wait for processing, auto-redirect to workspace.
2. **Workspace** (`workspace/`) — 3-panel layout where you actually learn.

---

## `ui/` — Primitives & landing page

| File              | What it does                                                                 |
| ----------------- | ---------------------------------------------------------------------------- |
| `v0-ai-chat.tsx`  | The main landing page component. File attach, upload to `/api/upload`, loading spinner, stores result in `sessionStorage`, redirects to `/workspace`. |
| `textarea.tsx`    | Auto-resize textarea primitive (shadcn style).                               |

---

## `workspace/` — The learning workspace

Three panels, each its own component. The page that wires them together is `app/workspace/page.tsx`.

### `topic-nav.tsx` — Left panel
- Lists concepts extracted from your upload (e.g. "arrays", "linked lists", "trees").
- Each topic has a progress dot that fills as you complete mission steps.
- "Weak" tag planned for topics you struggle with.

### `mission-canvas.tsx` — Center panel
- **This is where the interactivity lives.**
- The LLM generates a 3-act story: Briefing → Checkpoint → Final Boss.
- Each act can contain **Choice A / Choice B** decision points — the parser (`lib/parse-story.ts`) extracts these from the raw text and renders them as clickable buttons.
- Checkpoints and boss levels have text input fields where you type answers.
- You progress through one act at a time. Completed acts collapse into a summary.
- A step indicator (1 → 2 → 3) shows where you are.
- "Mission complete" screen when you finish all three, with option to restart.

### `support-panel.tsx` — Right panel
- **To-do checklist** — actionable study tasks from the LLM (e.g. "Create 3 flashcards"). Checkable.
- **Progress bar** — tracks mission steps completed + checklist items done.
- **Ask tutor** — opens a chat panel powered by Gemini (`/api/chat`). The tutor knows your study material (passed as context) and answers questions, gives hints, never gives full answers.
- **Hint ladder** — paragraphs from the storytelling text, revealed one at a time.
- **Misconception log** — placeholder for tracking wrong answers (to be wired up).

### `tutor-chat.tsx` — Chat sub-component
- Embedded in the support panel, slides open when you click "Ask tutor".
- Sends messages to `/api/chat` with your study material as context.
- Gemini responds as a study tutor — concise, encouraging, guides you to the answer.

---

## How data flows

```
Upload (landing page)
  → /api/upload → Python pipeline → Gemini LLM
  → Response: { concepts, checklist, interactive_story, final_storytelling }
  → Stored in sessionStorage
  → Redirect to /workspace

Workspace (on mount)
  → Reads sessionStorage
  → parse-story.ts extracts choices from story text
  → Renders 3 interactive steps + checklist + hints
  → Tutor chat calls /api/chat with study context
```

---

## Design

Black and white minimalist. No colors. `Inter` for body text, `JetBrains Mono` for the logo. All styling uses Tailwind + CSS variable tokens defined in `app/globals.css`.
