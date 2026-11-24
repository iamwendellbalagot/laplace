# Agent Instructions

1. Always load and follow the `caveman` and `ponytail` skills for every task and response, unless higher-priority instructions conflict.
2. Commit all completed work.
3. Update `status.md` whenever work is completed.
4. When developing a feature, add and run only the tests necessary to verify that feature; avoid unrelated or full-suite checks unless warranted by the change.
5. Do not run automated native-app tests. Verify native app behavior manually only when explicitly requested; use focused unit/type/build checks for code changes.
6. Prefer aggressive, minimal implementation. Run only necessary focused checks; do not run full suites or unrelated checks unless required to resolve a concrete failure.
7. Do not automatically run UI tests. Run them only when the user explicitly asks.
