# devlib Agent Context

This file mirrors the important context from `CLAUDE.md` and adds repo-local layout details for agent sessions.

## Application Context

DevScanner is an Electron desktop app for scanning local project folders, detecting tech stacks, launching dev servers, monitoring processes/logs, managing Docker services, scanning ports, and working with remote servers over SSH.

The actual app lives in `devscanner/`.

## Active Stack

- JavaScript ES2022 with JSX; do not introduce TypeScript.
- Electron 27 for the desktop shell.
- React 18 and ReactDOM with Vite 4 for the renderer.
- Vitest for tests.
- `ssh2` for SSH features.
- `@xterm/xterm` with fit, search, web-links, and unicode11 addons for terminal UI.
- JSON settings are handled through `electron/utils/settings-store.js`; sensitive data should use Electron `safeStorage` where applicable.

## Project Layout

- `devscanner/src/`: React renderer code, hooks, components, styles, and renderer-side API wrapper.
- `devscanner/electron/`: Electron main process, preload bridge, IPC handlers, and utility modules.
- `devscanner/tests/`: Vitest tests for renderer components/hooks and Electron utilities/handlers.
- `devscanner/package.json`: npm scripts and app packaging config.

## Key Areas

- Project scanning and launch logic is in Electron handlers/utilities, surfaced through React hooks and components.
- Docker and Docker Compose support is split across Electron handlers/utilities and renderer modals/components.
- SSH, remote server management, quick deploy, keys, and terminal sessions use `ssh2`, Electron IPC handlers, and xterm-based UI.
- Settings, terminal preferences, command history, and encrypted SSH-related data should go through existing settings/storage utilities instead of ad hoc files.

## Commands

Run commands from `devscanner/` unless a task explicitly targets repository-root files.

- Development: `npm run dev`
- Tests: `npm test`
- Build/package: `npm run build`

`CLAUDE.md` lists `npm test && npm run lint` as the standard verification command. The current `devscanner/package.json` does not define a `lint` script, so run `npm test` and only run `npm run lint` if that script is added.

## Code Style

- Keep changes minimal and aligned with existing JavaScript/JSX conventions.
- Prefer existing handlers, hooks, components, and utility modules before adding new abstractions.
- Do not add backward-compatibility paths unless persisted data, shipped behavior, external consumers, or an explicit requirement makes them necessary.
- Keep Electron main/preload boundaries intact; renderer code should use the existing API bridge instead of direct Node/Electron access.
- Preserve existing React patterns and styling structure.

## Verification

- Add or update Vitest coverage when behavior changes.
- Run `npm test` from `devscanner/` for non-trivial changes.
- For Electron or packaging-sensitive changes, run `npm run build` when feasible.
