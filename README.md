# DevScanner

Desktop app that scans your project folders, detects tech stacks, and lets you launch dev servers with one click.

![Build](https://github.com/sashkaoligarh/devscanner/actions/workflows/build.yml/badge.svg)

## What it does

Point DevScanner at your projects directory and it will:

- **Detect** languages, frameworks, and project structure (monorepos, subprojects)
- **Parse** Docker Compose services with port mappings and dependencies
- **Launch** projects via npm scripts or Docker with configurable ports
- **Monitor** running processes with real-time log output in tabbed consoles
- **Scan** listening ports on your machine and kill rogue processes
- **Auto-update** when new versions are published

Supports: JavaScript, TypeScript, Python, Go, Rust, PHP, Ruby, Java, Kotlin, C# and frameworks like Next.js, React, Vue, Django, FastAPI, Express, NestJS, Laravel, Rails, Spring Boot, and more.

## Install

Download the latest release for your platform from [GitHub Releases](https://github.com/sashkaoligarh/devscanner/releases):

| Platform | File |
|----------|------|
| Windows  | `DevScanner-Setup-x.x.x.exe` |
| macOS    | `DevScanner-x.x.x-mac.zip` |
| Linux    | `DevScanner-x.x.x.AppImage` |

> **Note:** The app is not code-signed. On macOS, right-click the app and select "Open" to bypass Gatekeeper. On Windows, click "More info" then "Run anyway" in SmartScreen.

After installing, DevScanner checks for updates automatically and shows an in-app banner when a new version is available.

## Development

```bash
cd devscanner
npm install
npm run dev
```

This starts Vite dev server and Electron concurrently. The app opens with DevTools enabled.

### Build locally

```bash
cd devscanner
npm run build
```

Produces platform-specific installers in `devscanner/dist/`.

## Releasing a new version

1. Bump `version` in `devscanner/package.json`
2. Commit the change
3. Tag and push:
   ```bash
   git tag v1.0.1
   git push origin main --tags
   ```
4. GitHub Actions builds for Windows, macOS, and Linux, then publishes artifacts to a GitHub Release
5. Running instances of DevScanner will detect the new version on next launch

## Tech stack

- **Electron 27** &mdash; desktop shell
- **React 18** &mdash; UI
- **Vite 4** &mdash; bundler
- **electron-updater** &mdash; auto-updates via GitHub Releases
- **electron-builder** &mdash; packaging & distribution

## License

MIT
