import { main_html } from "./html.js";

async function launchChat(video, placeholder, user, token, baseroute, settings, chat_server)
{
    if (!video.isLive)
    {
        return;
    }

    const chat_container = document.createElement("div");
    chat_container.setAttribute("id", "peertube-plugin-chat-container");
    chat_container.role = "region";
    chat_container.innerHTML = main_html;
    placeholder.append(chat_container);

    const el = {
        messages: document.getElementById("peertube-plugin-chat-messages"),
        messageInput: document.getElementById("peertube-plugin-chat-message-input"),
        messageSend: document.getElementById("peertube-plugin-chat-message-send"),
        messageArea: document.getElementById("peertube-plugin-chat-message-area"),
        authArea: document.getElementById("peertube-plugin-chat-auth-area"),
        authAlternatives: document.getElementById("peertube-plugin-chat-auth-alternatives"),
        authFediModule: document.getElementById("peertube-plugin-chat-auth-fedi-module"),
        authFedi: document.getElementById("peertube-plugin-chat-auth-fedi"),
        authFediGetCode: document.getElementById("peertube-plugin-chat-auth-fedi-get-code"),
        authFediValidateCode: document.getElementById("peertube-plugin-chat-auth-fedi-validate-code"),
        authFediCodeArea: document.getElementById("peertube-plugin-chat-auth-fedi-code-area"),
        authFediUserAddress: document.getElementById("peertube-plugin-chat-auth-fedi-user-address"),
        authFediCode: document.getElementById("peertube-plugin-chat-auth-fedi-code"),
        authTwitch: document.getElementById("peertube-plugin-chat-auth-twitch"),
        displayName: document.getElementById("peertube-plugin-chat-display-name"),
        color: document.getElementById("peertube-plugin-chat-color"),
        updateSettings: document.getElementById("peertube-plugin-chat-update-settings"),
        toggleSettings: document.getElementById("peertube-plugin-chat-toggle-settings"),
        settingsArea: document.getElementById("peertube-plugin-chat-settings-area"),
        logOut: document.getElementById("peertube-plugin-chat-log-out"),
    };

    if (!settings.twitchClientId)
        el.authTwitch.style.display = "none";

    let isLocalMod = false;
    let isLocalOwner = false;
    let localActor = "";
    let emoteMap = {};
    const emoteImageBase = baseroute + '/emotes';

    const ws = new WebSocket(chat_server);

    ws.onclose = () => {
        console.log("Closed connection to room " + video.uuid);
    };

    setInterval(() => { ws.send('{"type": "PING"}'); }, 30000);

    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        const message = document.createElement("div");
        const username = document.createElement("a");
        const badge = document.createElement("span");

        if (data.type == "AUTH_INIT")
        {
            if (data.status == 0)
            {
                window.localStorage.setItem("peertubePluginChatToken", data.token);
                message.textContent = "System: Recieved token. Waiting for OTP code.";
                el.authFediCodeArea.style.display = "block";
            }
            else
            {
                message.textContent = "System: " + data.message;
                el.authFediGetCode.disabled = false;
                el.authFediCodeArea.style.display = "none";
                el.authAlternatives.style.display = "block";
                el.authFediModule.style.display = "none";
            }
        }
        else if (data.type == "AUTH_VERIFY")
        {
            if (data.status == 0)
            {
                message.textContent = "System: User was successfully authenticated. Joining chat.";
                window.localStorage.setItem("peertubePluginChatIsAuthenticated", 1);
                ws.send(JSON.stringify({
                    "type": "JOIN",
                    "room": video.uuid,
                    "token": window.localStorage.getItem("peertubePluginChatToken")
                }));
                el.authArea.style.display = "none";
                el.messageArea.style.display = "block";
            }
            else
            {
                el.authFediCodeArea.style.display = "none";
                el.authFediGetCode.disabled = false;
                el.authFediValidateCode.disabled = false;
                window.localStorage.removeItem("peertubePluginChatToken");
                message.textContent = "System: " + data.message;
                el.authAlternatives.style.display = "block";
                el.authFediModule.style.display = "none";
            }
        }
        else if (data.type == "JOIN")
        {
            if (data.status == 0)
            {
                if (data.emotes) emoteMap = data.emotes;
                if (data.is_authenticated == 1)
                {
                    el.displayName.value = data.display_name;
                    el.color.value = data.color;
                    message.textContent = "Welcome " + data.display_name + "!";
                    if (data.actor) localActor = data.actor;
                    if (data.isMod) isLocalMod = true;
                    if (data.isOwner) isLocalOwner = true;
                }
                else
                {
                    window.localStorage.setItem("peertubePluginChatToken", "");
                    window.localStorage.setItem("peertubePluginChatIsAuthenticated", 0);
                    message.textContent = "Welcome! Please authenticate to chat.";
                }
            }
            else
                message.textContent = "System: " + data.message;
        }
        else if (data.type == "UPDATE_SETTINGS")
        {
            if (data.status == 0)
                message.textContent = "System: Updated.";
            else
                message.textContent = "System: " + data.message;
        }
        else if (data.type == "MESSAGE")
        {
            message.setAttribute("data-message-id", data.messageId);
            username.href = data.actor;
            username.style = "text-decoration: none; color: " + data.color + ";";
            username.textContent = data.display_name;
            username.setAttribute("data-actor", data.actor);

            if (data.isOwner)
                badge.textContent = "🎥 ";
            else if (data.isMod)
                badge.textContent = "🔨 ";

            message.appendChild(username);
            username.after(": ");
            const rendered = data.content.replace(/:([\w]+):/g, (match, code) => {
                const filename = emoteMap[code];
                return filename
                    ? `<img src="${emoteImageBase}/${filename}" class="peertube-plugin-chat-emote" title="${code}" alt=":${code}:" />`
                    : match;
            });
            username.insertAdjacentHTML("afterend", rendered);
            username.before(badge);

            const localToken = window.localStorage.getItem("peertubePluginChatToken");

            if (isLocalMod || isLocalOwner)
            {
                const delBtn = document.createElement("button");
                delBtn.textContent = "✕";
                delBtn.className = "peertube-plugin-chat-delete-btn";
                delBtn.title = "Delete message";
                delBtn.addEventListener("click", (e) => {
                    e.stopPropagation();
                    ws.send(JSON.stringify({
                        type: "DELETE_MESSAGE",
                        room: video.uuid,
                        token: localToken,
                        messageId: data.messageId
                    }));
                });
                message.appendChild(delBtn);
            }

            if ((isLocalMod || isLocalOwner) && data.actor !== localActor) {
                username.style.cursor = "pointer";
                username.addEventListener("click", (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    showUserPopup(e, data.actor, ws, video.uuid, localToken, isLocalOwner);
                });
            }
        }
        else if (data.type == "MESSAGE_DELETED")
        {
            const mid = String(data.messageId).replace(/[\\"]/g, '\\$&');
            const msgEl = el.messages.querySelector('[data-message-id="' + mid + '"]');
            if (msgEl) msgEl.remove();
            return;
        }
        else if (data.type == "USER_TIMEOUTED")
        {
            message.className = "peertube-plugin-chat-system";
            message.textContent = data.actor + " has been timed out for " + data.duration + " seconds.";
        }
        else if (data.type == "USER_BANNED")
        {
            message.className = "peertube-plugin-chat-system";
            message.textContent = data.actor + " has been banned.";
        }
        else if (data.type == "USER_UNBANNED")
        {
            message.className = "peertube-plugin-chat-system";
            message.textContent = data.actor + " has been unbanned.";
        }
        else if (data.type == "MOD_ASSIGNED")
        {
            message.className = "peertube-plugin-chat-system";
            message.textContent = data.actor + " is now a moderator.";
            if (data.actor === localActor) isLocalMod = true;
        }
        else if (data.type == "MOD_UNASSIGNED")
        {
            message.className = "peertube-plugin-chat-system";
            message.textContent = data.actor + " is no longer a moderator.";
            if (data.actor === localActor) isLocalMod = false;
        }
        else if (data.type == "ERROR")
        {
            message.className = "peertube-plugin-chat-system";
            message.textContent = "System: " + data.message;
        }

        el.messages.appendChild(message);
        el.messages.scrollTop = el.messages.scrollHeight;
    };

    ws.onopen = function ()
    {
        if (user && token)
        {
            window.localStorage.setItem("peertubePluginChatToken", token);
            ws.send(JSON.stringify({
                "type": "JOIN",
                "room": video.uuid,
                "token": token
            }));
            el.authArea.style.display = "none";
            el.messageArea.style.display = "";
        }

        else if (window.localStorage.getItem("peertubePluginChatToken"))
        {
            ws.send(JSON.stringify({
                "type": "JOIN",
                "room": video.uuid,
                "token": window.localStorage.getItem("peertubePluginChatToken")
            }));
            el.authArea.style.display = "none";
            el.messageArea.style.display = "";
        }

        else
        {
            ws.send(JSON.stringify({
                "type": "JOIN",
                "room": video.uuid,
                "token": ""
            }));
        }
    };

    function showUserPopup(event, actor, ws, room, token, isOwner) {
        const existing = document.getElementById("peertube-plugin-chat-user-popup");
        if (existing) existing.remove();

        const popup = document.createElement("div");
        popup.id = "peertube-plugin-chat-user-popup";
        popup.style.position = "absolute";
        popup.style.left = event.clientX + "px";
        popup.style.top = event.clientY + "px";
        popup.style.background = "var(--mainBackgroundColor, #222)";
        popup.style.border = "1px solid #555";
        popup.style.borderRadius = "4px";
        popup.style.padding = "4px";
        popup.style.zIndex = "1000";

        const items = [
            { label: "Timeout 10m", action: () => sendModAction(ws, "TIMEOUT_USER", room, token, actor, 600) },
            { label: "Timeout 1h", action: () => sendModAction(ws, "TIMEOUT_USER", room, token, actor, 3600) },
            { label: "Timeout 24h", action: () => sendModAction(ws, "TIMEOUT_USER", room, token, actor, 86400) },
            { label: "Ban", action: () => sendModAction(ws, "BAN_USER", room, token, actor) },
        ];

        if (isOwner) {
            items.push({ label: "Mod", action: () => sendModAction(ws, "MOD_USER", room, token, actor) });
            items.push({ label: "Unmod", action: () => sendModAction(ws, "UNMOD_USER", room, token, actor) });
        }

        items.push({ label: "Cancel", action: () => {} });

        items.forEach(item => {
            const btn = document.createElement("button");
            btn.textContent = item.label;
            btn.style.display = "block";
            btn.style.width = "100%";
            btn.style.background = "none";
            btn.style.border = "none";
            btn.style.color = "var(--mainForegroundColor, #fff)";
            btn.style.padding = "4px 8px";
            btn.style.textAlign = "left";
            btn.style.cursor = "pointer";
            btn.addEventListener("mouseenter", () => { btn.style.background = "#444"; });
            btn.addEventListener("mouseleave", () => { btn.style.background = "none"; });
            btn.addEventListener("click", (e) => {
                e.stopPropagation();
                item.action();
                popup.remove();
            });
            popup.appendChild(btn);
        });

        document.body.appendChild(popup);

        setTimeout(() => {
            document.addEventListener("click", closePopup);
        }, 0);

        function closePopup(e) {
            if (!popup.contains(e.target)) {
                popup.remove();
                document.removeEventListener("click", closePopup);
            }
        }
    }

    function sendModAction(ws, type, room, token, targetActor, duration) {
        const payload = {
            type: type,
            room: room,
            token: token,
            targetActor: targetActor
        };
        if (duration !== undefined) payload.duration = duration;
        ws.send(JSON.stringify(payload));
    }

    function sendMessage()
    {
        ws.send(JSON.stringify({
            "type": "MESSAGE",
            "room": video.uuid,
            "token": window.localStorage.getItem("peertubePluginChatToken"),
            "content": el.messageInput.value
        }));
        el.messageInput.value = "";
    }

    function updateSettings()
    {
        ws.send(JSON.stringify({
            "type": "UPDATE_SETTINGS",
            "room": video.uuid,
            "token": window.localStorage.getItem("peertubePluginChatToken"),
            "display_name": el.displayName.value,
            "color": el.color.value
        }));
    }

    el.messageSend.addEventListener("click", sendMessage);
    el.messageInput.addEventListener("keypress", (event) => {
        if (event.key == "Enter" && el.messageInput.value != "")
            el.messageSend.click();
    });

    el.updateSettings.addEventListener("click", updateSettings);
    el.toggleSettings.addEventListener("click", () => {
        if (el.settingsArea.style.display == "none")
            el.settingsArea.style.display = "block";
        else
            el.settingsArea.style.display = "none";
    });

    el.logOut.addEventListener("click", () => {
        window.localStorage.setItem("peertubePluginChatToken", "");
        window.localStorage.setItem("peertubePluginChatIsAuthenticated", 0);
        window.location.reload();
    });

    el.authFedi.addEventListener("click", () => {
        el.authAlternatives.style.display = "none";
        el.authFediModule.style.display = "block";
    });
    
    el.authTwitch.addEventListener("click", () => {
        el.authFedi.disabled = true;
        el.authTwitch.disabled = true;

        window.location.href = baseroute + "/auth/twitch";
    });

//    document.getElementById("peertube-plugin-chat-auth-youtube").addEventListener("click", () => {
//        document.getElementById("peertube-plugin-chat-auth-fedi").disabled = true;
//        document.getElementById("peertube-plugin-chat-auth-twitch").disabled = true;
//        document.getElementById("peertube-plugin-chat-auth-youtube").disabled = true;
//        document.getElementById("peertube-plugin-chat-auth-x").disabled = true;
//
//        window.location.href = baseroute + "/auth/youtube";
//    });
//
//    document.getElementById("peertube-plugin-chat-auth-x").addEventListener("click", () => {
//        document.getElementById("peertube-plugin-chat-auth-fedi").disabled = true;
//        document.getElementById("peertube-plugin-chat-auth-twitch").disabled = true;
//        document.getElementById("peertube-plugin-chat-auth-youtube").disabled = true;
//        document.getElementById("peertube-plugin-chat-auth-x").disabled = true;
//
//        window.location.href = baseroute + "/auth/x";
//    });

    el.authFediGetCode.addEventListener("click", () => {
        ws.send(JSON.stringify({
            "type": "AUTH_INIT",
            "room": video.uuid,
            "user_address": el.authFediUserAddress.value
        }));
        el.authFediGetCode.disabled = true;
    });

    el.authFediValidateCode.addEventListener("click", () => {
        ws.send(JSON.stringify({
            "type": "AUTH_VERIFY",
            "room": video.uuid,
            "token": window.localStorage.getItem("peertubePluginChatToken"),
            "code": el.authFediCode.value
        }));
        el.authFediValidateCode.disabled = true;
    });
}

export
{
    launchChat
};
