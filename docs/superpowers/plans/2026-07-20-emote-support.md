# Emote Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Discord-style emote support (`:code:` syntax) with admin-managed custom emotes and an autocomplete picker.

**Architecture:** Server stores emote images and mappings in plugin data directory. Emote map sent to clients in WebSocket JOIN response. Client replaces `:code:` patterns with `<img>` tags and shows an autocomplete dropdown when typing `:` in the input.

**Tech Stack:** Node.js, Express (PeerTube router), multer (file upload), WebSocket (ws package), vanilla JS client

## Global Constraints

- No native/built-in emotes — only admin-uploaded custom emotes
- Emote codes: alphanumeric + underscore only (`/^[\w]+$/`), max 32 chars
- Image files: PNG, GIF, WebP only, max 1 MB per file, UUID-based filenames
- Admin access: must check `peertubeHelpers.user.getAuthUser(res)` and verify role
- Esbuild bundles client ESM — no ES module changes needed in build
- CSS already loaded via PeerTube plugin manifest

---

### Task 1: Add dependencies and server infrastructure

**Files:**
- Modify: `package.json`
- Modify: `main.js`

**Interfaces:**
- Consumes: `peertubeHelpers.plugin.getDataDirectoryPath()` (PeerTube API)
- Produces: `emotesDir` path variable, multer upload config, emote serving route

- [ ] **Step 1: Add `multer` dependency**

```bash
npm install multer
```

- [ ] **Step 2: Add requires and emotes directory setup in `main.js`**

Add after line 2 (`const axios = require("axios");`):
```js
const path = require('path');
const fs = require('fs');
const multer = require('multer');
```

Add after `const baseroute = await peertubeHelpers.plugin.getBaseRouterRoute();` (line 23):
```js
const emotesDir = path.join(await peertubeHelpers.plugin.getDataDirectoryPath(), 'emotes');
if (!fs.existsSync(emotesDir)) {
  fs.mkdirSync(emotesDir, { recursive: true });
}

let emoteMap = {};
const storedEmotes = await storageManager.getData("ezchat_emotes");
if (storedEmotes) {
  emoteMap = storedEmotes;
}

const emoteUpload = multer({
  storage: multer.diskStorage({
    destination: emotesDir,
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      const name = crypto.randomUUID() + ext;
      cb(null, name);
    }
  }),
  fileFilter: (req, file, cb) => {
    const allowed = ['.png', '.gif', '.webp'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (!allowed.includes(ext)) {
      cb(new Error('Only PNG, GIF, and WebP files are allowed.'));
      return;
    }
    cb(null, true);
  },
  limits: { fileSize: 1 * 1024 * 1024 }
});
```

Add after the multer config (before the setprivs route):
```js
// Serve emote images
router.get('/emotes/:filename', (req, res) => {
  const filePath = path.join(emotesDir, path.basename(req.params.filename));
  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: 'Emote not found' });
    return;
  }
  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes = { '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp' };
  res.type(mimeTypes[ext] || 'application/octet-stream');
  fs.createReadStream(filePath).pipe(res);
});
```

- [ ] **Step 3: Verify the build works**

```bash
npm run build
```

Expected: esbuild bundles successfully, no errors.

---

### Task 2: Admin page routes

**Files:**
- Modify: `main.js`

**Interfaces:**
- Consumes: `emoteMap`, `emotesDir`, `emoteUpload`, `peertubeHelpers.user.getAuthUser(res)`, `storageManager.storeData`
- Produces: `GET /admin/emotes` (HTML page), `POST /admin/emotes/upload`, `POST /admin/emotes/save`

- [ ] **Step 1: Add admin auth helper function**

Add after the multer config (before `// Serve emote images`):
```js
async function isAdminUser(req, res) {
  try {
    const user = await peertubeHelpers.user.getAuthUser(res);
    return user && user.role >= 2;
  } catch {
    return false;
  }
}
```

- [ ] **Step 2: Add `GET /admin/emotes` route**

