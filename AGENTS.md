# CPU-web repository instructions

## Mandatory production push gate

These requirements apply to every remote push from this repository, including documentation-only pushes.

1. Preserve unrelated user files and selectively stage only the files that belong to the current task.
2. Finalize the commit first. In the clean tracked worktree at the exact `HEAD` that will be pushed, run `npm run verify:push` from the repository root.
3. `verify:push` must finish successfully. It compiles the server, web client, and VoiceHub; a partial build or type-check alone does not satisfy this gate.
4. Do not push when the local gate fails. Fix the failure, finalize the commit, and rerun the full gate.
5. After pushing, verify that `HEAD` equals the intended remote commit. For pushes to `main`, wait for the `Linux deployment artifact` workflow for that exact full commit SHA, require it to succeed, and verify that the commit-bound artifact exists.
6. A successful `git push` without the completed local build and exact-SHA CI artifact verification is not a completed production push.
7. Pushing and compiling do not authorize a production deployment. Deploy only when the user explicitly requests it.

The detailed, auditable procedure is in `docs/production-requirements.md`.
