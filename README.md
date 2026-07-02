# StandAId

AI-powered compliance assistant for Australian tradies. Upload Australian Standards (AS/NZS), ask questions in plain tradie language, and get clause-referenced answers you can trust on site.

## Features

- **Upload standards** — PDFs are extracted, chunked by clause, and indexed for search
- **Ask questions** — voice or text, with answers cited back to exact clauses, tables, and figures
- **Photo compliance checks** — snap an installation and get it assessed against your standards
- **Learn & exam mode** — study standards and practise for capstone-style exams

## Tech stack

- **Frontend:** React + TypeScript + Vite, shadcn/ui, Tailwind CSS (PWA)
- **Backend:** Supabase — Postgres (pgvector), Auth, Storage, Edge Functions (Deno)
- **AI:** Claude (answers, OCR, figure descriptions), OpenAI (embeddings)
- **Hosting:** Vercel

## Development

```sh
npm install
npm run dev        # dev server on http://localhost:8080
npm test           # unit tests (vitest)
npm run lint       # eslint
npm run build      # production build
```

Edge functions live in `supabase/functions/`, database migrations in `supabase/migrations/`.

See `DEV.md` for architecture details and locked fixes that must not be reverted.
