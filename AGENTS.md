# AGENTS.md

## Quick start

```sh
npm install
npm run build          # bundle client/ into dist/main.js via esbuild
```

## Build

- `npm run build` (or `prepare`) runs `scripts/build.js` — esbuild bundles `client/main.js` → `dist/main.js` (minified, ESM, es2017 target).
- Edit `client/` files only; `dist/main.js` is generated and gitignored.

## Lint

```sh
npx jshint .    # .jshintrc: esversion 11
```

No test framework, no CI, no typechecking.

## Architecture

- **Server entry**: `main.js` — standard PeerTube plugin `register({ storageManager, registerWebSocketRoute, registerSetting, peertubeHelpers, settingsManager, getRouter })`.
- **Chat server**: `chat_server.js` — WebSocket-based (`ws` package), JSON protocol over route `/connect` registered via `registerWebSocketRoute`.
- **Fediverse OTP**: `activity_pub.js` — sends ActivityPub DM with OTP code via webfinger lookup + signed POST to user's inbox.
- **Client entry**: `client/main.js` — hooks into `action:video-watch.video.loaded`, injects chat into `#plugin-placeholder-player-next`, only for `isLive` videos.
- **Client UI**: `client/html.js` + `client/chat.js` — vanilla JS, no framework.
- **Style**: `assets/style.css` — fixed 20em wide, 66vh tall; responsive break at 1100px.

## Module system

- **Server**: CommonJS (`require` / `module.exports`).
- **Client**: ES modules (`import` / `export`) — bundled by esbuild into `dist/main.js` as ESM.

## Auth methods

| Method | Config | Flow |
|--------|--------|------|
| Local PeerTube user | Automatic | SHA-256 hash of username + server private key |
| Twitch OAuth | `twitchClientId` + `twitchClientSecret` settings | OAuth code flow → `/auth/twitch/callback` |
| Fediverse OTP | None | ActivityPub DM with 6-digit code to `user@domain` |

## Key details

- **WebSocket URL**: `/plugins/ezchat/ws/connect` (hardcoded in `client/main.js:56`).
- **Router base**: dynamic — use `peertubeHelpers.plugin.getBaseRouterRoute()` or `peertubeHelpers.getBaseRouterRoute()` on client.
- **Token derivation**: `crypto.createHash('sha256').update(identifier + serverActor.privateKey).digest('hex')`.
- **Chat state persistence**: `storageManager.storeData("ezchat_users", users)` every 10 min.
- **OAuth redirect URI**: `https://<instance>/plugins/ezchat/<version>/router/auth/twitch/callback` (version must match installed plugin).
- **YouTube/X auth** is stubbed out (commented code in `main.js` and `client/`).
- **Owner detection**: checks `rooms[room].owner == token`, set via `/setprivs` route for video channel owner.
