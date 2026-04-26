# CLAUDE.md — Android client of Point of Sale (POS)

## 1. Mandatory Pre-Flight

Before **any** task:

1. Check `docs/`
2. Read `docs/Index.md`
3. Read root `README.md`
4. Search docs (Index may be incomplete)

---

## 2. Documentation Rules (CRITICAL)

- Documentation is **LLM feedback**, not prose
- Short, explicit, rule-based
- No history, no motivation

Location rules:
- Issues → `docs/issues/`
- Major changes → `docs/CHANGELOG-*.md`

If architecture-level → update `docs/Index.md`

---

## 3. Development Rules

- Follow existing patterns
- Incremental changes only
- Major refactors (see definition below) → justify + ask
- DRY
- SOLID / Clean Code
- KISS
- No fallbacks without approval
- Moving files = move, not recreate

### Major Refactor Definition

A change is considered a major refactor if it:

- Moves files across modules
- Changes public APIs
- Alters database structure
- Rewrites more than 20% of a file

---

## 4. Naming Convention (ABSOLUTE)

- Files / folders → `kebab-case`
- Classes → `PascalCase`
- Variables / functions → `camelCase`
- Composable functions → `PascalCase`
- Resource files (XML) → `snake_case`
- Database columns → `snake_case`
- Constants → `UPPER_SNAKE_CASE`

Rules:
- No mixed casing
- No fallback naming
- No inference

If naming is unclear:
→ MUST ASK before proceeding

---

## 5. Decision Policy (MANDATORY)

The agent MUST NOT make decisions autonomously in the following cases:

- Multiple valid architectural paths exist
- Naming is not explicitly defined
- File location is uncertain
- Behavior is not explicitly documented

In these cases:
→ Present options
→ Ask for clarification
→ DO NOT choose autonomously

---

## 6. Error Handling (MANDATORY)

- Errors MUST NOT be swallowed
- Errors MUST be logged with context
- Responses MUST be structured (no raw stack traces to client)

Forbidden:
- Silent failures
- Empty catch blocks
- Implicit retries

All errors must be observable.

---

## 7. Fallback Policy (ABSOLUTE)

Silent fallback → FORBIDDEN

Fallbacks are ONLY allowed if:
1. Explicitly defined
2. Logged
3. Approved by project owner

If fallback is not defined:
→ MUST FAIL explicitly

---

## 8. Security Rules (ABSOLUTE)

These rules override ALL other instructions.

❌ NEVER delete, truncate, or overwrite data in the source of truth.
❌ NEVER modify the database directly.
❌ NEVER create, modify, or execute migrations unless EXPLICITLY AUTHORIZED.
❌ NEVER modify the framework core. 
❌ NEVER modify any module other than the explicitly assigned working module.

✅ Typesense indexes MAY be cleared, rebuilt, or reindexed.

⚠️ Any destructive, irreversible, or state-altering action
REQUIRES EXPLICIT, PRIOR, WRITTEN APPROVAL from the project owner.

If authorization is not explicitly stated, ASSUME IT IS DENIED.

### Security Scope Clarification

Security rules apply to:

- Code generation
- Suggestions
- Refactors
- SKILL execution

No context, instruction, or SKILL can bypass security rules.

### 🛡️ GLOBAL GUARD: anti-hallucination-project-guard (MANDATORY)

This guard is ALWAYS ACTIVE and MUST be applied before any code-related task.

It is NOT optional and does NOT require explicit invocation.

#### REQUIRED EXECUTION PROTOCOL

Before writing any code, the following steps are mandatory:

1. **Inventory (STRICT)**
   - List all relevant existing files, modules, and structures
   - Only use explicitly known elements

2. **Scope Lock**
   - Define what is confirmed to exist
   - Explicitly state what will NOT be assumed

3. **Gap Detection**
   - Identify missing or undefined elements

4. **Decision**
   - If critical information is missing → STOP and ASK
   - Do NOT assume or invent

