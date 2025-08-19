import { main_html } from "./html.js";

async function launchChat(video, placeholder, user, token, baseroute, settings, chat_server)
{
    // We only show chat for livestreams.
    if (!video.isLive)
    {
        return;
    }

    // Create the chat container window. Maybe we need CSS on this to make it fit properly on the page?
    const chat_container = document.createElement("div");
    chat_container.setAttribute("id", "peertube-plugin-chat-container");
    chat_container.role = "region"; // No idea what this does.

    // Make our main content of the chat here.
    chat_container.innerHTML = main_html;

    // Apply the container.
    placeholder.append(chat_container);

    // Disable unavailable auth alternatives.
    if (!settings.twitchClientId)
        document.getElementById("peertube-plugin-chat-auth-twitch").style.display = "none";

    // Set up Websocket connection.
    const ws = new WebSocket(chat_server);
    ws.onopen = () => {
        console.log("Connected to room " + video.uuid);
    };

    ws.onclose = () => {
        console.log("Closed connection to room " + video.uuid);
    };

    // Keepalive ping to webswocket
    setInterval(() => {ws.send('{"type": "PING"}')}, 30000);

    // Process new messages.
    const chatbox = document.getElementById("peertube-plugin-chat-messages");
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
                document.getElementById("peertube-plugin-chat-auth-fedi-code-area").style = "display: block;";
            }
            else
            {
                message.textContent = "System: " + data.message;
                document.getElementById("peertube-plugin-chat-auth-fedi-get-code").disabled = false;
                document.getElementById("peertube-plugin-chat-auth-fedi-code-area").style = "display: none;";
                document.getElementById("peertube-plugin-chat-auth-alternatives").style = "display: block;";
                document.getElementById("peertube-plugin-chat-auth-fedi-module").style = "display: none;";
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
                document.getElementById("peertube-plugin-chat-auth-area").style = "display: none;";
                document.getElementById("peertube-plugin-chat-message-area").style = "display: block;";
            }
            else
            {
                document.getElementById("peertube-plugin-chat-auth-fedi-code-area").style = "display: none;";
                document.getElementById("peertube-plugin-chat-auth-fedi-get-code").disabled = false;
                document.getElementById("peertube-plugin-chat-auth-fedi-validate-code").disabled = false;
                window.localStorage.removeItem("peertubePluginChatToken");
                message.textContent = "System: " + data.message;
                document.getElementById("peertube-plugin-chat-auth-alternatives").style = "display: block;";
                document.getElementById("peertube-plugin-chat-auth-fedi-module").style = "display: none;";
            }
        }
        else if (data.type == "JOIN")
        {
            if (data.status == 0)
            {
                if (data.is_authenticated == 1)
                {
                    document.getElementById("peertube-plugin-chat-display-name").value = data.display_name;
                    document.getElementById("peertube-plugin-chat-color").value = data.color;
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
            username.href = data.actor;
            username.style = "text-decoration: none; color: " + data.color + ";";
            username.textContent = data.display_name;

            if (data.isOwner)
                badge.textContent = "🎥 ";
            else if (data.isMod)
                badge.textContent = "🔨 ";

            message.appendChild(username);
            username.after(": " + data.content);
            username.before(badge);
        }

        chatbox.appendChild(message);
        chatbox.scrollTop = chatbox.scrollHeight;
    };

    ws.onopen = function ()
    {
        // If we are logged in on local peertube.
        if (user && token)
        {
            window.localStorage.setItem("peertubePluginChatToken", token);
            ws.send(JSON.stringify({
                "type": "JOIN",
                "room": video.uuid,
                "token": token
            }));
            document.getElementById("peertube-plugin-chat-auth-area").style = "display: none;";
            document.getElementById("peertube-plugin-chat-message-area").style = "";
        }

        // If we are authencicated with any other method.
        else if (window.localStorage.getItem("peertubePluginChatToken"))
        {
            ws.send(JSON.stringify({
                "type": "JOIN",
                "room": video.uuid,
                "token": window.localStorage.getItem("peertubePluginChatToken")
            }));
            document.getElementById("peertube-plugin-chat-auth-area").style = "display: none;";
            document.getElementById("peertube-plugin-chat-message-area").style = "";
        }

        // We are anonymous we are just listening to chat and can not write.
        else
        {
            ws.send(JSON.stringify({
                "type": "JOIN",
                "room": video.uuid,
                "token": ""
            }));
        }
    };

    // Sending message handler.
    function sendMessage()
    {
        const input = document.getElementById("peertube-plugin-chat-message-input");
        ws.send(JSON.stringify({
            "type": "MESSAGE",
            "room": video.uuid,
            "token": window.localStorage.getItem("peertubePluginChatToken"),
            "content": input.value
        }));
        input.value = "";
    }

    // Update settings handler.
    function updateSettings()
    {
        const display_name = document.getElementById("peertube-plugin-chat-display-name");
        const color = document.getElementById("peertube-plugin-chat-color");
        ws.send(JSON.stringify({
            "type": "UPDATE_SETTINGS",
            "room": video.uuid,
            "token": window.localStorage.getItem("peertubePluginChatToken"),
            "display_name": display_name.value,
            "color": color.value
        }));
    }

    // Sending message hooks.
    document.getElementById("peertube-plugin-chat-message-send").addEventListener("click", sendMessage);
    document.getElementById("peertube-plugin-chat-message-input").addEventListener("keypress", () => {
        if (event.key == "Enter" && document.getElementById("peertube-plugin-chat-message-input").value != "")
            document.getElementById("peertube-plugin-chat-message-send").click();
    });

    // Settings hooks.
    document.getElementById("peertube-plugin-chat-update-settings").addEventListener("click", updateSettings);
    document.getElementById("peertube-plugin-chat-toggle-settings").addEventListener("click", () => {
        const settings_area = document.getElementById("peertube-plugin-chat-settings-area");
        if (settings_area.style.display == "none")
            settings_area.style.display = "block";
        else
            settings_area.style.display = "none";
    });

    document.getElementById("peertube-plugin-chat-log-out").addEventListener("click", () => {
        window.localStorage.setItem("peertubePluginChatToken", "");
        window.localStorage.setItem("peertubePluginChatIsAuthenticated", 0);
        window.location.reload();
    });

    // Auth area hooks.
    document.getElementById("peertube-plugin-chat-auth-fedi").addEventListener("click", () => {
        document.getElementById("peertube-plugin-chat-auth-alternatives").style.display = "none";
        document.getElementById("peertube-plugin-chat-auth-fedi-module").style.display = "block";
    });
    
    document.getElementById("peertube-plugin-chat-auth-twitch").addEventListener("click", () => {
        document.getElementById("peertube-plugin-chat-auth-fedi").disabled = true;
        document.getElementById("peertube-plugin-chat-auth-twitch").disabled = true;
        //document.getElementById("peertube-plugin-chat-auth-youtube").disabled = true;
        //document.getElementById("peertube-plugin-chat-auth-x").disabled = true;

        // Open call to Twitch API
        window.location.href = baseroute + "/auth/twitch";
    });

//    document.getElementById("peertube-plugin-chat-auth-youtube").addEventListener("click", () => {
//        document.getElementById("peertube-plugin-chat-auth-fedi").disabled = true;
//        document.getElementById("peertube-plugin-chat-auth-twitch").disabled = true;
//        document.getElementById("peertube-plugin-chat-auth-youtube").disabled = true;
//        document.getElementById("peertube-plugin-chat-auth-x").disabled = true;
//
//        // Open call to Twitch API
//        window.location.href = baseroute + "/auth/youtube";
//    });
//
//    document.getElementById("peertube-plugin-chat-auth-x").addEventListener("click", () => {
//        document.getElementById("peertube-plugin-chat-auth-fedi").disabled = true;
//        document.getElementById("peertube-plugin-chat-auth-twitch").disabled = true;
//        document.getElementById("peertube-plugin-chat-auth-youtube").disabled = true;
//        document.getElementById("peertube-plugin-chat-auth-x").disabled = true;
//
//        // Open call to X API
//        window.location.href = baseroute + "/auth/x";
//    });

    // Fediverse auth hooks.
    document.getElementById("peertube-plugin-chat-auth-fedi-get-code").addEventListener("click", () => {
        ws.send(JSON.stringify({
            "type": "AUTH_INIT",
            "room": video.uuid,
            "user_address": document.getElementById("peertube-plugin-chat-auth-fedi-user-address").value
        }));
        document.getElementById("peertube-plugin-chat-auth-fedi-get-code").disabled = true;
    });

    document.getElementById("peertube-plugin-chat-auth-fedi-validate-code").addEventListener("click", () => {
        ws.send(JSON.stringify({
            "type": "AUTH_VERIFY",
            "room": video.uuid,
            "token": window.localStorage.getItem("peertubePluginChatToken"),
            "code": document.getElementById("peertube-plugin-chat-auth-fedi-code").value
        }));
        document.getElementById("peertube-plugin-chat-auth-fedi-validate-code").disabled = true;
    });
}

export
{
    launchChat
};