Add after the emote serving route:
```js
// Admin: list and manage emotes
router.get('/admin/emotes', async (req, res) => {
  if (!(await isAdminUser(req, res))) {
    res.status(403).send('<h1>Forbidden</h1><p>Admin access required.</p>');
    return;
  }

  let rows = '';
  for (const [code, filename] of Object.entries(emoteMap)) {
    const previewUrl = `${baseroute}/emotes/${filename}`;
    rows += `<tr>
      <td><img src="${previewUrl}" style="height:32px;width:32px;object-fit:contain" /></td>
      <td><input type="text" class="emote-code" value="${code}" data-filename="${filename}" /></td>
      <td><button class="delete-emote" data-filename="${filename}">✕</button></td>
    </tr>`;
  }

  res.send(`<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>EZChat Emote Manager</title>
<style>
  body { font-family: sans-serif; max-width: 800px; margin: 2em auto; padding: 0 1em; }
  table { width: 100%; border-collapse: collapse; margin: 1em 0; }
  th, td { border: 1px solid #ccc; padding: 8px; text-align: left; }
  th { background: #f5f5f5; }
  .emote-code { width: 200px; }
  .success { color: green; }
  .error { color: red; }
  #drop-zone { border: 2px dashed #ccc; padding: 2em; text-align: center; margin: 1em 0; cursor: pointer; }
  #drop-zone.dragover { border-color: #66f; background: #eef; }
</style></head>
<body>
  <h1>EZChat Emote Manager</h1>

  <div id="messages"></div>

  <h2>Upload Emotes</h2>
  <div id="drop-zone">Drop images here or click to select</div>
  <input type="file" id="file-input" multiple accept=".png,.gif,.webp" style="display:none" />

  <h2>Emotes</h2>
  <form id="emote-form">
  <table>
    <thead><tr><th>Preview</th><th>Code Name</th><th>Action</th></tr></thead>
    <tbody id="emote-table">${rows || '<tr><td colspan="3">No emotes yet. Upload some above.</td></tr>'}</tbody>
  </table>
  <button type="submit">Save Emotes</button>
  </form>

  <script>
  const dropZone = document.getElementById('drop-zone');
  const fileInput = document.getElementById('file-input');
  const messages = document.getElementById('messages');
  const tbody = document.getElementById('emote-table');

  dropZone.addEventListener('click', () => fileInput.click());
  dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('dragover'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    if (e.dataTransfer.files.length) uploadFiles(e.dataTransfer.files);
  });
  fileInput.addEventListener('change', () => { if (fileInput.files.length) uploadFiles(fileInput.files); });

  function uploadFiles(files) {
    const formData = new FormData();
    for (const f of files) formData.append('emotes', f);
    fetch('upload', { method: 'POST', body: formData })
      .then(r => r.json())
      .then(data => {
        if (data.error) { showMessage(data.error, 'error'); return; }
        for (const f of data.files) {
          const tr = document.createElement('tr');
          tr.innerHTML = '<td><img src="${baseroute}/emotes/' + f.filename + '" style="height:32px;width:32px;object-fit:contain" /></td>'
            + '<td><input type="text" class="emote-code" value="' + f.name + '" data-filename="' + f.filename + '" /></td>'
            + '<td><button class="delete-emote" data-filename="' + f.filename + '">✕</button></td>';
          const placeholder = tbody.querySelector('td[colspan]');
          if (placeholder) tbody.innerHTML = '';
          tbody.appendChild(tr);
        }
        showMessage('Uploaded ' + data.files.length + ' file(s). Assign names and click Save.', 'success');
      })
      .catch(e => showMessage('Upload failed: ' + e.message, 'error'));
  }

  tbody.addEventListener('click', (e) => {
    if (e.target.classList.contains('delete-emote')) {
      const filename = e.target.dataset.filename;
      fetch('delete', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({filename}) })
        .then(r => r.json())
        .then(data => {
          if (data.error) { showMessage(data.error, 'error'); return; }
          e.target.closest('tr').remove();
          if (!tbody.querySelector('tr')) tbody.innerHTML = '<tr><td colspan="3">No emotes yet.</td></tr>';
          showMessage('Emote deleted.', 'success');
        })
        .catch(e => showMessage('Delete failed: ' + e.message, 'error'));
    }
  });

  document.getElementById('emote-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const emotes = [];
    tbody.querySelectorAll('.emote-code').forEach(input => {
      const code = input.value.trim();
      if (code) emotes.push({ code, filename: input.dataset.filename });
    });
    fetch('save', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({emotes}) })
      .then(r => r.json())
      .then(data => {
        if (data.error) { showMessage(data.error, 'error'); return; }
        showMessage('Emotes saved!', 'success');
      })
      .catch(e => showMessage('Save failed: ' + e.message, 'error'));
  });

  function showMessage(msg, type) {
    messages.innerHTML = '<p class="' + type + '">' + msg + '</p>';
    setTimeout(() => messages.innerHTML = '', 3000);
  }
  </script>
