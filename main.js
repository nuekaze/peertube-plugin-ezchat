const crypto = require('crypto');
const axios = require("axios");
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const chat = require('./chat_server.js');
// OID Configs
let twitch = null;
let youtube = null;
let x = null;
let state_tokens = {};
const rand=()=>Math.random(0).toString(36).substring(2);
const token=(length)=>(rand()+rand()+rand()+rand()).substring(0,length);

async function register({
  storageManager,
  registerWebSocketRoute,
  registerSetting,
  peertubeHelpers,
  settingsManager,
  getRouter
}) {

  const serverActor = await peertubeHelpers.server.getServerActor();
  const serverUrl = await peertubeHelpers.config.getWebserverUrl();
  const baseroute = await peertubeHelpers.plugin.getBaseRouterRoute();

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
      const allowedExts = ['.png', '.gif', '.webp'];
      const ext = path.extname(file.originalname).toLowerCase();
      if (!allowedExts.includes(ext)) {
        cb(new Error('Only PNG, GIF, and WebP files are allowed.'));
        return;
      }
      // Magic byte validation (first 4 bytes)
      const fd = require('fs').openSync(file.path, 'r');
      const buf = Buffer.alloc(4);
      require('fs').readSync(fd, buf, 0, 4, 0);
      require('fs').closeSync(fd);

      const sig = Array.from(buf);
      const magicBytes = {
        '.png': [0x89, 0x50, 0x4E, 0x47],
        '.gif': [0x47, 0x49, 0x46, 0x38],
        '.webp': [0x52, 0x49, 0x46, 0x46]
      };
      const expected = magicBytes[ext];
      if (!expected || !expected.every((b, i) => sig[i] === b)) {
        // Clean up the temp file
        try { require('fs').unlinkSync(file.path); } catch {}
        cb(new Error('File content does not match its extension.'));
        return;
      }
      cb(null, true);
    },
    limits: { fileSize: 1 * 1024 * 1024 }
  });

  async function isAdminUser(req, res) {
    try {
      const user = await peertubeHelpers.user.getAuthUser(res);
      return Boolean(user && user.role === 0);
    } catch {
      return false;
    }
  }

  await chat.initChat(storageManager);

  // Store chat state every 10 minutes.
  setInterval(async () => {
    await chat.saveChatState(storageManager);
  }, 1000 * 60 * 10);


  // Add route for generating token.
  const router = getRouter();
  router.get('/token', async (req, res) => {
    const user = await peertubeHelpers.user.getAuthUser(res);

    if (user)
    {
      const token = crypto.createHash('sha256').update(user.username + serverActor.privateKey).digest('hex');
      chat.addUser(user.Account.name, user.Account.Actor.url, token);

      res.json({
        token: token
      });
    }
    else
    {
      res.json({
        token: ""
      });
    }
  });

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

  // Admin: list and manage emotes
  router.get('/admin/emotes', async (req, res) => {
    if (!(await isAdminUser(req, res))) {
      res.status(403).send(`<!DOCTYPE html><html><head><title>Forbidden</title></head><body>
<h1>Forbidden</h1>
<p>Instance administrator access required.</p>
</body></html>`);
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
    fetch('${baseroute}/admin/emotes/upload', { method: 'POST', body: formData })
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
      fetch('${baseroute}/admin/emotes/delete', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({filename}) })
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
    fetch('${baseroute}/admin/emotes/save', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({emotes}) })
      .then(r => r.json())
      .then(data => {
        if (data.error) { showMessage(data.error, 'error'); return; }
        showMessage('Emotes saved!', 'success');
      })
      .catch(e => showMessage('Save failed: ' + e.message, 'error'));
  });

  function showMessage(msg, type) {
    var safeMsg = msg.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    messages.innerHTML = '<p class="' + type + '">' + safeMsg + '</p>';
    setTimeout(function() { messages.innerHTML = ''; }, 3000);
  }
  </script>
