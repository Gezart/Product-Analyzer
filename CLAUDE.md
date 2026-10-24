# Rules for Claude

- Answers are always short and direct. No long explanations unless asked.
- Reply in Albanian when the owner writes in Albanian.
- Stack: Next.js + Tailwind, in JavaScript (`.jsx` for React files, `.js` otherwise; no TypeScript). Never add a dependency or service without the owner's confirmation; propose it first.

## Task flow (token-saving)

Tasks and their branch names are in `docs/TASKS.md`. Work through them in order without asking whether to start the next one; ask only when something is unclear or needs approval. One task at a time, start to finish:

1. Implement the task directly (no translator, task-analyzer or team-lead agents).
2. Run the `qa` agent. On FAIL, fix and run `qa` again until PASS.
3. Add a short entry to `docs/HISTORY.md` and set the task's status in `docs/TASKS.md`.
4. Commit, push and open a PR into `staging`. Never merge; the owner merges.

## Notifications

Send a push notification (PushNotification tool) to the owner's phone when they are needed: a PR is ready, a decision or approval is required, credentials are missing, or work is blocked. Not for routine progress.

Manual only, never run unless the owner asks: `customer-tester`, `security-reviewer`.

## Branches

- `main` — production. `staging` — integration. Never push to either directly.
- Every task gets its own branch from `staging`, named after the task in short kebab-case (e.g. `billing`, `product-sync`). No prefixes.
- PRs always target `staging`.

@AGENTS.md
