# OCS vendored source

- Upstream: <https://github.com/ocsjs/ocsjs>
- Version: `4.15.3`
- Commit: `890686a5e54f9a6d52d1169bae9ea5971e0863c7`
- License: MIT (`ocsjs-LICENSE.txt`)
- Generated file: `../userscripts/multiplatform.js`

The generated userscript keeps the platform adapters and course automation from
the upstream release. `desktop/scripts/vendor-ocs.cjs` narrows page matches to
HTTPS, rejects the upstream-wide `*.edu.cn` / `*.org.cn` permissions, removes
external answer-bank connections, applies CPU Web branding, and routes answers
through the desktop-only `desktop.localhost` bridge. The browser-only warning
that forbids minimizing/switching away is disabled because learning views are
created with Electron background throttling disabled; task execution remains
active while the app is minimized or on another desktop.

Regenerate after reviewing a new upstream release:

```powershell
node desktop/scripts/vendor-ocs.cjs C:\path\to\ocsjs\dist\ocs.user.js
```
