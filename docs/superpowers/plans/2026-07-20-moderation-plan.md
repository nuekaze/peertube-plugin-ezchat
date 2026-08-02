# Moderation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add moderator functionality — delete messages, timeout users, ban users, and let stream owners assign moderators.

**Architecture:** Extend the existing WebSocket protocol with 6 new client→server message types and 6 new server→client types. Add message IDs, a rolling buffer, a token-by-actor reverse map, and ban persistence to the existing room data structure. Client UI adds hover buttons (delete) and a click-on-username popup (timeout/ban/mod).

**Tech Stack:** ws (WebSocket), vanilla JS client, esbuild bundle, storageManager for persistence

## Global Constraints

- Follow existing CommonJS (server) / ESM (client) module system
- Messages on the rolling buffer are capped at 200 entries
- Bans persist via storageManager.storeData("ezchat_bans", ...) on the same 10-min cycle
- No new dependencies
- Client UI matches existing vanilla JS patterns (no framework)
- Tokens are SHA-256 hashes, never exposed to other clients

---

### Task 1: Server — Room Data Structures & Message ID Assignment

**Files:**
- Modify: `chat_server.js` (lines 30-31 room initialization, MESSAGE handler)

**Interfaces:**
- Consumes: existing `rooms[room]` initialization, existing `MESSAGE` handler
- Produces: rooms with `nextMessageId`, `messages`, `tokenByActor`, `timeouts`, `banned` fields; messages with IDs

- [ ] **Step 1: Update room initialization**

Edit the `if (!rooms[room])` block at line 30 to include the new fields.

```js
if (!rooms[room]) {
  rooms[room] = {
    clients: new Set(),
    users: [],
    owner: "",
    mods: [],
    nextMessageId: 0,
    messages: [],
    tokenByActor: {},
    timeouts: {},
    banned: []
  };
}
```

- [ ] **Step 2: Update the MESSAGE handler**

After checking `users[m.token]` at line 35, add a bans/timeouts gate. Then assign an ID and push to buffer before broadcasting.

Replace the `MESSAGE` handler block:

```js
if (m.type === 'MESSAGE') {
  if (users[m.token]) {
    const actor = users[m.token].actor;
    
    // Check bans
    if (rooms[room].banned.includes(actor)) {
      ws.send(JSON.stringify({ type: 'ERROR', message: 'You are banned from this chat.' }));
      return;
    }
    
    // Check timeouts
    if (rooms[room].timeouts[actor] && rooms[room].timeouts[actor] > Date.now()) {
      ws.send(JSON.stringify({ type: 'ERROR', message: 'You are timed out from this chat.' }));
      return;
    }
    
    const messageId = rooms[room].nextMessageId++;
    const r = {
      type: 'MESSAGE',
      messageId: messageId,
      color: users[m.token].color,
      actor: actor,
      display_name: users[m.token].display_name,
      content: m.content,
      isOwner: false,
      isMod: false
    };

    if (rooms[room].owner == m.token) {
      r.isOwner = true;
    }
    if (rooms[room].mods.includes(m.token)) {
      r.isMod = true;
    }

    // Store in rolling buffer
    rooms[room].messages.unshift({
      id: messageId,
      token: m.token,
      actor: actor,
      display_name: users[m.token].display_name,
      color: users[m.token].color,
      content: m.content
    });
    if (rooms[room].messages.length > 200) {
      rooms[room].messages.pop();
    }

    // Update reverse lookup
    rooms[room].tokenByActor[actor] = m.token;

    rooms[room].clients.forEach((c) => c.send(JSON.stringify(r)));
  }
}
```

- [ ] **Step 3: Build and lint**

```bash
node ./scripts/build.js && npx jshint .
```

- [ ] **Step 4: Commit**

```bash
git add chat_server.js
git commit -m "feat(server): add message IDs, rolling buffer, ban/timeout gates"
```

---

### Task 2: Server — Moderation Handlers (DELETE_MESSAGE, TIMEOUT_USER, BAN_USER, UNBAN_USER, MOD_USER, UNMOD_USER)

**Files:**
- Modify: `chat_server.js` (add new else-if blocks after the AUTH_INIT handler)

