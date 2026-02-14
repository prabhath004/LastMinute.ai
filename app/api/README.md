# app/api/

Next.js API routes. Each folder maps to an endpoint.

| Route              | Method | Purpose                                   |
| ------------------ | ------ | ----------------------------------------- |
| `/api/chat`        | POST   | Send a message to the tutor agent         |
| `/api/upload`      | POST   | Upload study materials for document analysis |

These routes call into `agents/` for the actual logic and use types from `types/`.
