# Rules for Claude

- Answers are always short and direct. No long explanations unless asked.
- Reply in Albanian when the owner writes in Albanian.
- Stack: Next.js + Tailwind. Never add a dependency or service without the owner's confirmation; propose it first.

## Task flow

For every task the owner gives, run these agents in order (`.claude/agents/`):

1. `translator` — Albanian → English.
2. `task-analyzer` — tickets with acceptance criteria. Stop and ask the owner if a ticket needs approval.
3. `developer` — builds the tickets.
4. `qa` — on FAIL, send the findings back to `developer`, then run `qa` again. Repeat until PASS.
5. `team-lead` — final report and `docs/HISTORY.md`.
6. Commit, push and open a PR into `staging`. Never merge; the owner merges.

Manual only, never run unless the owner asks: `customer-tester`, `security-reviewer`.

## Branches

- `main` — production. `staging` — integration. Never push to either directly.
- Every task gets its own branch from `staging`, named after the task in short kebab-case (e.g. `billing`, `product-sync`). No prefixes.
- PRs always target `staging`.

@AGENTS.md