</body></html>`);
});
```

- [ ] **Step 3: Add `POST /admin/emotes/upload` route**

Add after the GET route:
```js
router.post('/admin/emotes/upload', async (req, res) => {
  if (!(await isAdminUser(req, res))) {
    res.status(403).json({ error: 'Admin access required.' });
    return;
  }
  emoteUpload.array('emotes')(req, res, (err) => {
    if (err) {
      res.status(400).json({ error: err.message });
      return;
    }
    if (!req.files || req.files.length === 0) {
      res.status(400).json({ error: 'No files uploaded.' });
      return;
    }
    const files = req.files.map(f => ({
      filename: f.filename,
      name: path.parse(f.originalname).name.replace(/[^a-zA-Z0-9_]/g, '')
    }));
    res.json({ files });
  });
});
```

- [ ] **Step 4: Add `POST /admin/emotes/save` route**

Add after the upload route:
```js
router.post('/admin/emotes/save', async (req, res) => {
  if (!(await isAdminUser(req, res))) {
    res.status(403).json({ error: 'Admin access required.' });
    return;
  }
  const { emotes } = req.body;
  if (!Array.isArray(emotes)) {
    res.status(400).json({ error: 'Invalid payload.' });
    return;
  }
  const newMap = {};
  for (const e of emotes) {
    const code = e.code.trim();
    if (!/^[\w]+$/.test(code)) {
      res.status(400).json({ error: `Invalid code: "${code}". Use alphanumeric and underscore only.` });
      return;
    }
    if (code.length > 32) {
      res.status(400).json({ error: `Code "${code}" is too long (max 32 chars).` });
      return;
    }
    if (newMap[code]) {
      res.status(400).json({ error: `Duplicate code: "${code}".` });
      return;
    }
    const filePath = path.join(emotesDir, e.filename);
    if (!fs.existsSync(filePath)) {
      res.status(400).json({ error: `File not found: ${e.filename}. Re-upload the image.` });
      return;
    }
    newMap[code] = e.filename;
  }
  emoteMap = newMap;
  await storageManager.storeData("ezchat_emotes", emoteMap);
  res.json({ status: 'ok' });
});
```

- [ ] **Step 5: Add `POST /admin/emotes/delete` route**

Add after the save route:
```js
router.post('/admin/emotes/delete', async (req, res) => {
  if (!(await isAdminUser(req, res))) {
    res.status(403).json({ error: 'Admin access required.' });
    return;
  }
  const { filename } = req.body;
  if (!filename) {
    res.status(400).json({ error: 'Missing filename.' });
    return;
  }
  const filePath = path.join(emotesDir, path.basename(filename));
  try {
    fs.unlinkSync(filePath);
  } catch {}
  for (const [code, fn] of Object.entries(emoteMap)) {
    if (fn === filename) {
      delete emoteMap[code];
    }
  }
  await storageManager.storeData("ezchat_emotes", emoteMap);
  res.json({ status: 'ok' });
});
```

- [ ] **Step 6: Run linter**

```bash
npx jshint main.js
```

Expected: No errors.

---

### Task 3: Chat server — include emotes in JOIN response

**Files:**
- Modify: `chat_server.js`
- Modify: `main.js`

**Interfaces:**
- Consumes: `emoteMap` variable from main.js
- Produces: `emotes` field in JOIN response

- [ ] **Step 1: Update `chat_server.js` to accept and expose emote map**

