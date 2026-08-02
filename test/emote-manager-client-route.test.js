const assert = require('assert');
const fs = require('fs');

const server = fs.readFileSync('main.js', 'utf8');
const client = fs.readFileSync('client/main.js', 'utf8');
let manager = '';
if (fs.existsSync('client/emote_manager.js')) {
  manager = fs.readFileSync('client/emote_manager.js', 'utf8');
}

assert.match(server, /href="\/p\/ezchat\/emote-manager"/);
assert.match(client, /registerClientRoute/);
assert.match(client, /route: "ezchat\/emote-manager"/);
assert.match(manager, /getAuthHeader/);
assert.match(manager, /\/admin\/emotes/);

console.log('Emote manager client-route assertions passed');
