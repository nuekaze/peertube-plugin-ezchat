# Emote Support for EZChat

Date: 2026-07-20

## Overview

Add emote support to the PeerTube EZChat plugin using Discord-style `:code:` syntax. Instance administrators can upload custom emote images through a custom admin panel. Emotes are replaced with `<img>` tags in chat messages, and an autocomplete picker helps users find emotes while typing.

## Architecture

```
Server (main.js)
├── Admin page: GET/POST /admin/emotes
│   - Bulk image upload (multiple files)
│   - Inline code name assignment per emote
│   - Delete emotes
│   - Auth: admin-only via peertubeHelpers.user API
│   - Persistence: storageManager.storeData("ezchat_emotes", {code: filename})
├── Emote image serving: GET /emotes/:filename
│   - Reads from plugin data directory
│   - Sets correct Content-Type, streams file
└── chat_server.js
    - JOIN handler reads emote map from storageManager
    - Includes emotes object in JOIN response payload

Client (chat.js)
├── On JOIN: receive emotes map, store in local emoteMap
├── Message rendering: parse :code: → <img class="emote">
│   .content.replace(/:(\w+):/g, (m, code) =>
│     emoteMap[code] ? `<img src="..." />` : m)
└── Emote autocomplete picker on chat input
    - Detect ":" followed by word prefix
    - Dropdown with matching emotes (image + code name)
    - Click/Enter to insert :code:
    - Keyboard nav: Up/Down/Enter/Escape
```

## Data Model

Emote map stored via `storageManager.storeData("ezchat_emotes", ...)`:

```json
{
  "Kappa": "uuid1.png",
  "KEKW": "uuid2.png",
  "KKona": "uuid3.png"
}
```

- Keys: emote codes (alphanumeric + underscore, max 32 chars)
- Values: UUID-based filenames stored in plugin data directory

## Protocol Changes

Only the `JOIN` response is extended:

```json
{
  "type": "JOIN",
  "status": "OK",
  "emotes": { "Kappa": "uuid1.png", "KEKW": "uuid2.png" },
  "is_authenticated": true,
  ...
}
```

`MESSAGE` type is unchanged — content remains plain text. Emote replacement is client-side only.

## Admin Page

Route: `GET /admin/emotes` (via `getRouter()`)

### Flow
1. Admin selects multiple image files and uploads them
2. Uploaded images appear in a table with:
   - Preview thumbnail (32x32)
   - Editable code name input field
   - Delete button per row
3. Code name defaults to filename without extension
4. Admin edits names inline; empty names = skipped on save
5. Click "Save Emotes" → commits named entries to the emote map
6. Existing emotes also shown (pre-filled); clearing a name removes it

### Routes
| Method | Path | Description |
|--------|------|-------------|
| GET | `/admin/emotes` | Serve admin page HTML |
| POST | `/admin/emotes/upload` | Upload image files (multipart) |
| POST | `/admin/emotes/save` | Save emote map from table data |

### Security
- File type validation by magic bytes: PNG, GIF, WebP only
- Max file size: 1 MB per image
- Code validation: `/^[\w]+$/` (alphanumeric + underscore), max 32 chars
- UUID-based stored filenames to prevent path traversal
- Admin-only access via PeerTube user admin check
- Duplicate code check on save

## Client Changes

### Emote Autocomplete Picker
- `input` event listener on the message input
- Detect `:` prefix at cursor position, extract typed prefix
- Filter `emoteMap` keys matching prefix (case-insensitive)
- Show positioned dropdown `<div>` below input
- Each entry: 24x24 emote image + code name
- Click or Enter/Tab → insert `:code:` into input, close dropdown
- Escape or blur → close dropdown
- Max 20 results

### Message Rendering
In `client/chat.js` MESSAGE handler, change from:
```js
username.after(": " + data.content);
```
To:
```js
const rendered = data.content.replace(/:(\w+):/g, (match, code) => {
  const filename = emoteMap[code];
  return filename
    ? `<img src="${emoteImageBase}/${filename}" class="peertube-plugin-chat-emote" title="${code}" alt=":${code}:" />`
    : match;
});
username.after(": ");
username.insertAdjacentHTML("afterend", rendered);
```

### CSS

```css
.peertube-plugin-chat-emote {
  height: 1.5em;
  vertical-align: middle;
}
.peertube-plugin-chat-emote-picker {
  position: absolute;
  bottom: 100%;
  left: 0;
  background: #fff;
  border: 1px solid #ccc;
  border-radius: 4px;
  max-height: 200px;
  overflow-y: auto;
  z-index: 1000;
}
.peertube-plugin-chat-emote-picker-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px;
  cursor: pointer;
}
.peertube-plugin-chat-emote-picker-item:hover,
.peertube-plugin-chat-emote-picker-item.selected {
  background: #eee;
}
.peertube-plugin-chat-emote-picker-item img {
  height: 24px;
  width: 24px;
}
```

## Files Changed

| File | Changes |
|------|---------|
| `main.js` | Add admin routes, emote serving route, load emote map on register |
| `chat_server.js` | Load emote map, include in JOIN response |
| `client/chat.js` | Emote rendering + autocomplete picker |
| `client/html.js` | Possibly no changes (input is reused) |
| `assets/style.css` | Emote image + picker styles |
| `scripts/build.js` | No changes needed |

## Emote Image URL

Emotes are served at the dynamic plugin base route. The client constructs the URL as:

```js
const emoteImageBase = baseroute + '/emotes';
```

Where `baseroute` is already available in `launchChat()` from `peertubeHelpers.getBaseRouterRoute()`.
