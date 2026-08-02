# Emote Manager Administrator Settings

Date: 2026-08-02

## Goal

Provide one reliable entry point for editing custom chat emotes. Instance administrators use the Emote Manager link in the EZChat plugin settings page. Livestream ownership, chat moderation status, and chat tokens do not grant emote-management access.

## Entry Point and Authorization

- Keep the existing `Emote Manager` HTML setting in `main.js`.
- The setting links to the authenticated PeerTube client route `/p/ezchat/emote-manager`.
- The client route calls the server API at the dynamic `/admin/emotes` plugin router URL with `peertubeHelpers.getAuthHeader()`.
- Remove the chat cogwheel Emote Manager link and its client-side visibility logic.
- Authenticate manager requests using the normal PeerTube browser session through `peertubeHelpers.user.getAuthUser(res)`.
- Require the PeerTube instance administrator role, not moderator or video-owner privileges.
- Remove the chat-token query fallback from the manager authorization path.
- Apply the same administrator check to all manager routes:
  - `GET /admin/emotes`
  - `POST /admin/emotes/upload`
  - `POST /admin/emotes/save`
  - `POST /admin/emotes/delete`

## Settings Visibility and Errors

- Do not use `private` as a UI visibility mechanism; PeerTube uses it for setting-value exposure.
- The manager link is exposed through the plugin settings page, which is the supported administrator entry point.
- Unauthorized manager API requests return JSON `403` responses stating that administrator access is required.
- The 403 response must not instruct users to authenticate through chat or retry with a token.
- Unauthorized write requests continue returning JSON `403` responses.

## Manager Data Flow

1. An instance administrator opens the EZChat plugin settings page.
2. The administrator opens `/p/ezchat/emote-manager`.
3. The client route calls `GET /admin/emotes` with the PeerTube authorization header.
4. The server returns the current emote map as JSON.
5. Upload, save, and delete requests use the same authorization header and are checked by the same administrator authorization helper.
6. The server persists successful changes through `storageManager.storeData("ezchat_emotes", emoteMap)`.

No emote-manager operation depends on the WebSocket connection, room ownership, chat authentication, or a query-string token.

## Error Handling

- Unauthenticated and non-administrator requests are rejected with `403`.
- Invalid uploads, invalid codes, missing files, and malformed payloads retain their existing `400` responses.
- Existing successful manager behavior and emote persistence remain unchanged.

## Verification

- Confirm administrators can see the Emote Manager setting.
- Confirm non-administrators cannot successfully access or modify the manager.
- Confirm an administrator can open the client-route manager, view emotes, upload an image, save a code, and delete an emote.
- Confirm direct unauthenticated access returns `403`.
- Confirm the chat cogwheel no longer contains an Emote Manager link.
- Run `npm run build`.
- Run `npx jshint .`.
