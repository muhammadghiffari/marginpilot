# apps/agent/src

**Purpose:** Node 22 server: LLM layer (`LlmClient`, provider, `ScriptedLlm`), `compile_mandate`, tool set, orchestrator run loop, `ViemChainPort`, HTTP API + SSE, session notes.
**Owner:** Dev B
**Tasks:** B-07, B-08, B-09, B-10, B-13, B-14, B-17 (P2)
**Spec:** `docs/spec/AGENT-DESIGN.md`, `docs/spec/INTERFACES.md` §4, §10, `docs/spec/ARCHITECTURE.md`.

Keys never appear in prompts, tool results or logs. Empty on purpose: scaffold is B-01. See `docs/spec/REPO-MAP.md`.
