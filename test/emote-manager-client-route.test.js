const assert = require('assert');
const fs = require('fs');

const server = fs.readFileSync('main.js', 'utf8');
const client = fs.readFileSync('client/main.js', 'utf8');
const styles = fs.readFileSync('assets/style.css', 'utf8');
const fileFilter = server.split('fileFilter: (req, file, cb) => {')[1].split('limits:')[0];
let manager = '';
if (fs.existsSync('client/emote_manager.js')) {
  manager = fs.readFileSync('client/emote_manager.js', 'utf8');
}

assert.match(server, /href="\/p\/ezchat\/emote-manager"/);
assert.match(server, /hasValidImageMagic/);
assert.doesNotMatch(fileFilter, /file\.path/);
assert.match(client, /registerClientRoute/);
assert.match(client, /route: "ezchat\/emote-manager"/);
assert.doesNotMatch(client, /isSettingHidden/);
assert.match(manager, /getAuthHeader/);
assert.match(manager, /\/admin\/emotes/);
assert.match(manager, /Choose files/);
assert.match(manager, /Upload files/);
assert.match(manager, /pendingFiles/);
assert.match(manager, /response\.text\(\)/);
assert.match(manager, /class="btn btn-primary/);
assert.match(styles, /\.ezchat-emote-manager/);
assert.match(styles, /--mainBackgroundColor/);

console.log('Emote manager client-route assertions passed');
