---
description: Implement technical plans from thoughts/shared/plans with verification
---

# Implement Plan

You are tasked with implementing an approved technical plan from `thoughts/shared/plans/`. These plans contain phases with specific changes and success criteria.

## Getting Started

When this command is invoked:

1. **If a plan path was provided** (e.g., `/implement thoughts/shared/plans/2025-01-08-feature.md`):
   - Read the plan completely and check for any existing checkmarks (`- [x]`)
   - Read any referenced issue files and research documents mentioned in the plan
   - Read all source files mentioned in the plan
   - **Read files fully** - never use limit/offset parameters, you need complete context
   - Think deeply about how the pieces fit together
   - Create a todo list to track your progress
   - Start implementing if you understand what needs to be done

2. **If no plan path provided**:
   - List available plans: `ls thoughts/shared/plans/`
   - Present them to the user and ask which one to implement
   - If no plans exist, suggest using `/plan` first to create one

## Implementation Philosophy

Plans are carefully designed, but reality can be messy. Your job is to:
- Follow the plan's intent while adapting to what you find
- Implement each phase fully before moving to the next
- Verify your work makes sense in the broader codebase context
- Update checkboxes in the plan as you complete sections

When things don't match the plan exactly, think about why and communicate clearly. The plan is your guide, but your judgment matters too.

If you encounter a mismatch:
- STOP and think deeply about why the plan can't be followed
- Present the issue clearly:
  ```
  Issue in Phase [N]:
  Expected: [what the plan says]
  Found: [actual situation]
  Why this matters: [explanation]

  How should I proceed?
  ```

## Verification Approach

After implementing a phase:

1. **Run automated verification** - the standard checks for this project:
   - `pnpm check` - Runs biome lint/format check + typecheck + tests
   - Or individually:
     - `pnpm test` - All tests
     - `pnpm typecheck` - TypeScript type checking
     - `pnpm lint` - Biome linting
   - Package-specific when relevant:
     - `pnpm --filter markservant test` - CLI tests only
     - `pnpm --filter markservant-tts test` - VS Code extension tests only

2. **Fix any issues** before proceeding

3. **Update progress** in both the plan and your todos:
   - Check off completed items in the plan file itself using Edit
   - Mark automated verification items as done

4. **Pause for human verification**: After completing all automated verification for a phase, pause and inform the human:
   ```
   Phase [N] Complete - Ready for Manual Verification

   Automated verification passed:
   - [List automated checks that passed]

   Please perform the manual verification steps listed in the plan:
   - [List manual verification items from the plan]

   Let me know when manual testing is complete so I can proceed to Phase [N+1].
   ```

If instructed to execute multiple phases consecutively, skip the pause until the last phase. Otherwise, assume you are just doing one phase.

Do not check off items in the manual testing steps until confirmed by the user.

## If You Get Stuck

When something isn't working as expected:
- First, make sure you've read and understood all the relevant code
- Consider if the codebase has evolved since the plan was written
- Present the mismatch clearly and ask for guidance

Use sub-tasks sparingly - mainly for targeted debugging or exploring unfamiliar territory.

## Resuming Work

If the plan has existing checkmarks:
- Trust that completed work is done
- Pick up from the first unchecked item
- Verify previous work only if something seems off

## Committing Work

After completing a phase (or set of phases):
- Stage only the files you changed
- Write a clear commit message describing what was implemented
- Reference the plan and any related issue
- Do NOT push unless the user asks

Remember: You're implementing a solution, not just checking boxes. Keep the end goal in mind and maintain forward momentum.
