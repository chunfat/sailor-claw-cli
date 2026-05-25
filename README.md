# sailor-claw-cli

A minimal TypeScript CLI scaffold for managing workspace creation.

## Usage

Install dependencies:

```bash
npm install
```

Build the CLI:

```bash
npm run build
```

Run the CLI:

```bash
npm start -- init my-workspace
```

This creates a folder under `./.workspaces/my-workspace`.
It also provisions `openclaw.json` from the bundled boilerplate and stores a workspace-specific gateway token in that config.

List existing workspaces:

```bash
npm start -- list
```

Start an OpenClaw container for a workspace:

```bash
npm start -- start my-workspace
```

This starts a detached `alpine/openclaw` container, prints the local gateway URL, and prints the `OPENCLAW_GATEWAY_TOKEN` loaded from the workspace `openclaw.json`.
