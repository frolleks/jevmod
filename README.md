# Soter (Σωτήρ)

[Discord server](https://discord.gg/xURTvZUANp)

Soter is an automated Discord moderation bot, powered by Jev.

Soter moderates mostly on its own: every message is scanned for hate speech
and spam, clear cases are removed, borderline ones are flagged to the mods,
and repeat violators are timed out automatically. There are no
manual mod commands — use Discord's own kick/ban/timeout for that. Anyone
can `/report` a member to open a private ticket with the mods; `/settings`
configures the automation.

[Add this bot to your server!](https://discord.com/oauth2/authorize?client_id=1551459097826693130&permissions=1099645938896&integration_type=0&scope=bot) **_(warning: the bot is still in early development and is not on 24/7. data may be deleted any time)_**

## Local setup

```
bun install
cp .env.example .env   # fill in DISCORD_TOKEN and OPENROUTER_API_KEY
bun start               # or `bun dev` to auto-restart on changes
```

Invite the bot with the `applications.commands` and `bot` scopes, and grant
it **Manage Messages**, **Moderate Members**, **Manage Channels** (report
tickets), **Read Message History** (report scans) and **Embed Links** (mod
log and report embeds). Enable the **Message Content** intent for the bot in
the Discord Developer Portal.

Run the tests with `bun test`.

To check how Jev's calls hold up without any users, run `bun run eval [n]`
(default 100). It sends a sample of [HateCheck](https://huggingface.co/datasets/Paul/hatecheck)
cases and a few spam scenarios through the same judgment the bot uses, then reports
false removals, missed hate speech, and how different confidence thresholds would
perform. It costs one Jev call per case.

## Commands

- `/ping` — Pong. (will remove in the future)
- `/help` — Shows this usage guide in Discord.
- `/report <user> <type> <from> [to]` — report a member (only `hate speech` for now). Dates are `YYYY-MM-DD` in UTC; `to` includes that whole day and defaults to now. Opens a private ticket channel that only the reporter, the bot, admins, and roles with Moderate Members can see. The ticket shows the member's messages in that range, from channels the reporter can see, as an embed with Previous/Next buttons (10 messages per page), and Jev's confidence score for them. One report per user every 5 minutes, except for members with Manage Server or Administrator.
- `/settings exempt-add <channel>` / `exempt-remove <channel>` / `exempt-list` — stop or resume scanning a channel.
- `/settings hate-speech <enabled>` — toggle the hate speech filter. Above 80% Jev confidence a message is deleted right away and the deletion is logged; between 50% and 80% it's left up and logged with a jump link for a mod to review.
- `/settings mod-log-channel <channel>` — where spam flags, hate speech deletions and borderline cases, auto-timeouts and new report tickets get logged, each as a color-coded embed (red: deleted, yellow: needs review, orange: timed out, blurple: new report). Without one set, these are dropped.
- `/settings timeout-config <threshold> <minutes>` — how many violations trigger an auto-timeout, and for how long.
