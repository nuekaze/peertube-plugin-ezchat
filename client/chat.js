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
                if (data.is_authenticated == 1)
                {
                    el.displayName.value = data.display_name;
                    el.color.value = data.color;
                    message.textContent = "Welcome " + data.display_name + "!";
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
            username.after(": " + data.content);
            username.before(badge);
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