</body></html>`);
  });

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

  router.get('/setprivs', async (req, res) => {
    const user = await peertubeHelpers.user.getAuthUser(res);
    if (!user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const video = await peertubeHelpers.videos.loadByIdOrUUID(req.query.id);

    try
    {
      const data = (await peertubeHelpers.database.query("SELECT * FROM \"videoChannel\" WHERE id = $1", { bind: [video.channelId] }))[0][0];
      if (user.Account.id == data.accountId)
      {
        chat.addModToRoom(req.query.token, video.uuid, true, true);
      }
      res.json({ status: 'ok' });
    }
    catch (error)
    {
      peertubeHelpers.logger.error(error);
      res.status(500).json({ error: 'Failed to set privileges' });
    }
  });

  // Register and start the chat server.
  chat.createWebSocketServer(registerWebSocketRoute, serverActor, serverUrl, peertubeHelpers.logger, () => emoteMap);

  registerSetting({
    name: 'emoteManager',
    label: 'Emote Manager',
    type: 'html',
    descriptionHTML: '<a href="' + baseroute + '/admin/emotes" target="_blank">Open Emote Manager</a> — Upload and manage custom chat emotes. For instance administrators.',
    private: false
  });

  // Twitch auth
  registerSetting({
    name: 'twitchClientId',
    label: 'Twitch Client ID',

    type: 'input',
    descriptionHTML: 'Your Twitch App client ID here.',
    private: false
  });
  registerSetting({
    name: 'twitchClientSecret',
    label: 'Twitch Client Secret',

    type: 'input',
    descriptionHTML: 'Your Twitch App client Secret here.',
    private: true
  });

  // YouTube auth
//  registerSetting({
//    name: 'youtubeClientId',
//    label: 'YouTube Client ID',
//
//    type: 'input',
//    descriptionHTML: 'Your YouTube App client ID here.',
//    private: false
//  });
//  registerSetting({
//    name: 'youtubeClientSecret',
//    label: 'YouTube Client Secret',
//
//    type: 'input',
//    descriptionHTML: 'Your YouTube App client Secret here.',
//    private: true
//  });

  // X auth
//  registerSetting({
//    name: 'xClientId',
//    label: 'X Client ID',
//
//    type: 'input',
//    descriptionHTML: 'Your X App client ID here.',
//    private: false
//  });
//  registerSetting({
//    name: 'xClientSecret',
//    label: 'X Client Secret',
//
//    type: 'input',
//    descriptionHTML: 'Your X App client Secret here.',
//    private: true
//  });

  // Auth provider configuration
  const authProviders = {
    twitch: {
      enabled: true,
      name: 'Twitch',
      authUrl: 'https://id.twitch.tv/oauth2/authorize',
      tokenUrl: 'https://id.twitch.tv/oauth2/token',
      userInfoUrl: 'https://id.twitch.tv/oauth2/userinfo',
      userApiUrl: 'https://api.twitch.tv/helix/users',
      clientIdSetting: 'twitchClientId',
      clientSecretSetting: 'twitchClientSecret',
    },
    // youtube: {
    //   enabled: false,
    //   name: 'YouTube',
    //   authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    //   tokenUrl: '',
    //   userInfoUrl: '',
    //   userApiUrl: '',
    //   clientIdSetting: 'youtubeClientId',
    //   clientSecretSetting: 'youtubeClientSecret',
    // },
    // x: {
    //   enabled: false,
    //   name: 'X (Twitter)',
    //   authUrl: 'https://id.twitch.tv/oauth2/authorize',
    //   tokenUrl: '',
    //   userInfoUrl: '',
    //   userApiUrl: '',
    //   clientIdSetting: 'xClientId',
    //   clientSecretSetting: 'xClientSecret',
    // },
  };

  // Clean up expired state tokens every 5 minutes
  setInterval(() => {
    const now = Date.now();
    for (const [key, value] of Object.entries(state_tokens)) {
      if (value.created + 1000 * 60 * 5 < now) {
        delete state_tokens[key];
      }
    }
  }, 1000 * 60 * 5);

  // Auth functions
  router.get('/auth/twitch', async (req, res) => {

    const st = token(48);
    state_tokens[st] = {
      "created": Date.now(),
      "video": req.headers.referer
    };

    res.redirect("https://id.twitch.tv/oauth2/authorize?" + [
        "client_id=" + await settingsManager.getSetting("twitchClientId"),
        "redirect_uri=" + serverUrl + baseroute + "auth/twitch/callback",
        "response_type=code",
        "force_verify=true",
        "state=" + st,
        "nonce=" + st,
        "scope=openid"
    ].join("&"));
  });

//  router.get('/auth/youtube', async (req, res) => {
//  
//    const st = token(48);
//    state_tokens[st] = Date.now();
//
//    res.redirect("https://accounts.google.com/o/oauth2/v2/auth?" + [
//      "client_id=" + await settingsManager.getSetting("twitchClientId"),
//      "redirect_uri=" + serverUrl + baseroute + "auth/youtube/callback",
//      "response_type=code",
//      "state=" + st,
//      "scope=openid"
//    ].join("&"));
//  });
//
//  router.get('/auth/x', async (req, res) => {
//
//    const st = token(48);
//    state_tokens[st] = Date.now();
//
//    res.redirect("https://id.twitch.tv/oauth2/authorize?" + [
//      "client_id=" + await settingsManager.getSetting("twitchClientId"),
//      "redirect_uri=" + serverUrl + baseroute + "auth/x/callback",
//      "response_type=code",
//      "state=" + st,
//      "scope=openid"
//    ].join("&"));
//  });

  // Auth callback functions
  router.get('/auth/twitch/callback', async (req, res) => {
    // Get the token
    try
    {
      const redirect = state_tokens[req.query.state].video.split("?")[0];
      // Verify state. Fail if not existing (exception) or if timeout was less than 5 minute
      if (state_tokens[req.query.state].created + 1000 * 60 * 5 > Date.now())
      {
        delete state_tokens[req.query.state];
      }
      else
      {
        delete state_tokens[req.query.state];
        res.redirect(redirect + "?failed=true");
        return;
      }

      const token = await axios.post("https://id.twitch.tv/oauth2/token", [
        "client_id=" + await settingsManager.getSetting("twitchClientId"),
        "client_secret=" + await settingsManager.getSetting("twitchClientSecret"),
        "redirect_uri=" + serverUrl + baseroute + "auth/twitch/callback",
        "code=" + req.query.code,
        "grant_type=authorization_code"
      ].join("&"));

      const userinfo = await axios.get("https://id.twitch.tv/oauth2/userinfo",
        {headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer " + token.data.access_token
        }}
      );

      const user = await axios.get("https://api.twitch.tv/helix/users?id=" + userinfo.data.sub,
        {headers: {
          "Client-Id": await settingsManager.getSetting("twitchClientId"),
          "Authorization": "Bearer " + token.data.access_token
        }}
      );
      const nt = crypto.createHash('sha256').update("twitch" + user.data.data[0].login + serverActor.privateKey).digest('hex');
      chat.addUser(user.data.data[0].display_name, "https://twitch.tv/" + user.data.data[0].login, nt);
      res.redirect(redirect + "?token=" + nt);
    }
    catch (error)
    {
      peertubeHelpers.logger.error(error);
      try
      {
        res.redirect(redirect + "?failed=true");
      }
      catch (error2)
      {
        res.redirect("/");
      }
    }
  });

//  router.get('/auth/youtube/callback', async (req, res) => {
//    console.log(req);
//    res.json({"status": 1});
//  });
//
//  router.get('/auth/x/callback', async (req, res) => {
//    console.log(req);
//    res.json({"status": 1});
//  });
}

async function unregister() { }

module.exports = {
  register,
  unregister,
};
