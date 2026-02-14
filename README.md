# LastMinute.ai

**Interactive, story-driven exam preparation engine.**

Students upload their study materials, pick a difficulty, and learn through missions, scenarios, and embedded quizzes — not passive summaries.

---

## Quick start

```bash
# install dependencies
npm install

# run the dev server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Other commands:

| Command           | What it does              |
| ----------------- | ------------------------- |
| `npm run build`   | Production build          |
| `npm run start`   | Serve production build    |
| `npm run lint`    | Run ESLint                |

---

## Project structure

```
LastMinute.ai/
├── app/                    ← Next.js App Router (pages + API routes)
│   ├── api/
│   │   ├── chat/route.ts   — POST /api/chat  (tutor conversation)
│   │   └── upload/route.ts — POST /api/upload (file ingestion)
│   ├── globals.css         — Tailwind base + CSS theme variables
│   ├── layout.tsx          — Root layout (font, metadata)
│   └── page.tsx            — Home page
│
├── agents/                 ← AI agent modules (backend logic)
│   ├── document.ts         — Parse uploads, extract concepts
│   ├── curriculum.ts       — Build prioritized learning paths
│   ├── story.ts            — Generate interactive scenarios
│   ├── media.ts            — Produce diagrams, GIFs, visuals
│   ├── tutor.ts            — Conversational explanations
│   └── evaluation.ts       — Score responses, adapt difficulty
│
├── components/             ← React UI components
│   └── ui/                 — Primitive/shadcn components
│       ├── v0-ai-chat.tsx  — Main chat interface
│       └── textarea.tsx    — Auto-resize textarea
│
├── lib/                    ← Shared utilities
│   └── utils.ts            — cn() class merging helper
│
├── types/                  ← Shared TypeScript types
│   └── index.ts            — Domain types (Concept, Course, Scenario, etc.)
│
├── PROJECT.md              — Full product concept / pitch document
├── package.json
├── tailwind.config.ts
├── tsconfig.json
└── next.config.js
```

### Where things live

| You want to…                        | Look in               |
| ----------------------------------- | ---------------------- |
| Change a page or add a new route    | `app/`                 |
| Add or edit an API endpoint         | `app/api/`             |
| Work on AI agent logic              | `agents/`              |
| Build or modify UI components       | `components/`          |
| Add shared helper functions         | `lib/`                 |
| Add or update TypeScript interfaces | `types/`               |
| Understand the product vision       | `PROJECT.md`           |

> Each folder has its own `README.md` with more detail.

---

## Tech stack

| Layer     | Tech                            |
| --------- | ------------------------------- |
| Framework | Next.js 13 (App Router)         |
| Language  | TypeScript                      |
| Styling   | Tailwind CSS + shadcn variables |
| Icons     | lucide-react                    |
| Font      | Inter (via next/font/google)    |

---

## How it works (high level)

```
User uploads materials
        ↓
  Document Agent      → extracts concepts & priorities
        ↓
  Curriculum Agent    → builds a learning path (easy / medium / hard)
        ↓
  Story Engine Agent  → generates interactive scenarios
        ↓
  User plays scenario → makes decisions, answers questions
        ↓
  Evaluation Agent    → scores, adapts difficulty, decides next step
        ↕                       ↕
  Media Agent               Tutor Agent
  (visuals on demand)       (help on demand)
```

---

## Status

- [x] Project scaffold (Next.js + Tailwind + TypeScript)
- [x] Chat UI component
- [x] Agent skeletons with typed interfaces
- [x] API route stubs (`/api/chat`, `/api/upload`)
- [x] Shared domain types
- [ ] LLM integration for agents
- [ ] File upload + document parsing
- [ ] Mission/scenario gameplay loop
- [ ] Difficulty adaptation
- [ ] Voice tutor mode

---

## Contributing

1. Create a branch off `main`
2. Make your changes
3. Open a PR with a description of what changed and why
