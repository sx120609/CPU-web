# CPU-web repository instructions

## Mandatory production push gate

These requirements apply to every push to `main`, including documentation-only pushes.

1. Preserve unrelated user files and selectively stage only the files that belong to the current task.
2. Local tests, type-checks, or builds may be run when appropriate, but there is no mandatory local full-build gate. Local output is not an official production artifact and is not proof that a production push is complete.
3. Push the finalized commit, then verify that local `HEAD` equals the intended remote commit.
4. GitHub Actions is the authoritative production builder. Wait for the `Linux deployment artifact` workflow for the exact full commit SHA, require it to build the server, web client, and VoiceHub successfully on Ubuntu 24.04 with Node.js 24, and verify that the commit-bound artifact exists.
5. A successful `git push`, a local build, or a workflow run for a different SHA is not a completed production push. CI pending, failed, cancelled, missing, or missing its artifact must be reported as incomplete.
6. Production deployment must consume the verified GitHub artifact rather than treating a local or production-server compilation as the normal production path.
7. Pushing and GitHub compilation do not authorize a production deployment. Deploy only when the user explicitly requests it.

The detailed, auditable procedure is in `docs/production-requirements.md`.
