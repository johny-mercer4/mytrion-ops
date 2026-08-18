## Sponsor

<!-- Human who asked for this change. -->

## Agent

- [ ] `agent:cursor`
- [ ] `agent:claude-code`
- [ ] `agent:cloud`
- [ ] none (human-only)

## Reviewer

PRs into **`build`** require **@johny-mercer4** (John Mercer). Do not merge without that review.

`main` accepts only a PR from **`build`**. Do not open a feature / fix / hotfix PR against `main`.

## Verify

Paste the commands you ran and their results. Do not tick this box from memory.

```
pnpm lint && pnpm typecheck && pnpm test
```

```
<!-- paste output -->
```

## Checkboxes

- [ ] CRM UI change: ran `pnpm build:widget` and committed `apps/mytrion-crm/app/` in this PR. Do not rebuild or commit the mini-app unless that was the task — we are not touching mini-app.
- [ ] Schema change: committed schema `.ts` + generated `.sql` + `meta/_journal.json` together. Did not run `drizzle-kit push`.
- [ ] No schema / no CRM UI: N/A
