const WebSocket = require('ws');
const crypto = require('crypto');
const axios = require("axios");
const chat = require('./chat_server.js');
const { stringify } = require('querystring');

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

  router.get('/setprivs', async (req, res) => {
    const user = await peertubeHelpers.user.getAuthUser(res);
    if (!user)
      return;

    const video = await peertubeHelpers.videos.loadByIdOrUUID(req.query.id);
    console.log(video);

    try
    {
      const data = (await peertubeHelpers.database.query("SELECT * FROM \"videoChannel\" WHERE id = " + video.channelId + ";"))[0][0];
      if (user.Account.id == data.accountId)
      {
        chat.addModToRoom(req.query.token, video.uuid, true, true);
      }
    }
    catch (error)
    {
      console.log(error);
    }
  });

  // Register and start the chat server.
  const wss = new WebSocket.Server({ noServer: true });
  wss.on('connection', (ws) => {
    chat.onConnection(ws, serverActor, serverUrl, peertubeHelpers.logger);
  });

  registerWebSocketRoute({
    route: '/connect',
    handler: (request, socket, head) => {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    },
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

  // Auth functions
  router.get('/auth/twitch', async (req, res) => {

    st = token(48);
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
//    st = token(48);
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
//    st = token(48);
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
      console.log(error);
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