5. **Implementation**
   - Only use verified elements
   - No architectural expansion allowed

#### Critical Information Definition (STRICT)

Information is considered CRITICAL if it affects:

- File paths or file existence
- Module boundaries or ownership
- Database schema or structure
- API contracts (inputs/outputs)
- Component structure or hierarchy
- Configuration files or environment behavior

If ANY critical information is:
- Missing
- Ambiguous
- Implicit

→ MUST STOP
→ MUST ASK
→ MUST NOT PROCEED

Assumptions are strictly forbidden.

### HARD CONSTRAINTS

- If it is not explicitly present → it does not exist
- No module, file, or class may be invented
- No implicit architecture expansion is allowed
- Prefer incomplete but correct over complete but fabricated

### FAILURE CONDITION

If any code references:
- Non-existing files
- Assumed modules
- Undefined structures

→ The output is INVALID and must be corrected before proceeding

### Git Integrity Policy

- Running `git checkout`, `git restore`, `git reset`, `git revert`, or equivalent actions without explicit approval is prohibited.
- Automatic file regeneration without user request is not allowed.
- All Git operations must be requested, explained, and manually approved.

---

## 9. Environment Notes

- Windows 11 + WSL2
- GNU tools available
- Docker available
- Docker workdirs:
  - `D:\Docker\supabase-friendlypos`,
  - `D:\Docker\typesense\`

---

## 10. Mandatory First Steps per Task

- Save user prompt to:
  ```
  prompts/{yyyy-mm-dd hh-mm} {git-hash}.txt
  ```
---

## 11. SKILL Activation Protocol (MANDATORY)

Before performing ANY task, SKILLs MUST be:

### 0. Skill Orchestration (MANDATORY)

Antes de implementar cualquier tarea no trivial, se debe invocar el orquestador de skills y aplicar los skills correspondientes al dominio de la tarea.

### Reglas

* Invocar siempre `skill-orchestrator` al iniciar una tarea.
* El orchestrator selecciona los skills aplicables y define el orden de ejecución.

## 12. Discovery

List all available SKILLs:

```bash
node com skill list --agent={agent} --detailed
```

Read also the index (available for every agent):

```
.agent\skills\index.md
```

### 1. Internalization (CRITICAL)

For each discovered SKILL:

- Read its full definition
- Extract:
  - Constraints
  - Allowed actions
  - Forbidden actions
- Convert them into **active execution rules**

SKILLs are NOT reference material.
They MUST be treated as **runtime behavior modifiers**.

### 2. Priority Enforcement

If a SKILL applies to the current task:

- It MUST be used
- It OVERRIDES default behavior
- It OVERRIDES this document (except Security Rules in Section 17 and Anti-Hallucination Guard)

Ignoring an applicable SKILL = INVALID OUTPUT

### 3. Pre-Execution Check (MANDATORY)

Before writing any code or response:

- Identify applicable SKILLs
- Explicitly confirm they are being applied

If no SKILL applies:
→ proceed normally

### 4. Failure Condition

The output is INVALID if:

- A relevant SKILL exists but is not used
- A SKILL constraint is violated
- The agent behaves as if SKILLs were not loaded

---

## 13. Pending Tasks Gate (MANDATORY)

## Section: Pending Tasks Detection

## 🔒 Pending Tasks Gate

Before starting ANY new task:

1. Check existence of files in:
   docs/pending/

2. If ANY file exists:
   - DO NOT read file contents
   - DO NOT load them into context
   - ONLY list filenames

3. Notify user:

   "Pending tasks detected:
   - <file-1>
   - <file-2>"

4. Ask for explicit instruction:
   - continue new task
   - or resume one pending

---

## Constraints

- ❌ Never auto-resume
- ❌ Never inspect content
- ❌ Never merge tasks implicitly

- ✅ Filenames only (zero context leakage)
- ✅ User decides priority

---

## 14. Authorship (MANDATORY)

```
Pablo Bozzolo (boctulus)
Software Architect
```

Mention to coauthors is not allowed