Change `onConnection` signature (line 40) to accept `emoteMap`:
```js
function onConnection(ws, serverActor, serverUrl, logger, getEmoteMap) {
```

Add emotes to the JOIN response. After line 139 (`r.is_authenticated = 0;`), add:
```js
      r.emotes = getEmoteMap();
```

So the JOIN handler becomes:
```js
    } else if (m.type === 'JOIN') {
      rooms[room].clients.add(ws);

      if (!rooms[room].users.includes(m.token)) {
        rooms[room].users.push(m.token);
      }

      ws.token = m.token;
      if (users[m.token]) {
        rooms[room].tokenByActor[users[m.token].actor] = m.token;
      }

      const r = { type: 'JOIN', status: 0 };

      if (users[m.token]) {
        r.is_authenticated = 1;
        r.display_name = users[m.token].display_name;
        r.color = users[m.token].color;
        r.actor = users[m.token].actor;
        r.isOwner = rooms[room].owner === m.token;
        r.isMod = rooms[room].mods.includes(m.token);
      } else {
        r.is_authenticated = 0;
      }

      r.emotes = getEmoteMap();

      ws.send(JSON.stringify(r));
```

- [ ] **Step 2: Update `onConnection` call in `createWebSocketServer`**

Change `createWebSocketServer` (around line 376) to accept and pass `getEmoteMap`:
```js
function createWebSocketServer(registerWebSocketRoute, serverActor, serverUrl, logger, getEmoteMap) {
  const wss = new WebSocket.Server({ noServer: true });
  wss.on('connection', (ws) => {
    onConnection(ws, serverActor, serverUrl, logger, getEmoteMap);
  });
  ...
```

- [ ] **Step 3: Update `module.exports`**

Add `exports.getEmoteMap` if needed, but we'll use a closure approach.

Actually, simpler approach: pass a getter function. Update `createWebSocketServer` call in `main.js` (line 77):

Change:
```js
chat.createWebSocketServer(registerWebSocketRoute, serverActor, serverUrl, peertubeHelpers.logger);
```
To:
```js
chat.createWebSocketServer(registerWebSocketRoute, serverActor, serverUrl, peertubeHelpers.logger, () => emoteMap);
```

- [ ] **Step 4: Run linter**

```bash
npx jshint chat_server.js main.js
```

Expected: No errors.

---

### Task 4: Client emote rendering

**Files:**
- Modify: `client/chat.js`
- Modify: `assets/style.css`

**Interfaces:**
- Consumes: `data.emotes` from JOIN response, `data.content` from MESSAGE events, `baseroute` parameter
- Produces: Rendered `<img>` tags for emotes in chat messages

- [ ] **Step 1: Add emoteMap variable and image base URL**

In `launchChat` function in `client/chat.js`, after line 44 (`let localActor = "";`), add:
```js
let emoteMap = {};
const emoteImageBase = baseroute + '/emotes';
```

- [ ] **Step 2: Store emote map on JOIN**

In the JOIN handler (around line 102-124), after `if (data.status == 0)`, add:
```js
if (data.emotes) emoteMap = data.emotes;
```

So the section becomes:
```js
else if (data.type == "JOIN")
{
    if (data.status == 0)
    {
        if (data.emotes) emoteMap = data.emotes;
        if (data.is_authenticated == 1)
        {
```

- [ ] **Step 3: Replace raw text content with emote-rendered HTML**

Change lines 145-147 in `client/chat.js`:

From:
```js
            message.appendChild(username);
            username.after(": " + data.content);
            username.before(badge);
```

To:
```js
            message.appendChild(username);
            username.after(": ");
            const rendered = data.content.replace(/:([\w]+):/g, (match, code) => {
                const filename = emoteMap[code];
                return filename
                    ? `<img src="${emoteImageBase}/${filename}" class="peertube-plugin-chat-emote" title="${code}" alt=":${code}:" />`
                    : match;
            });
            username.insertAdjacentHTML("afterend", rendered);
            username.before(badge);
```

- [ ] **Step 4: Add CSS for emote images**

