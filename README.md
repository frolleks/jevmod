# Soter (Σωτήρ)

[Discord server](https://discord.gg/xURTvZUANp)

Soter is an automated Discord moderation bot, powered by Jev.

Soter moderates mostly on its own: every message is scanned for hate speech
and spam, and repeat violators are timed out automatically. There are no
manual mod commands — use Discord's own kick/ban/timeout for that. The
commands below are just for configuring the automation.

[Add this bot to your server!](https://discord.com/oauth2/authorize?client_id=1551459097826693130&permissions=201403398&integration_type=0&scope=bot) **_(warning: the bot is still in early development and is not on 24/7. data may be deleted any time)_**

## Local setup

```
bun install
cp .env.example .env   # fill in DISCORD_TOKEN and OPENROUTER_API_KEY
bun start               # or `bun dev` to auto-restart on changes
```

Invite the bot with the `applications.commands` and `bot` scopes, and grant
it **Manage Messages** and **Moderate Members**. Enable the **Message
Content** intent for the bot in the Discord Developer Portal.

## Commands

- `/ping` — Pong. (will remove in the future)
- `/help` — Shows this usage guide in Discord.
- `/settings exempt-add <channel>` / `exempt-remove <channel>` / `exempt-list` — stop or resume scanning a channel.
- `/settings hate-speech <enabled>` — toggle the hate speech filter.
- `/settings mod-log-channel <channel>` — where spam flags and auto-timeouts get logged.
- `/settings timeout-config <threshold> <minutes>` — how many violations trigger an auto-timeout, and for how long.
