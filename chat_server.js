const WebSocket = require('ws');
const sendOtpMessage = require('./activity_pub.js');
const crypto = require("crypto");

const rooms = {};
const otpChecks = {};
let users = {};
let bans = {};

async function initChat(storageManager)
{
  users = await storageManager.getData("ezchat_users");

  if (!users)
    users = {};

  const savedBans = await storageManager.getData("ezchat_bans");
  if (savedBans) {
    bans = savedBans;
  } else {
    bans = {};
  }
}

async function saveChatState(storageManager)
{
  await storageManager.storeData("ezchat_users", users);

  const bansMap = {};
  for (const [roomId, bannedList] of Object.entries(bans)) {
    if (bannedList.length > 0) {
      bansMap[roomId] = bannedList;
    }
  }
  await storageManager.storeData("ezchat_bans", bansMap);
}



function onConnection(ws, serverActor, serverUrl, logger, getEmoteMap) {
  ws.on('message', async (message) => {
    const m = JSON.parse(message);
    logger.debug(JSON.stringify(m, null, 2));
    const { room } = m;

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
        banned: bans[room] || (bans[room] = [])
      };
    }

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

        if (rooms[room].owner == m.token)
        {
          r.isOwner = true;
        }
        if (rooms[room].mods.includes(m.token))
        {
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
        ws.token = m.token;

        rooms[room].clients.forEach((c) => c.send(JSON.stringify(r)));
      }
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
    } else if (m.type === 'UPDATE_SETTINGS') {
      if (users[m.token]) {
        users[m.token].display_name = m.display_name;
        users[m.token].color = m.color;
        ws.send(JSON.stringify({ type: 'UPDATE_SETTINGS', status: 0 }));
      } else {
        ws.send(JSON.stringify({ type: 'UPDATE_SETTINGS', status: 1, message: 'You is not authenticated.' }));
      }
    } else if (m.type === 'AUTH_VERIFY') {
      if (m.code === otpChecks[m.token]?.code) {
        users[m.token] = { ...otpChecks[m.token] };
        delete users[m.token].code;
        ws.send(JSON.stringify({ type: 'AUTH_VERIFY', status: 0 }));
      } else {
        delete otpChecks[m.token];
        ws.send(JSON.stringify({ type: 'AUTH_VERIFY', status: 1, message: 'Code does not match. Restart auth process.' }));
      }
    } else if (m.type === 'AUTH_INIT') {
      try {
        const userAddress = m.user_address.replace(/^@+|@+$/g, '');
        const [userName, userServer] = userAddress.split('@');

        const token = crypto.createHash('sha256').update(userAddress + serverActor.privateKey).digest('hex');
        
        let code = Math.floor(Math.random() * 1000000).toString();

        if (code.length < 6) {
          code = '0'.repeat(6 - code.length) + code;
        }

        otpChecks[token] = {
          code,
          display_name: userName,
          color: `#${crypto.createHash('sha256').update(userAddress).digest('hex').substring(0, 6)}`,
        };

        const [status, actor] = await sendOtpMessage(userName, userServer, serverActor, serverUrl, code, logger);
        otpChecks[token].actor = actor;

        if (!status) {
          logger.info('no status');
        }

        if (status === 'OK') {
          ws.send(JSON.stringify({ type: 'AUTH_INIT', status: 0, token }));
        } else if (status === 'WEBFINGER_FAIL') {
          ws.send(JSON.stringify({ type: 'AUTH_INIT', status: 2, message: `Failed to verify webfinger for account: ${userAddress}` }));
        } else if (status === 'ACTOR_FAIL') {
          ws.send(JSON.stringify({ type: 'AUTH_INIT', status: 3, message: `Failed to fetch actor for account: ${userAddress}` }));
        } else if (status === 'SEND_POST_FAIL') {
          ws.send(JSON.stringify({ type: 'AUTH_INIT', status: 4, message: "Something else broke. Check server logs and make issue." }));
        }
      } catch (e) {
        logger.error(e.message);
        ws.send(JSON.stringify({ type: 'AUTH_INIT', status: 1, message: 'Not a valid username.' }));
      }
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
      const duration = Math.max(0, Math.min(Math.floor(Number(m.duration)) || 0, 315360000));
      if (duration === 0) {
        delete rooms[room].timeouts[m.targetActor];
      } else {
        rooms[room].timeouts[m.targetActor] = Date.now() + duration * 1000;
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
        duration: duration
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
      bans[room] = rooms[room].banned;
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
  });

  ws.on('close', () => {
    for (const [room, data] of Object.entries(rooms)) {
      if (data.clients.has(ws)) {
        data.clients.delete(ws);
        if (data.clients.size === 0) {
          delete rooms[room];
        }
        break;
      }
    }
  });
}

function addUser(user, url, token)
{
  if (!(token in users))
  {
    users[token] = {
      display_name: user,
      actor: url,
      color: "#" + token.substring(0, 6)
    };
  }
}

function createWebSocketServer(registerWebSocketRoute, serverActor, serverUrl, logger, getEmoteMap) {
  const wss = new WebSocket.Server({ noServer: true });
  wss.on('connection', (ws) => {
    onConnection(ws, serverActor, serverUrl, logger, getEmoteMap);
  });

  registerWebSocketRoute({
    route: '/connect',
    handler: (request, socket, head) => {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    },
  });

  return wss;
}

function addModToRoom(token, room, isMod, isOwner)
{
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
      banned: bans[room] || (bans[room] = [])
    };
  }
  
  if (isOwner)
  {
    rooms[room].owner = token;

    if (!rooms[room].mods.includes(token))
      rooms[room].mods.push(token);
  }
  if (isMod && !rooms[room].mods.includes(token))
    rooms[room].mods.push(token);
}

module.exports = {
  onConnection,
  addUser,
  initChat,
  saveChatState,
  addModToRoom,
  createWebSocketServer
};

