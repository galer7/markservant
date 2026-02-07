---
description: Research codebase comprehensively using parallel sub-agents
model: opus
---

# Research Codebase

You are tasked with conducting comprehensive research across the codebase to answer questions by spawning parallel sub-agents and synthesizing their findings.

## Initial Setup:

When this command is invoked, check if arguments were provided:

1. **If arguments provided** (e.g., `/research how does TTS chunking work`):
   - Use the argument as the research question
   - If it references an issue file (e.g., `thoughts/shared/issues/something.md`), read it FULLY first
   - Begin the research process immediately

2. **If no arguments provided**, respond with:
```
I'm ready to research the codebase. Please provide your research question or area of interest.

You can also reference an issue file: `/research thoughts/shared/issues/my-issue.md`
```

Then wait for the user's research query.

## Steps to follow after receiving the research query:

1. **Read any directly mentioned files first:**
   - If the user mentions specific files (issues, docs, JSON), read them FULLY first
   - **IMPORTANT**: Use the Read tool WITHOUT limit/offset parameters to read entire files
   - **CRITICAL**: Read these files yourself in the main context before spawning any sub-tasks
   - This ensures you have full context before decomposing the research

2. **Analyze and decompose the research question:**
   - Break down the user's query into composable research areas
   - Think deeply about the underlying patterns, connections, and architectural implications
   - Identify specific components, patterns, or concepts to investigate
   - Create a research plan using TodoWrite to track all subtasks
   - Consider which directories, files, or architectural patterns are relevant

3. **Spawn parallel sub-agent tasks for comprehensive research:**
   - Create multiple Task agents to research different aspects concurrently

   The key is to use these agents intelligently:
   - Start with **codebase-locator** agents to find what exists
   - Then use **codebase-analyzer** agents on the most promising findings
   - Use **codebase-pattern-finder** when looking for similar implementations
   - Run multiple agents in parallel when they're searching for different things
   - Each agent knows its job - just tell it what you're looking for

4. **Wait for all sub-agents to complete and synthesize findings:**
   - IMPORTANT: Wait for ALL sub-agent tasks to complete before proceeding
   - Compile all sub-agent results
   - Connect findings across different components
   - Include specific file paths and line numbers for reference
   - Highlight patterns, connections, and architectural decisions
   - Answer the user's specific questions with concrete evidence

5. **Gather metadata for the research document:**
   - Run: `git rev-parse HEAD` for commit hash
   - Run: `git branch --show-current` for branch name
   - Get today's date
   - Filename: `thoughts/shared/research/YYYY-MM-DD-description.md`
     - If referencing an issue file, include the issue identifier:
       `thoughts/shared/research/YYYY-MM-DD-ISSUE-ID-description.md`
     - Examples:
       - With issue: `2025-01-08-tts-chunking-strategy.md`
       - Generic: `2025-01-08-authentication-flow.md`

6. **Generate research document:**
   - Use the metadata gathered in step 5
   - Structure the document with YAML frontmatter followed by content:
     ```markdown
     ---
     date: [Current date and time with timezone in ISO format]
     researcher: claude
     git_commit: [Current commit hash]
     branch: [Current branch name]
     repository: markservant
     topic: "[User's Question/Topic]"
     tags: [research, codebase, relevant-component-names]
     status: complete
     last_updated: [Current date in YYYY-MM-DD format]
     ---

     # Research: [User's Question/Topic]

     **Date**: [Current date and time with timezone]
     **Git Commit**: [Current commit hash]
     **Branch**: [Current branch name]

     ## Research Question
     [Original user query]

     ## Summary
     [High-level findings answering the user's question]

     ## Detailed Findings

     ### [Component/Area 1]
     - Finding with reference (`file.ext:line`)
     - Connection to other components
     - Implementation details

     ### [Component/Area 2]
     ...

     ## Code References
     - `path/to/file.ts:123` - Description of what's there
     - `another/file.ts:45-67` - Description of the code block

     ## Architecture Insights
     [Patterns, conventions, and design decisions discovered]

     ## Related Documents
     [Links to other research or plans in thoughts/shared/]

     ## Open Questions
     [Any areas that need further investigation]
     ```

7. **Present findings:**
   - Present a concise summary of findings to the user
   - Include key file references for easy navigation
   - Let the user know where the full research document was saved
   - Ask if they have follow-up questions

8. **Handle follow-up questions:**
   - If the user has follow-up questions, append to the same research document
   - Update the frontmatter `last_updated` field
   - Add a new section: `## Follow-up Research [timestamp]`
   - Spawn new sub-agents as needed for additional investigation

## Important notes:
- Always use parallel Task agents to maximize efficiency and minimize context usage
- Always run fresh codebase research - never rely solely on existing research documents
- Focus on finding concrete file paths and line numbers for developer reference
- Research documents should be self-contained with all necessary context
- Each sub-agent prompt should be specific and focused on read-only operations
- Consider cross-component connections and architectural patterns
- Keep the main agent focused on synthesis, not deep file reading
- Explore the full monorepo: packages/cli/, packages/vscode-extension/, and root configs
- **File reading**: Always read mentioned files FULLY (no limit/offset) before spawning sub-tasks
- **Critical ordering**: Follow the numbered steps exactly
  - ALWAYS read mentioned files first before spawning sub-tasks (step 1)
  - ALWAYS wait for all sub-agents to complete before synthesizing (step 4)
  - ALWAYS gather metadata before writing the document (step 5 before step 6)
  - NEVER write the research document with placeholder values
