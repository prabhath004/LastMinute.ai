# agents/

Backend AI agent modules for LastMinute.ai.

Each file represents one agent in the coordinated ecosystem. Agents are called from API routes (`app/api/`) and share types from `types/`.

| File              | Agent                    | Responsibility                                      |
| ----------------- | ------------------------ | --------------------------------------------------- |
| `document.ts`     | Document Analysis Agent  | Parse uploaded materials, extract concepts & structure |
| `curriculum.ts`   | Curriculum Strategy Agent| Prioritize topics, build learning paths by difficulty |
| `story.ts`        | Story Engine Agent       | Generate interactive, narrative-driven scenarios      |
| `media.ts`        | Media Agent              | Produce diagrams, GIFs, and visual aids               |
| `tutor.ts`        | Tutor Agent              | Handle voice/text explanations & doubt resolution     |
| `evaluation.ts`   | Evaluation Agent         | Score responses, adapt difficulty, give feedback      |

## How agents interact

```
Upload → document → curriculum → story → evaluation
                                   ↕          ↕
                                 media      tutor
```

1. **document** ingests raw files and outputs structured concepts
2. **curriculum** takes concepts + chosen difficulty and builds a learning path
3. **story** generates interactive scenarios from the learning path
4. **evaluation** scores user responses and adjusts the path
5. **media** is called by story/tutor when visuals are needed
6. **tutor** is invoked when the user asks for help mid-scenario
