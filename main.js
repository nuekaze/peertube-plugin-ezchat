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

  function hasValidImageMagic(filePath, ext) {
    const magicBytes = {
      '.png': [0x89, 0x50, 0x4E, 0x47],
      '.gif': [0x47, 0x49, 0x46, 0x38],
      '.webp': [0x52, 0x49, 0x46, 0x46]
    };
    try {
      const signature = Array.from(fs.readFileSync(filePath).subarray(0, 4));
      const expected = magicBytes[ext];
      return Boolean(expected && expected.every((byte, index) => signature[index] === byte));
    } catch {
      return false;
    }
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

  // Admin: provide emote data to the authenticated client manager
  router.get('/admin/emotes', async (req, res) => {
    if (!(await isAdminUser(req, res))) {
      res.status(403).json({ error: 'Instance administrator access required.' });
      return;
    }
    res.json({ emotes: emoteMap });
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
      const invalidFile = req.files.find(file => {
        const ext = path.extname(file.originalname).toLowerCase();
        return !hasValidImageMagic(file.path, ext);
      });
      if (invalidFile) {
        req.files.forEach(file => {
          try { fs.unlinkSync(file.path); } catch {}
        });
        res.status(400).json({ error: `File content does not match its extension: ${invalidFile.originalname}` });
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
    descriptionHTML: '<a href="/p/ezchat/emote-manager">Open Emote Manager</a> — Upload and manage custom chat emotes. For instance administrators.',
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
