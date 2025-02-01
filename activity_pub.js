const crypto = require("crypto");
const axios = require("axios");

// Also LLM converted file from Python to JavaScript. It still works which is amazing.

// Activity template
const activityTemplate = {
  '@context': ['https://www.w3.org/ns/activitystreams'],
  type: 'Create',
  id: '',
  actor: '',
  visibility: 'direct',
  object: {
    id: '',
    type: ['Note', 'lp:ChatMessage'],
    visibility: 'direct',
    attributedTo: '',
    content: '',
    published: '',
    to: [],
    cc: [],
    tags: [],
  },
  mentions: [],
  published: '',
  to: [],
  cc: [],
};

function createSigningHeaders(method, server, url, keyId, body, additionalHeaders, privateKey) {
  // Create the string to sign
  const timestamp = new Date().toUTCString();
  const digest = crypto.createHash('sha256').update(body).digest();
  const digestBase64 = digest.toString('base64');
  const signingString = `(request-target): ${method.toLowerCase()} /${url.split('/').slice(3).join('/')}\nhost: ${url.split('/')[2]}\ndate: ${timestamp}\ndigest: SHA-256=${digestBase64}`;

  // Sign the string
  const signature = crypto.sign('SHA256', Buffer.from(signingString), {
    key: privateKey,
    padding: crypto.constants.RSA_PKCS1_PADDING,
  });

  // Encode the signature in base64
  const signatureBase64 = signature.toString('base64');

  // Create the headers
  const headers = {
    Host: server,
    Signature: `keyId="${keyId}",algorithm="rsa-sha256",headers="(request-target) host date digest",signature="${signatureBase64}"`,
    Date: timestamp,
    Digest: `SHA-256=${digestBase64}`,
  };

  Object.assign(headers, additionalHeaders);

  return headers;
}

async function sendOtpMessage(user, server, serverActor, serverUrl, code, logger) {
  const activity = { ...activityTemplate };

  // Step 1: Lookup the user's WebFinger
  const webfingerUrl = `https://${server}/.well-known/webfinger?resource=acct:${user}@${server}`;
  try {
    const response = await axios.get(webfingerUrl);
    const webfingerData = response.data;

    // Step 2: Request the user's actor and find the inbox URL
    const actor = webfingerData.links.find((l) => l.rel === 'self');
    if (!actor) {
      return ['WEBFINGER_FAIL', ''];
    }

    const actorResponse = await axios.get(actor.href, { headers: { Accept: actor.type } });
    const actorData = actorResponse.data;
    //logger.info(JSON.stringify(actorData, null, 2));
    const inboxUrl = actorData.inbox;

    const createDate = new Date().toISOString().replace(/[-:.]/g, '').slice(0, 14); // YYYYMMDDHHMMSS
    //logger.info(serverUrl);
    activity.id = `${serverUrl}/${createDate}`; // This is a fake id.
    activity.object.id = activity.id;
    activity.published = createDate;
    activity.to = [actorData.id];
    activity.object.to = [actorData.id];
    activity.tag = [{
      type: 'Mention',
      href: actorData.id,
      name: `@${user}@${server}`,
    }];
    activity.object.tag = activity.tag;
    activity.object.content = `Your code is: ${code}`;

    // Add our server actor here.
    activity.actor = serverActor.url;
    activity.object.attributedTo = serverActor.url;

    //logger.info(JSON.stringify(activity, null, 2));

    const data = JSON.stringify(activity);

    const headers = createSigningHeaders(
      'post',
      server,
      inboxUrl,
      `${serverActor.url}#main-key`,
      data,
      { 'Content-Type': 'application/activity+json' },
      serverActor.privateKey,
    );

    const postResponse = await axios.post(inboxUrl, data, { headers });

    if (postResponse.status >= 200 && postResponse.status < 300) {
      return ['OK', actorData.id];
    }
    return ['SEND_POST_FAIL', ''];
  } catch (error) {
    if (error.response) {
      logger.error(`HTTP Error: ${error.response.status} - ${error.response.statusText}`);
    } else {
      logger.error(error.message);
      if (error.stack) {
        logger.error(error.stack);
      }
    }
    return ['SEND_POST_FAIL', error.message];
  }
}

module.exports = sendOtpMessage;

