# Territory Game

A 2D browser game starter using Phaser, TypeScript, and Vite. Stage 1: a fully visible grid, a blue player and starting base, automatic movement after Start, arrow-key turns without reversal, three lives, a one-second recovery delay, restart, and pause while the tab is inactive. Movement speed is 86.4 pixels/second across an 864-pixel field (about ten seconds across the full width). No territory capture, opponent, or game clock is included. No external assets, credentials, or backend services are required.

## Requirements

Node.js 22.12+ (24 recommended) and npm.

## Development

```sh
npm ci
npm run dev -- --port 5173 --strictPort
```

Vite serves the application on port 5173 with hot module replacement and binds to all interfaces for cloud development.

## Validation and production build

```sh
npm run typecheck
npm run build
npm run preview -- --port 4173 --strictPort
```

The build validates TypeScript and writes the static application to `dist/`. Preview serves that build on port 4173 for local validation. Deploy `dist/` to a static web host.

## Files

- `src/main.ts`: Phaser configuration and initial scene.
- `src/style.css`: full-screen layout.
- `index.html`: Vite entry point.

Commit the dependency lockfile for repeatable installations. No automated gameplay test suite is configured yet.