**Interfaces:**
- Consumes: `rooms[room]` from Task 1
- Produces: WebSocket handlers for 6 new message types

- [ ] **Step 1: Add the moderation handlers**

Add these blocks before the closing `}` of the `ws.on('message')` callback, after the `AUTH_INIT` block (line 131):

```js
} else if (m.type === 'DELETE_MESSAGE') {
  if (!users[m.token]) {
    ws.send(JSON.stringify({ type: 'ERROR', message: 'Not authenticated.' }));
    return;
  }
  const isOwner = rooms[room].owner == m.token;
  const isMod = rooms[room].mods.includes(m.token);
  if (!isOwner && !isMod) {
    ws.send(JSON.stringify({ type: 'ERROR', message: 'Not a moderator.' }));
    return;
  }
  const idx = rooms[room].messages.findIndex(msg => msg.id === m.messageId);
  if (idx === -1) {
    ws.send(JSON.stringify({ type: 'ERROR', message: 'Message not found.' }));
    return;
  }
  rooms[room].messages.splice(idx, 1);
  rooms[room].clients.forEach((c) => c.send(JSON.stringify({
    type: 'MESSAGE_DELETED',
    messageId: m.messageId
  })));
} else if (m.type === 'TIMEOUT_USER') {
  if (!users[m.token]) {
    ws.send(JSON.stringify({ type: 'ERROR', message: 'Not authenticated.' }));
    return;
  }
  const isOwner = rooms[room].owner == m.token;
  const isMod = rooms[room].mods.includes(m.token);
  if (!isOwner && !isMod) {
    ws.send(JSON.stringify({ type: 'ERROR', message: 'Not a moderator.' }));
    return;
  }
  if (rooms[room].owner === rooms[room].tokenByActor[m.targetActor]) {
    ws.send(JSON.stringify({ type: 'ERROR', message: 'Cannot timeout the owner.' }));
    return;
  }
  const targetToken = rooms[room].tokenByActor[m.targetActor];
  if (!targetToken) {
    ws.send(JSON.stringify({ type: 'ERROR', message: 'User not found in this room.' }));
    return;
  }
  if (m.duration === 0) {
    delete rooms[room].timeouts[m.targetActor];
  } else {
    rooms[room].timeouts[m.targetActor] = Date.now() + m.duration * 1000;
  }
  // Force-close the target's connection if present
  for (const client of rooms[room].clients) {
    if (client.token === targetToken) {
      client.close();
      break;
    }
  }
  rooms[room].clients.forEach((c) => c.send(JSON.stringify({
    type: 'USER_TIMEOUTED',
    actor: m.targetActor,
    duration: m.duration
  })));
} else if (m.type === 'BAN_USER') {
  if (!users[m.token]) {
    ws.send(JSON.stringify({ type: 'ERROR', message: 'Not authenticated.' }));
    return;
  }
  const isOwner = rooms[room].owner == m.token;
  const isMod = rooms[room].mods.includes(m.token);
  if (!isOwner && !isMod) {
    ws.send(JSON.stringify({ type: 'ERROR', message: 'Not a moderator.' }));
    return;
  }
  if (rooms[room].owner === rooms[room].tokenByActor[m.targetActor]) {
    ws.send(JSON.stringify({ type: 'ERROR', message: 'Cannot ban the owner.' }));
    return;
  }
  const targetToken = rooms[room].tokenByActor[m.targetActor];
  if (!targetToken) {
    ws.send(JSON.stringify({ type: 'ERROR', message: 'User not found in this room.' }));
    return;
  }
  if (!rooms[room].banned.includes(m.targetActor)) {
    rooms[room].banned.push(m.targetActor);
  }
  // Force-close the target's connection
  for (const client of rooms[room].clients) {
    if (client.token === targetToken) {
      client.close();
      break;
    }
  }
  rooms[room].clients.forEach((c) => c.send(JSON.stringify({
    type: 'USER_BANNED',
    actor: m.targetActor
  })));
} else if (m.type === 'UNBAN_USER') {
  if (!users[m.token]) {
    ws.send(JSON.stringify({ type: 'ERROR', message: 'Not authenticated.' }));
    return;
  }
  const isOwner = rooms[room].owner == m.token;
  const isMod = rooms[room].mods.includes(m.token);
  if (!isOwner && !isMod) {
    ws.send(JSON.stringify({ type: 'ERROR', message: 'Not a moderator.' }));
    return;
  }
  rooms[room].banned = rooms[room].banned.filter(a => a !== m.targetActor);
  rooms[room].clients.forEach((c) => c.send(JSON.stringify({
    type: 'USER_UNBANNED',
    actor: m.targetActor
  })));
} else if (m.type === 'MOD_USER') {
  if (!users[m.token]) {
    ws.send(JSON.stringify({ type: 'ERROR', message: 'Not authenticated.' }));
    return;
  }
  if (rooms[room].owner !== m.token) {
    ws.send(JSON.stringify({ type: 'ERROR', message: 'Only the owner can assign mods.' }));
    return;
  }
  const targetToken = rooms[room].tokenByActor[m.targetActor];
  if (!targetToken) {
    ws.send(JSON.stringify({ type: 'ERROR', message: 'User not found in this room.' }));
    return;
  }
  if (!rooms[room].mods.includes(targetToken)) {
    rooms[room].mods.push(targetToken);
  }
  rooms[room].clients.forEach((c) => c.send(JSON.stringify({
    type: 'MOD_ASSIGNED',
    actor: m.targetActor
  })));
} else if (m.type === 'UNMOD_USER') {
  if (!users[m.token]) {
    ws.send(JSON.stringify({ type: 'ERROR', message: 'Not authenticated.' }));
    return;
  }
  if (rooms[room].owner !== m.token) {
    ws.send(JSON.stringify({ type: 'ERROR', message: 'Only the owner can unmod users.' }));
    return;
  }
  const targetToken = rooms[room].tokenByActor[m.targetActor];
  if (!targetToken) {
    ws.send(JSON.stringify({ type: 'ERROR', message: 'User not found in this room.' }));
    return;
  }
  rooms[room].mods = rooms[room].mods.filter(t => t !== targetToken);
  rooms[room].clients.forEach((c) => c.send(JSON.stringify({
    type: 'MOD_UNASSIGNED',
    actor: m.targetActor
  })));
}
```

