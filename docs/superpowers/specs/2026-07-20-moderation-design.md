# EZChat Moderation Design

**Date**: 2026-07-20
**Status**: Approved

## Data Structures

### Room (extended)

```js
rooms[room] = {
  clients: Set<WebSocket>,
  users: [],                    // tokens of users who have joined
  owner: "",                    // token of room owner (video channel owner)
  mods: [],                     // tokens of moderators
  nextMessageId: 0,             // auto-incrementing counter
  messages: [],                 // rolling buffer, max 200, each: { id, token, actor, display_name, color, content }
  tokenByActor: {},             // actor URL → token reverse lookup
  timeouts: {},                 // actor → expiration timestamp (ms)
  banned: []                    // actor URLs permanently banned
}
```

### Persisted state

Bans are added to the existing `saveChatState` cycle (every 10 min). A new key `ezchat_bans` maps room UUID → `{ banned: [actor URLs] }`. On server restart, bans are reloaded and applied to rooms as they are created. Timeouts and message history are in-memory only.

## WebSocket Protocol

### Client → Server

| Type | Fields | Permission | Description |
|------|--------|------------|-------------|
| `MESSAGE` | `room, token, content` | authenticated, not banned/timeouted | Existing — now also checks bans/timeouts |
| `DELETE_MESSAGE` | `room, token, messageId` | mod/owner | Delete a message by ID |
| `TIMEOUT_USER` | `room, token, targetActor, duration` | mod/owner | Timeout (seconds), 0 to cancel |
| `BAN_USER` | `room, token, targetActor` | mod/owner | Permanent ban |
| `UNBAN_USER` | `room, token, targetActor` | mod/owner | Lift a ban |
| `MOD_USER` | `room, token, targetActor` | owner only | Promote to moderator |
| `UNMOD_USER` | `room, token, targetActor` | owner only | Demote from moderator |

### Server → Client

| Type | Fields | Description |
|------|--------|-------------|
| `MESSAGE` | `messageId, color, actor, display_name, content, isOwner, isMod` | Existing — now includes `messageId` |
| `MESSAGE_DELETED` | `messageId` | Clients remove that message DOM element |
| `USER_TIMEOUTED` | `actor, duration` | System notification |
| `USER_BANNED` | `actor` | System notification |
| `USER_UNBANNED` | `actor` | System notification |
| `MOD_ASSIGNED` | `actor` | System notification |
| `MOD_UNASSIGNED` | `actor` | System notification |
| `ERROR` | `message` | Generic error display |

## Server Logic

### Message sending

- Check if sender's actor is in `banned[]` → reject with `ERROR`
- Check if sender's actor is in `timeouts{}` with future expiry → reject with `ERROR`
- Assign `nextMessageId++`, prepend to `messages[]`, cap at 200
- Broadcast to all clients with updated `MESSAGE` type including `messageId`
- Update `tokenByActor[senderActor] = senderToken`

### Message deletion

- Verify `rooms[room].mods.includes(token) || rooms[room].owner == token`
- Find message by `messageId` in `messages[]` buffer
- If not found, no-op
- If found, remove it from buffer, broadcast `MESSAGE_DELETED` to all clients
- Deleted messages are gone for everyone

### Timeout

- Verify mod/owner permission
- Lookup `targetActor` in `tokenByActor` (must have joined/messaged). If not found, send `ERROR: "User not found in this room."`
- Set `timeouts[targetActor] = Date.now() + duration * 1000`
- If the target user has an active WebSocket in this room, force-close their connection (they can rejoin but will be blocked from messaging)
- Broadcast `USER_TIMEOUTED` with actor and duration
- If `duration === 0`, clear timeout instead
- Owner cannot timeout self; mod cannot timeout owner

### Ban/unban

- Verify mod/owner permission
- Lookup `targetActor` in `tokenByActor` (must have joined/messaged). If not found, send `ERROR`
- Add `targetActor` to `banned[]` (deduplicated)
- If the target user has an active WebSocket in this room, force-close their connection
- Broadcast `USER_BANNED` with actor
- On unban: remove from `banned[]`, broadcast `USER_UNBANNED`
- Owner cannot ban self; mod cannot ban owner

### Mod assignment

- Verify `rooms[room].owner == token`
- Lookup `targetActor` in `tokenByActor`, find their token
- Add to `mods[]` if not already present
- Broadcast `MOD_ASSIGNED` with actor
- Unmod: remove from `mods[]`, broadcast `MOD_UNASSIGNED`

## Client UI

### Message rendering (updated)

Each message `<div>` gets a `data-message-id` attribute. The username `<a>` tag gets a `data-actor` attribute.

### Mod buttons (visible only if `isMod || isOwner`)

- **Delete button**: small "X" button on the message element, shown on hover (`mouseenter`/`mouseleave`)
- **User menu**: clicking a username that has `data-actor` shows a small popup menu with:
  - "Timeout 10m", "Timeout 1h", "Timeout 24h"
  - "Ban"
  - (owner only) "Mod" / "Unmod"
  - "Cancel"
- The popup closes on click-away or selection

### New message type handlers

- `MESSAGE_DELETED`: `querySelector('[data-message-id="<id>"]')` → remove from DOM
- `USER_TIMEOUTED` / `USER_BANNED` / `USER_UNBANNED` / `MOD_ASSIGNED` / `MOD_UNASSIGNED` → append system message
- `ERROR` → append system error message

### system message style

System messages use a distinct CSS class (e.g., italic, gray text) to differentiate from user messages.

## Persistence

- **`chat_server.js`**: `saveChatState` also saves a `bans` map keyed by room UUID
- **`initChat`**: loads `bans` map from storage, applies to rooms on creation
- Room data structure initialized from saved bans when room is first created

## Files Modified

- `chat_server.js` — core moderation logic, data structures, persistence
- `client/chat.js` — mod UI, new message type handlers
- `client/html.js` — template changes for mod menu/buttons
- `assets/style.css` — styles for mod buttons, popup menu, system messages
