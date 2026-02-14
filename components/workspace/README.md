# components/workspace/

The 3-panel learning workspace — what the user sees after uploading study materials.

---

## Layout

```
┌──────────┬─────────────────────────────┬────────────┐
│ TopicNav │      MissionCanvas          │ Support    │
│ (200px)  │      (flex)                 │ Panel      │
│          │                             │ (260px)    │
│ concepts │  step-by-step mission flow  │ checklist  │
│ progress │  choices / input / answers  │ tutor chat │
│ dots     │  completed step summaries   │ hints      │
└──────────┴─────────────────────────────┴────────────┘
```

## Files

| File                 | What                                                                                  |
| -------------------- | ------------------------------------------------------------------------------------- |
| `topic-nav.tsx`      | Left sidebar. Lists extracted concepts with progress dots. Click to select a topic.   |
| `mission-canvas.tsx` | Center. Renders one act at a time (Briefing → Checkpoint → Boss). Choices become buttons, checkpoints become text inputs. Step indicator at top. Mission complete screen at end. |
| `support-panel.tsx`  | Right sidebar. Checkable to-do list, progress bar, tutor toggle, hint ladder.         |
| `tutor-chat.tsx`     | Embedded chat in support panel. Sends messages to `/api/chat` (Gemini). Knows your study material. |

## Current state

- **Interactive mission flow**: Working. The story parser (`lib/parse-story.ts`) extracts Choice A/B patterns from LLM text into clickable buttons. Steps progress one at a time.
- **Tutor chat**: Working. Calls Gemini with study material as context.
- **Progress tracking**: Working. Mission steps and checklist completion tracked with progress bar.
- **Topic navigation**: Topics display and highlight. Per-topic content scoping is next.
- **Misconception log**: Placeholder — needs wiring to track wrong answers from mission steps.

## What's next

- Topic-specific missions (clicking a topic loads content scoped to that concept).
- Misconception tracking (wrong choices get logged, tutor references them).
- Timer / urgency mode for last-minute cramming.
- Better story parsing as the LLM pipeline improves (friend working on LangSmith).
