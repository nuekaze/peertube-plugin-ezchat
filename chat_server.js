const sendOtpMessage = require('./activity_pub.js');
const crypto = require("crypto");

const rooms = {};
const otpChecks = {};
const users = {};

// This disaster of code was LLM translated from Python to JavaScript 
// because I wrote the entire thing in Python at first.
// Then I wanted to make it completely standalone but did not want to write
// it all over again. Also I don't know JavaScript very well.

function onConnection(ws, serverActor, serverUrl, logger) {
  ws.on('message', async (message) => {
    const m = JSON.parse(message);
    logger.info(JSON.stringify(m, null, 2));
    const { room } = m;

    if (!rooms[room]) {
      rooms[room] = { clients: new Set(), users: [] };
    }

    if (m.type === 'MESSAGE') {
      if (users[m.token]) {
        const r = {
          type: 'MESSAGE',
          color: users[m.token].color,
          actor: users[m.token].actor,
          display_name: users[m.token].display_name,
          content: m.content,
        };

        rooms[room].clients.forEach((c) => c.send(JSON.stringify(r)));
      }
    } else if (m.type === 'JOIN') {
      rooms[room].clients.add(ws);

      if (!rooms[room].users.includes(m.token)) {
        rooms[room].users.push(m.token);
      }

      const r = { type: 'JOIN', status: 0 };

      if (users[m.token]) {
        r.is_authenticated = 1;
        r.display_name = users[m.token].display_name;
        r.color = users[m.token].color;
      } else {
        r.is_authenticated = 0;
      }

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
        const userAddress = m.user_address.trim('@');
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
    }
  });

  ws.on('close', () => {
    for (const [room, data] of Object.entries(rooms)) {
      if (data.clients.has(ws)) {
        data.clients.delete(ws);
        break;
      }
    }
  });
}

function addUser(user, token)
{
  if (!(token in users))
  {
    users[token] = {
      display_name: user.Account.name,
      actor: user.Account.Actor.url,
      color: "#" + token.substring(0, 6)
    };
  }
}

module.exports = {
  onConnection,
  addUser
};

