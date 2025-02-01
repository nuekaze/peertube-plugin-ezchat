const WebSocket = require('ws');
const crypto = require('crypto');
const chat = require('./chat_server.js');

async function register({
  storageManager,
  registerWebSocketRoute,
  peertubeHelpers,
  getRouter
}) {
  
  const serverActor = await peertubeHelpers.server.getServerActor();
  const serverUrl = await peertubeHelpers.config.getWebserverUrl();

  // Add route for generating token.
  const router = getRouter();
  router.get('/token', async (req, res) => {
    const user = await peertubeHelpers.user.getAuthUser(res);

    if (user)
    {
      const token = crypto.createHash('sha256').update(user.username + serverActor.privateKey).digest('hex');
      chat.addUser(user, token);

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
}

async function unregister() {

}

module.exports = {
  register,
  unregister,
};

