# Implementation Plan: markservant

## Project Structure

```
markservant/
  pnpm-workspace.yaml       # workspace: packages/*
  turbo.json                 # build, test, lint, typecheck, check tasks
  package.json               # root: private, scripts delegate to turbo
  .npmrc                     # ignore-scripts, shamefully-hoist=false
  biome.json                 # lint + format: JS for CLI, TS for extension
  lefthook.yml               # pre-commit: lint + typecheck + test
  packages/
    cli/                     # msv CLI (JS/ESM, 259 tests)
      package.json
      vitest.config.js
      bin/msv.js
      src/commands/
      src/lib/
    vscode-extension/        # TTS extension (TypeScript, 100 tests)
      package.json
      tsconfig.json
      esbuild.config.mjs
      src/
      media/
  docs/
    initial/
    dotfiles-support/
    mermaid-support/
    tts-research/            # TTS-specific plan + specs
```

## Completed Phases

### Phase 0: Monorepo — DONE

Converted from single-package npm to pnpm monorepo with turbo orchestration.

- pnpm workspace with `packages/*`
- turbo tasks: build, test, lint, typecheck, check
- ~~ESLint flat config~~ replaced by Biome in Phase 5
- lefthook pre-commit hooks (lint + format + typecheck + test in parallel)
- `.npmrc` with `ignore-scripts=true` + `pnpm.onlyBuiltDependencies` allowlist
- `pnpm security` script = `pnpm audit`

### Phase 1: CLI (`msv`) — DONE

See `docs/initial/IMPLEMENTATION_PLAN.md` for details. Commands: add, rm, list, open, start, stop.

### Phase 2: Dotfiles support — DONE

See `docs/dotfiles-support/IMPLEMENTATION_PLAN.md`.

### Phase 3: Mermaid support — DONE

See `docs/mermaid-support/IMPLEMENTATION_PLAN.md`.

### Phase 5: Replace ESLint with Biome — quality gates

Motivated by [ghuntley.com/pressure](https://ghuntley.com/pressure/) — fast back-pressure (lint + format) catches invalid generations early, especially for AI-assisted workflows.

**Why Biome over ESLint:**
- Single binary for lint + format (replaces ESLint + Prettier)
- ~100x faster — sub-second even on large codebases
- Supports JS, TS, JSON, CSS out of the box
- Zero plugins needed for this project's rules

**Steps:**
1. Remove ESLint deps (`eslint`, `@eslint/js`, `globals`, `typescript-eslint`) and `eslint.config.js`
2. Install `@biomejs/biome` as root devDependency
3. Create `biome.json` at repo root — lint + format config matching current ESLint rules
4. Update `lint` scripts in root + both package.json files to use `biome lint`
5. Add `format` script (`biome format`) and `format:check` for CI
6. Update turbo.json: add `format` task, update `check` to include format
7. Update lefthook.yml: add `format` command to pre-commit
8. Run `biome check --write` to auto-format entire codebase
9. Verify `pnpm check` passes (quality gate: lint + format + typecheck + test)

---

## Verification Commands

```bash
pnpm install                          # clean install
pnpm test                             # 259 CLI + 100 extension tests
pnpm lint                             # biome lint, zero errors
pnpm format                           # biome format --write
pnpm format:check                     # biome format (CI check, no write)
pnpm typecheck                        # zero TS errors
pnpm check                            # lint + format:check + typecheck + test (quality gate)
pnpm security                         # pnpm audit
pnpm --filter markservant-tts build   # extension build
```