Append to `assets/style.css`:
```css
.peertube-plugin-chat-emote {
    height: 1.5em;
    vertical-align: middle;
}
```

- [ ] **Step 5: Build and verify**

```bash
npm run build
```

Expected: esbuild bundles successfully.

---

### Task 5: Emote autocomplete picker

**Files:**
- Modify: `client/chat.js`
- Modify: `assets/style.css`

**Interfaces:**
- Consumes: `emoteMap`, `el.messageInput`
- Produces: Emote picker dropdown UI

- [ ] **Step 1: Add emote picker state variables and DOM element**

In `launchChat`, after `let emoteMap = {};` (added in Task 4), add:
```js
let emotePickerVisible = false;
let emotePickerSelectedIndex = -1;
let emotePickerResults = [];
```

After the message rendering section (after `username.before(badge);`), add the emote picker creation:
```js
    // Create emote picker element
    const emotePicker = document.createElement("div");
    emotePicker.className = "peertube-plugin-chat-emote-picker";
    emotePicker.style.display = "none";
    el.messageInput.parentElement.style.position = "relative";
    el.messageInput.parentElement.appendChild(emotePicker);
```

Actually, the message input is inside `#peertube-plugin-chat-message-area`. Let me place the picker correctly. I'll add it after the existing DOM setup (after line 37).

Actually, the cleanest approach is to create the picker element and insert it into the DOM alongside the message area. Let me add it after the existing DOM references, around line 37.

Wait, the emote picker needs to be positioned relative to the message input. The input is `el.messageInput`. I need to wrap it or position relative to its parent. Let me add the picker creation after the `if (!settings.twitchClientId)` line.

Let me add:
```js
// Emote picker
const emotePicker = document.createElement("div");
emotePicker.className = "peertube-plugin-chat-emote-picker";
emotePicker.style.display = "none";
el.messageInput.parentNode.style.position = "relative";
el.messageInput.parentNode.appendChild(emotePicker);
```

- [ ] **Step 2: Add input event listener for emote detection**

After the `el.messageInput.addEventListener("keypress", ...)` (line 355-358), add:
```js
    el.messageInput.addEventListener("input", () => {
        const text = el.messageInput.value;
        const cursorPos = el.messageInput.selectionStart;
        const beforeCursor = text.slice(0, cursorPos);

        // Find the last ":" before cursor
        const colonIndex = beforeCursor.lastIndexOf(":");
        if (colonIndex === -1 || colonIndex === cursorPos - 1) {
            hideEmotePicker();
            return;
        }

        const prefix = beforeCursor.slice(colonIndex + 1);
        if (!prefix || prefix.length > 20 || /[^a-zA-Z0-9_]/.test(prefix)) {
            hideEmotePicker();
            return;
        }

        // Filter emotes matching the prefix
        const matches = Object.keys(emoteMap)
            .filter(code => code.toLowerCase().startsWith(prefix.toLowerCase()))
            .slice(0, 20);

        if (matches.length === 0) {
            hideEmotePicker();
            return;
        }

        emotePickerResults = matches;
        emotePickerSelectedIndex = -1;
        renderEmotePicker(matches, prefix);
    });
```

- [ ] **Step 3: Add keydown handler for keyboard navigation**

After the input event listener, add keydown handling. Replace the existing `keypress` listener with an enhanced version that handles the emote picker:

Change lines 355-358 from:
```js
    el.messageInput.addEventListener("keypress", (event) => {
        if (event.key == "Enter" && el.messageInput.value != "")
            el.messageSend.click();
    });
```

To:
```js
    el.messageInput.addEventListener("keydown", (event) => {
        if (emotePickerVisible) {
            if (event.key === "ArrowDown") {
                event.preventDefault();
                emotePickerSelectedIndex = Math.min(emotePickerSelectedIndex + 1, emotePickerResults.length - 1);
                highlightEmotePickerItem();
                return;
            }
            if (event.key === "ArrowUp") {
                event.preventDefault();
                emotePickerSelectedIndex = Math.max(emotePickerSelectedIndex - 1, -1);
                highlightEmotePickerItem();
                return;
            }
            if (event.key === "Enter" || event.key === "Tab") {
                if (emotePickerSelectedIndex >= 0 && emotePickerSelectedIndex < emotePickerResults.length) {
                    event.preventDefault();
                    insertSelectedEmote(emotePickerResults[emotePickerSelectedIndex]);
                    return;
                }
            }
            if (event.key === "Escape") {
                hideEmotePicker();
                return;
            }
        }
        if (event.key === "Enter" && el.messageInput.value != "")
            el.messageSend.click();
    });
```