- [ ] **Step 2: Track token on WebSocket instance for disconnection lookup**

Set `ws.token = m.token;` in both the `MESSAGE` handler (after `rooms[room].tokenByActor[actor] = m.token;`) and the `JOIN` handler (where token is available), so the force-close loop in moderation actions can find the target's WebSocket by token.

In the MESSAGE handler, add after `rooms[room].tokenByActor[actor] = m.token;`:

```js
ws.token = m.token;
```

In the JOIN handler (line 60-61), after `rooms[room].users.push(m.token);`, add:

```js
ws.token = m.token;
if (users[m.token]) {
  rooms[room].tokenByActor[users[m.token].actor] = m.token;
}
```

- [ ] **Step 3: Build and lint**

```bash
node ./scripts/build.js && npx jshint .
```

- [ ] **Step 4: Commit**

```bash
git add chat_server.js
git commit -m "feat(server): add DELETE_MESSAGE, TIMEOUT_USER, BAN_USER, UNBAN_USER, MOD_USER, UNMOD_USER handlers"
```

---

### Task 3: Server — Ban Persistence (saveChatState / initChat)

**Files:**
- Modify: `chat_server.js` (initChat, saveChatState)

**Interfaces:**
- Consumes: `storageManager.getData`, `storageManager.storeData`
- Produces: bans persisted across server restarts

- [ ] **Step 1: Update initChat to load bans**

Replace `initChat`:

```js
async function initChat(storageManager) {
  users = await storageManager.getData("ezchat_users");
  if (!users) users = {};

  const savedBans = await storageManager.getData("ezchat_bans");
  if (savedBans) {
    // Bans are applied per-room when rooms are first accessed
    // Store in a module-level variable
    bans = savedBans;
  } else {
    bans = {};
  }
}

// Module-level variable for persisted bans
let bans = {};
```

Add `bans` near the top with the other module-level variables (after line 7):

```js
let bans = {};
```

- [ ] **Step 2: Apply bans when rooms are initialized**

In the room initialization block (the `if (!rooms[room])`), apply persisted bans:

