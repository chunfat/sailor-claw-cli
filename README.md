# sailor-claw-cli

A minimal TypeScript CLI for managing workspace creation.

## Environment setup

Create a local `.env` file before running the CLI:

```bash
cp .env.sample .env
```

Set these main environment variables:

```env
TELEGRAM_BOT_TOKEN=your_telegram_bot_token
OPENROUTER_API_KEY=your_openrouter_api_key
```

To get a `TELEGRAM_BOT_TOKEN`:

1. Open Telegram and search for `@BotFather`.
2. Start a chat with BotFather and send `/newbot`.
3. Follow the prompts to set your bot name and username.
4. BotFather will return an HTTP API token.
5. Copy that value into your `.env` file as `TELEGRAM_BOT_TOKEN=...`.

To configure Telegram access in a workspace after running `init`, get your Telegram user ID from [@getmyid_bot](https://t.me/getmyid_bot) and run:

```bash
npm start -- set-telegram-allow-from-owner my-workspace 123456789
```

This command updates `./.workspaces/<workspace-name>/openclaw.json` and sets both Telegram allowlists for that user:

Use these two fields together:

```json
{
  "channels": {
    "telegram": {
      "allowFrom": ["123456789"]
    }
  },
  "commands": {
    "ownerAllowFrom": ["telegram:123456789"]
  }
}
```

- `channels.telegram.allowFrom` should contain the raw Telegram user ID.
- `commands.ownerAllowFrom` should contain the same ID prefixed with `telegram:`.

This means:

1. `channels.telegram.allowFrom` allows that Telegram user to talk to the bot.
2. `ownerAllowFrom` marks that same Telegram user as an owner for privileged commands.

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

Configure Telegram access for a workspace:

```bash
npm start -- set-telegram-allow-from-owner my-workspace 123456789
```
