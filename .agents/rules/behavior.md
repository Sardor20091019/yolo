# Agent Behavior & Safety Policies

## Execution & Command Restrictions
- NEVER run `rm -rf`, disk wipes, or destructive git operations (`git reset --hard`) without explicit human confirmation.
- Safe read-only and build verification commands (`tsc`, `npm test`, `git status`, `git diff`) run automatically in standard sandbox mode.
- Any command requiring elevated sandbox bypass (`BypassSandbox: true`), production DB alterations, or external port binding requires explicit user confirmation.
- If a package installation fails, stop and notify the user; do not attempt blind version downgrades.

## Security Constraints
- DO NOT hardcode API keys, passwords, or tokens. Always use `process.env`.
- Immediately flag any `.env` or credential files that are accidentally left untracked by `.gitignore`.

## Scope Safety
- Do not perform broad refactors across multiple folders unless specifically asked.
- Maintain backward compatibility of API contracts between `apps/api` and `apps/web`.
- In case of conflicting task instructions, this behavior document overrides all other instruction files.