```js
if (!rooms[room]) {
  rooms[room] = {
    clients: new Set(),
    users: [],
    owner: "",
    mods: [],
    nextMessageId: 0,
    messages: [],
    tokenByActor: {},
    timeouts: {},
    banned: bans[room] || []
  };
}
```

- [ ] **Step 3: Update saveChatState to include bans**

```js
async function saveChatState(storageManager) {
  await storageManager.storeData("ezchat_users", users);

  // Build bans map from current room state
  const bansMap = {};
  for (const [roomId, roomData] of Object.entries(rooms)) {
    if (roomData.banned.length > 0) {
      bansMap[roomId] = { banned: roomData.banned };
    }
  }
  await storageManager.storeData("ezchat_bans", bansMap);
}
```

- [ ] **Step 4: Update the BAN_USER handler to also update bans map on-the-fly**

After `rooms[room].banned.push(m.targetActor);`, the bans will be saved at the next 10-min interval. That's acceptable per the spec.

- [ ] **Step 5: Export bans initialization**

Update the module.exports at the bottom to include bans if needed (not strictly required).

- [ ] **Step 6: Build and lint**

```bash
node ./scripts/build.js && npx jshint .
```

- [ ] **Step 7: Commit**

```bash
git add chat_server.js
git commit -m "feat(server): persist bans across server restarts"
```

---

### Task 4: Client — Message Rendering Updates (data attributes, system message style)

**Files:**
- Modify: `client/chat.js` (MESSAGE handler, system message display)
- Modify: `assets/style.css` (system message class)

**Interfaces:**
- Consumes: new `messageId` field in MESSAGE broadcast
- Produces: message DOM elements with `data-message-id` and `data-actor` attributes, styled system messages

- [ ] **Step 1: Update the MESSAGE display logic to include data attributes**

In `client/chat.js`, find the `MESSAGE` handler block (lines 125-138). Update it:

```js
else if (data.type == "MESSAGE")
{
    message.setAttribute("data-message-id", data.messageId);
    username.href = data.actor;
    username.style = "text-decoration: none; color: " + data.color + ";";
    username.textContent = data.display_name;
    username.setAttribute("data-actor", data.actor);

    if (data.isOwner)
        badge.textContent = "🎥 ";
    else if (data.isMod)
        badge.textContent = "🔨 ";

    message.appendChild(username);
    username.after(": " + data.content);
    username.before(badge);
}
```

- [ ] **Step 2: Add CSS for system messages**

Add to `assets/style.css`:

```css
.peertube-plugin-chat-system {
    font-style: italic;
    opacity: 0.7;
    font-size: 0.9em;
}
```

- [ ] **Step 3: Build**

```bash
node ./scripts/build.js
```

- [ ] **Step 4: Commit**

```bash
git add client/chat.js assets/style.css
git commit -m "feat(client): add messageId and actor data attributes, system message CSS"
```

---

### Task 5: Client — New Message Type Handlers (MESSAGE_DELETED, USER_TIMEOUTED, etc.)

**Files:**
- Modify: `client/chat.js` (add new else-if blocks in the ws.onmessage handler)

**Interfaces:**
- Consumes: server broadcasts from Task 2
- Produces: DOM updates for all moderation events

- [ ] **Step 1: Add MESSAGE_DELETED handler**

Add this block after the `MESSAGE` handler (after line 139):

```js
else if (data.type == "MESSAGE_DELETED")
{
    const msgEl = el.messages.querySelector('[data-message-id="' + data.messageId + '"]');
    if (msgEl) msgEl.remove();
}
```

- [ ] **Step 2: Add USER_TIMEOUTED handler**

```js
else if (data.type == "USER_TIMEOUTED")
{
    message.className = "peertube-plugin-chat-system";
    message.textContent = data.actor + " has been timed out for " + data.duration + " seconds.";
}
```

- [ ] **Step 3: Add USER_BANNED handler**

```js
else if (data.type == "USER_BANNED")
{
    message.className = "peertube-plugin-chat-system";
    message.textContent = data.actor + " has been banned.";
}
```

- [ ] **Step 4: Add USER_UNBANNED handler**

```js
else if (data.type == "USER_UNBANNED")
{
    message.className = "peertube-plugin-chat-system";
    message.textContent = data.actor + " has been unbanned.";
}
```