- [ ] **Step 4: Add emote picker helper functions**

Add these functions inside `launchChat` after the `sendModAction` function (after line 330):

```js
    function renderEmotePicker(matches, prefix) {
        emotePicker.innerHTML = "";
        matches.forEach((code, index) => {
            const item = document.createElement("div");
            item.className = "peertube-plugin-chat-emote-picker-item";
            if (index === emotePickerSelectedIndex) item.classList.add("selected");
            const filename = emoteMap[code];
            item.innerHTML = `<img src="${emoteImageBase}/${filename}" /> ${code}`;
            item.addEventListener("mousedown", (e) => {
                e.preventDefault();
                insertSelectedEmote(code);
            });
            item.addEventListener("mouseenter", () => {
                emotePickerSelectedIndex = index;
                highlightEmotePickerItem();
            });
            emotePicker.appendChild(item);
        });
        emotePicker.style.display = "block";
        emotePickerVisible = true;
    }

    function highlightEmotePickerItem() {
        const items = emotePicker.querySelectorAll(".peertube-plugin-chat-emote-picker-item");
        items.forEach((item, index) => {
            item.classList.toggle("selected", index === emotePickerSelectedIndex);
        });
        if (emotePickerSelectedIndex >= 0 && items[emotePickerSelectedIndex]) {
            items[emotePickerSelectedIndex].scrollIntoView({ block: "nearest" });
        }
    }

    function insertSelectedEmote(code) {
        const text = el.messageInput.value;
        const cursorPos = el.messageInput.selectionStart;
        const beforeCursor = text.slice(0, cursorPos);
        const afterCursor = text.slice(cursorPos);

        const colonIndex = beforeCursor.lastIndexOf(":");
        const newText = beforeCursor.slice(0, colonIndex) + ":" + code + ": " + afterCursor;
        el.messageInput.value = newText;
        const newPos = colonIndex + code.length + 3;
        el.messageInput.setSelectionRange(newPos, newPos);
        hideEmotePicker();
        el.messageInput.focus();
    }

    function hideEmotePicker() {
        emotePicker.style.display = "none";
        emotePickerVisible = false;
        emotePickerSelectedIndex = -1;
        emotePickerResults = [];
    }
```

- [ ] **Step 5: Hide emote picker on blur**

Add after the keydown handler:
```js
    el.messageInput.addEventListener("blur", () => {
        setTimeout(hideEmotePicker, 200);
    });
```

- [ ] **Step 6: Add CSS for the emote picker**

Append to `assets/style.css`:
```css
.peertube-plugin-chat-emote-picker {
    position: absolute;
    bottom: 100%;
    left: 0;
    right: 0;
    background: var(--mainBackgroundColor, #222);
    border: 1px solid #555;
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
    color: var(--mainForegroundColor, #fff);
}
.peertube-plugin-chat-emote-picker-item:hover,
.peertube-plugin-chat-emote-picker-item.selected {
    background: #444;
}
.peertube-plugin-chat-emote-picker-item img {
    height: 24px;
    width: 24px;
    object-fit: contain;
}
```

- [ ] **Step 7: Build and verify**

```bash
npm run build
npx jshint main.js chat_server.js client/chat.js
```

Expected: No build or lint errors.

---

### Task 6: Final verification

- [ ] **Step 1: Rebuild**

```bash
npm run build
```

Expected: esbuild bundles `dist/main.js` without errors.

- [ ] **Step 2: Full lint**

```bash
npx jshint .
```

Expected: No lint errors.

- [ ] **Step 3: Commit all changes**

```bash
git add -A
git commit -m "feat: add emote support with admin management and autocomplete picker"
```
