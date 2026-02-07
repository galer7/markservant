# Mermaid Support Implementation Plan

## Overview

Add Mermaid diagram rendering by forking `markserv` and injecting client-side Mermaid.js.

## Prerequisites

- Node.js 18+
- npm
- markserv source code understanding

## Implementation Phases

### Phase 1: Fork and Prepare markserv

**Goal**: Create a local fork of markserv we can modify.

#### Tasks

1. [x] Clone markserv repository
   ```bash
   git clone https://github.com/markserv/markserv.git ~/p/markserv-mermaid
   ```

2. [x] Verify local markserv runs
   ```bash
   cd ~/p/markserv-mermaid
   npm install
   npm link  # Makes it available as 'markserv' globally
   ```

3. [x] Identify template file location
   - **File**: `lib/templates/markdown.html`
   - **Purpose**: Handlebars template for rendered markdown pages

---

### Phase 2: Add Mermaid Script Injection

**Goal**: Modify the HTML template to include Mermaid.js.

#### Tasks

1. [x] Open `lib/templates/markdown.html`

2. [x] Add Mermaid script before `</body>`:
   ```html
   <!-- Mermaid diagram support -->
   <script src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js"></script>
   <script>
     mermaid.initialize({
       startOnLoad: false,
       theme: 'default',
       securityLevel: 'loose'
     });

     // Convert code blocks with language-mermaid to mermaid diagrams
     document.querySelectorAll('code.language-mermaid, code.hljs.language-mermaid').forEach(function(codeBlock, index) {
       var pre = codeBlock.parentElement;
       var container = document.createElement('div');
       container.className = 'mermaid';
       container.textContent = codeBlock.textContent;
       pre.parentNode.replaceChild(container, pre);
     });

     mermaid.run();
   </script>
   ```

3. [x] Verify the template structure (find where `</body>` is)

---

### Phase 3: Test Mermaid Rendering

**Goal**: Verify diagrams render correctly.

#### Test Cases

1. [x] **Flowchart**
   ````markdown
   ```mermaid
   graph TD
       A[Start] --> B{Decision}
       B -->|Yes| C[Do something]
       B -->|No| D[Do something else]
       C --> E[End]
       D --> E
   ```
   ````

2. [x] **Sequence Diagram**
   ````markdown
   ```mermaid
   sequenceDiagram
       Alice->>Bob: Hello Bob
       Bob-->>Alice: Hi Alice
   ```
   ````

3. [x] **Class Diagram**
   ````markdown
   ```mermaid
   classDiagram
       Animal <|-- Duck
       Animal <|-- Fish
       Animal: +int age
       Animal: +String gender
   ```
   ````

4. [x] **Error Handling** - Invalid syntax should show error message

5. [x] **Regular Code Blocks** - JavaScript/Python should still highlight

---

### Phase 4: Integration with markservant

**Goal**: Make markservant use the forked markserv.

#### Option A: Local npm link (Development)

```bash
cd ~/p/markserv-mermaid
npm link

# markservant now uses the linked version
msv start  # Should use forked markserv
```

#### Option B: Publish Fork (Production)

1. [ ] Rename package to `markserv-mermaid` in package.json
2. [ ] Publish to npm: `npm publish`
3. [ ] Update markservant to use `markserv-mermaid` instead

#### Option C: Git Dependency (Recommended) ✓

1. [x] Push fork to GitHub as `galer7/markserv` (proper GitHub fork)
2. [x] Install globally:
   ```bash
   npm install -g github:galer7/markserv
   ```

---

### Phase 5: Documentation ✓

**Goal**: Update README and docs.

#### Tasks

1. [x] Update markservant README to mention Mermaid support
2. [x] Add usage examples with Mermaid diagrams
3. [x] Document the forked markserv dependency

---

## File Changes Summary

### galer7/markserv (forked repo)

| File | Change |
|------|--------|
| `lib/templates/markdown.html` | Add Mermaid script tags |

### markservant (this repo)

| File | Change |
|------|--------|
| `README.md` | Document Mermaid support |
| `docs/mermaid-support/*` | This documentation |

---

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| markserv updates break fork | Pin to specific commit, periodically rebase |
| Mermaid CDN unavailable | Could bundle locally as fallback |
| Large diagrams slow to render | Client-side issue, out of our control |

---

## Estimated Effort

| Phase | Complexity |
|-------|------------|
| Phase 1: Fork | Simple |
| Phase 2: Script injection | Simple (2 lines) |
| Phase 3: Testing | Medium |
| Phase 4: Integration | Simple |
| Phase 5: Documentation | Simple |

**Total**: Low complexity, ~1-2 hours of work

---

## Success Criteria

- [x] Mermaid diagrams render in browser
- [x] Live reload works with Mermaid files
- [x] Existing markservant functionality unchanged
- [x] Documentation updated