- [ ] **Step 5: Add MOD_ASSIGNED handler**

```js
else if (data.type == "MOD_ASSIGNED")
{
    message.className = "peertube-plugin-chat-system";
    message.textContent = data.actor + " is now a moderator.";
    if (data.actor === localActor) isLocalMod = true;
}
```

- [ ] **Step 6: Add MOD_UNASSIGNED handler**

```js
else if (data.type == "MOD_UNASSIGNED")
{
    message.className = "peertube-plugin-chat-system";
    message.textContent = data.actor + " is no longer a moderator.";
    if (data.actor === localActor) isLocalMod = false;
}
```

- [ ] **Step 7: Add ERROR handler**

```js
else if (data.type == "ERROR")
{
    message.className = "peertube-plugin-chat-system";
    message.textContent = "System: " + data.message;
}
```

- [ ] **Step 8: Build**

```bash
node ./scripts/build.js
```

- [ ] **Step 9: Commit**

```bash
git add client/chat.js
git commit -m "feat(client): handle moderation event types (MESSAGE_DELETED, TIME/UNBAN, MOD ASSIGN)"
```

---

### Task 6: Client — Mod UI (Delete Button, User Popup Menu)

**Files:**
- Modify: `client/chat.js` (MESSAGE handler to add mod buttons, event listeners)
- Modify: `client/html.js` (add placeholder elements if needed — popup menu)
- Modify: `assets/style.css` (mod button and popup styles)

**Interfaces:**
- Consumes: `isMod`/`isOwner` flags on messages, `data-message-id` and `data-actor` attributes from Task 4
- Produces: delete button (hover on message), popup menu (click on username)

- [ ] **Step 1: Update MESSAGE handler to add delete button for mods/owner**

Inside the `MESSAGE` handler, after appending the badge and content, add a delete button if the local user is mod or owner:

```js
else if (data.type == "MESSAGE")
{
    message.setAttribute("data-message-id", data.messageId);
    username.href = data.actor;
    username.style = "text-decoration: none; color: " + data.color + ";";
    username.textContent = data.display_name;
    username.setAttribute("data-actor", data.actor);

    if (data.isOwner)
        badge.textContent = "🎥 ";
    else if (data.isMod)
        badge.textContent = "🔨 ";

    message.appendChild(username);
    username.after(": " + data.content);
    username.before(badge);

    // Check if local user is mod or owner
    const localToken = window.localStorage.getItem("peertubePluginChatToken");
    // We need isLocalMod/isLocalOwner — stored when JOIN response arrives
    if (isLocalMod || isLocalOwner)
    {
        const delBtn = document.createElement("button");
        delBtn.textContent = "✕";
        delBtn.className = "peertube-plugin-chat-delete-btn";
        delBtn.title = "Delete message";
        delBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            ws.send(JSON.stringify({
                type: "DELETE_MESSAGE",
                room: video.uuid,
                token: localToken,
                messageId: data.messageId
            }));
        });
        message.appendChild(delBtn);
    }
}
```

- [ ] **Step 2: Track local mod/owner status from JOIN response**

Extend the server JOIN handler to include `isMod` and `isOwner` status. In `chat_server.js`, after the `r.is_authenticated = 1;` line, add:

```js
if (users[m.token]) {
  r.is_authenticated = 1;
  r.display_name = users[m.token].display_name;
  r.color = users[m.token].color;
  r.actor = users[m.token].actor;
  r.isOwner = rooms[room].owner === m.token;
  r.isMod = rooms[room].mods.includes(m.token);
}
```

On the client, in `client/chat.js`, add module-level variables at the top of `launchChat`, after the `el` object:

```js
let isLocalMod = false;
let isLocalOwner = false;
let localActor = "";
```

In the client JOIN handler, populate them:

```js
if (data.actor) localActor = data.actor;
if (data.isMod) isLocalMod = true;
if (data.isOwner) isLocalOwner = true;
```

- [ ] **Step 3: Add click-on-username popup for mods/owner**

Add this to the MESSAGE handler, after the delete button logic:

```js
// Only show the user popup for mods/owner, and not on own messages
if ((isLocalMod || isLocalOwner) && data.actor !== localActor) {
    username.style.cursor = "pointer";
    username.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        showUserPopup(e, data.actor, ws, video.uuid, localToken, isLocalOwner);
    });
}
```

