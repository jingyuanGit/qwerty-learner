# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

Qwerty Learner is a React + TypeScript SPA that combines English (and other language) vocabulary memorization with touch-typing practice. Users type out words from a chosen dictionary chapter-by-chapter; the app tracks speed/accuracy and persists practice history.

This checkout is a personal fork of the upstream RealKai42/qwerty-learner project. The most significant local deviation: the original app persisted progress client-side via Dexie (IndexedDB); this fork replaced that with a local Express + better-sqlite3 backend (see "Persistence layer" below).

## Commands

Package manager is Yarn (per README), though `package-lock.json` is also present.

- `yarn dev` — start the Vite dev server only (frontend at `http://localhost:5173`, API calls to `/api` proxy to `http://localhost:3001`)
- `yarn dev:api` — start the Express/sqlite backend alone (`server/index.cjs`, port 3001)
- `yarn dev:full` — run both API and frontend concurrently (needed for practice-record persistence to work locally)
- `yarn build` — production build via Vite (`cross-env CI=false vite build --base=./`), outputs to `build/`
- `yarn start` — run the built app served by the Express server (`node server/index.cjs`)
- `yarn lint` — ESLint over the whole repo
- `yarn prettier` — format the whole repo with Prettier
- `yarn test:e2e` — Playwright end-to-end tests. Note: `playwright.config.ts` defaults `baseURL` to the production site (`https://qwerty.kaiyi.cool`), not localhost — pass `--project=chromium` / use `PLAYWRIGHT_TEST_BASE_URL` or edit the config to target a local server. Run a single spec with `yarn test:e2e tests/e2e/practice.spec.ts`, or a single test with `-g "test name"`.
- `yarn test` — no unit test runner is configured (script is a no-op placeholder)

Husky + lint-staged run Prettier on staged `src/**` files on commit.

## Architecture

### Data flow for a typing session

- `src/pages/Typing/store` holds a `useReducer`-based state machine (`TypingContext`, `typingReducer`, `TypingStateActionType`) that owns the in-progress chapter: current word index, correct/wrong counts, per-word input logs, timer/WPM/accuracy. Actions like `NEXT_WORD`, `SKIP_WORD`, `REPEAT_CHAPTER`, `FINISH_CHAPTER` drive it; it uses `structuredClone` for state resets (chapter/rep changes) rather than an immer-style draft everywhere.
- Cross-cutting config/UI state (sound, phonetics, dictation mode, review mode, dark mode, etc.) lives in Jotai atoms under `src/store` (`atomForConfig`/`atomWithStorage` wrap localStorage-backed atoms).
- Dictionaries are described in `src/resources/dictionary.ts` (metadata: id, name, category, url to a JSON word list under `public/dicts`, word count) and looked up by id via `idDictionaryMap`.

### Persistence layer — read this before touching `src/utils/db`

`src/utils/db/index.ts` does **not** use Dexie despite the `dexie*` packages still in `package.json`. It exports a hand-rolled `db` object (`db.wordRecords`, `db.chapterRecords`, `db.reviewRecords`) whose `TableAdapter`/`QueryChain` classes intentionally mimic the Dexie query API (`.where().equals().toArray()`, `.add()`, `.count()`, `.orderBy().first()`) so the rest of the app's call sites didn't need to change. Under the hood every call does a `fetch` to `/api/...` on the Express server in `server/index.cjs`, which stores rows in `progress.sqlite` via `better-sqlite3` (WAL mode). Because it's a thin re-implementation, not every Dexie query feature is supported — e.g. `QueryChain.delete()` only implements the error-book `where({ word, dict }).delete()` path and throws for other tables.

Implication: the frontend cannot persist practice/error-book/review history unless the Express API is running (`yarn dev:api` or `yarn dev:full`); running `yarn dev` alone will have failing `fetch` calls to `/api/*`.

`progress.sqlite`, `progress.sqlite-shm`, `progress.sqlite-wal` are the local database files — listed in `.gitignore` but currently force-added/tracked in this repo's history; be careful not to overwrite the user's real practice data when regenerating them.

### Routing / pages

`src/index.tsx` sets up `react-router-dom` routes: desktop layout wraps `/` (Typing), `/gallery`, `/analysis`, `/error-book`, `/friend-links` behind a shared header/context, while `/mobile` is a separate standalone route/layout (`src/pages/Mobile`). `REACT_APP_DEPLOY_ENV=pages` switches the router `basename` to `/qwerty-learner` for GitHub Pages deployment.

### Other build targets

- `src-tauri/` — a Tauri (Rust) desktop-app wrapper around the same frontend.
- `Dockerfile` / `docker-compose.yaml` — containerized deployment running the Express server + built frontend together.
- `vite.config.ts` embeds the latest git commit hash into the build (`LATEST_COMMIT_HASH`) and drops `console`/`debugger` in non-development builds.

## Code style

- Prettier config: no semicolons, single quotes, 140 print width, trailing commas everywhere, import sorting via `@trivago/prettier-plugin-sort-imports`, Tailwind class sorting via `prettier-plugin-tailwindcss`.
- ESLint extends `prettier` (formatting deferred to Prettier) plus React/TypeScript recommended rules for files under `src/**`; `@typescript-eslint/consistent-type-imports` is enforced (use `import type`).
- Path alias `@/*` maps to `src/*` (configured in both `vite.config.ts` and `tsconfig.json`).