- [ ] **Step 4: Implement the popup menu function**

Add this function in `client/chat.js`:

```js
function showUserPopup(event, actor, ws, room, token, isOwner) {
    // Remove any existing popup
    const existing = document.getElementById("peertube-plugin-chat-user-popup");
    if (existing) existing.remove();

    const popup = document.createElement("div");
    popup.id = "peertube-plugin-chat-user-popup";
    popup.style.position = "absolute";
    popup.style.left = event.clientX + "px";
    popup.style.top = event.clientY + "px";
    popup.style.background = "var(--mainBackgroundColor, #222)";
    popup.style.border = "1px solid #555";
    popup.style.borderRadius = "4px";
    popup.style.padding = "4px";
    popup.style.zIndex = "1000";

    const items = [
        { label: "Timeout 10m", action: () => sendModAction(ws, "TIMEOUT_USER", room, token, actor, 600) },
        { label: "Timeout 1h", action: () => sendModAction(ws, "TIMEOUT_USER", room, token, actor, 3600) },
        { label: "Timeout 24h", action: () => sendModAction(ws, "TIMEOUT_USER", room, token, actor, 86400) },
        { label: "Ban", action: () => sendModAction(ws, "BAN_USER", room, token, actor) },
    ];

    if (isOwner) {
        items.push({ label: "Mod", action: () => sendModAction(ws, "MOD_USER", room, token, actor) });
        items.push({ label: "Unmod", action: () => sendModAction(ws, "UNMOD_USER", room, token, actor) });
    }

    items.push({ label: "Cancel", action: () => {} });

    items.forEach(item => {
        const btn = document.createElement("button");
        btn.textContent = item.label;
        btn.style.display = "block";
        btn.style.width = "100%";
        btn.style.background = "none";
        btn.style.border = "none";
        btn.style.color = "var(--mainForegroundColor, #fff)";
        btn.style.padding = "4px 8px";
        btn.style.textAlign = "left";
        btn.style.cursor = "pointer";
        btn.addEventListener("mouseenter", () => { btn.style.background = "#444"; });
        btn.addEventListener("mouseleave", () => { btn.style.background = "none"; });
        btn.addEventListener("click", (e) => {
            e.stopPropagation();
            item.action();
            popup.remove();
        });
        popup.appendChild(btn);
    });

    document.body.appendChild(popup);

    // Close popup on click outside
    setTimeout(() => {
        document.addEventListener("click", closePopup);
    }, 0);

    function closePopup(e) {
        if (!popup.contains(e.target)) {
            popup.remove();
            document.removeEventListener("click", closePopup);
        }
    }
}

function sendModAction(ws, type, room, token, targetActor, duration) {
    const payload = {
        type: type,
        room: room,
        token: token,
        targetActor: targetActor
    };
    if (duration !== undefined) payload.duration = duration;
    ws.send(JSON.stringify(payload));
}
```

- [ ] **Step 5: Add delete button CSS**

Add to `assets/style.css`:

```css
.peertube-plugin-chat-delete-btn {
    float: right;
    background: none;
    border: none;
    color: #f00;
    cursor: pointer;
    display: none;
    font-size: 0.8em;
    padding: 0 4px;
}
#peertube-plugin-chat-messages > div:hover .peertube-plugin-chat-delete-btn {
    display: inline;
}
```

- [ ] **Step 6: Build**

```bash
node ./scripts/build.js
```

- [ ] **Step 7: Commit**

```bash
git add client/chat.js client/html.js assets/style.css
git commit -m "feat(client): add mod delete button and user popup menu"
```

---

### Task 7: Final Integration Verification

**Files:**
- Verify: all modified files

- [ ] **Step 1: Build the bundle**

```bash
node ./scripts/build.js
```

- [ ] **Step 2: Run linter**

```bash
npx jshint .
```

- [ ] **Step 3: Review git status**

```bash
git status
git diff --stat
```

- [ ] **Step 4: Do a final read-through of all modified files to catch any issues**

- [ ] **Step 5: Final commit if needed**

```bash
git add -A
git commit -m "chore: finalize moderation feature"
```
