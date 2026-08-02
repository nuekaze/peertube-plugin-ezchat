import { launchChat } from "./chat.js";
import { mountEmoteManager } from "./emote_manager.js";

function register ({ registerHook, registerClientRoute, peertubeHelpers })
{
    registerClientRoute({
        route: "ezchat/emote-manager",
        title: "EZChat Emote Manager",
        onMount: ({ rootEl }) => mountEmoteManager(rootEl, peertubeHelpers)
    });

    registerHook({
        target: "action:video-watch.video.loaded",
        handler: ({ video }) => {
            const urlParams = new URLSearchParams(window.location.search);
            const nt = urlParams.get("token");
            if (nt)
            {
                window.localStorage.setItem("peertubePluginChatToken", nt);
                window.localStorage.setItem("peertubePluginChatIsAuthenticated", 1);
                window.location.href = window.location.href.split("?")[0];
            }

            // Prechecks and then we run the chat.
            if (!video)
            {
                console.warn("No video available.");
                return;
            }

            if (!video.isLive)
            {
                // Video is not a livestream.
                return;
            }

            const placeholder = document.getElementById("plugin-placeholder-player-next");

            if (!placeholder)
            {
                console.warn("Placeholder not present. Will not display chat.");
                return;
            }

            fetch(peertubeHelpers.getBaseRouterRoute() + '/token', {
                method: 'GET',
                headers: peertubeHelpers.getAuthHeader()
            }).then(res => res.json()).then(data => {

                return fetch(peertubeHelpers.getBaseRouterRoute() + '/setprivs?id=' + video.id + "&token=" + data.token, {
                    method: "GET",
                    headers: peertubeHelpers.getAuthHeader()
                }).then(() => peertubeHelpers.getSettings()).then(settings => {
                    launchChat(
                        video, 
                        placeholder, 
                        peertubeHelpers.getUser(),
                        data.token, 
                        peertubeHelpers.getBaseRouterRoute(),
                        settings, 
                        '/plugins/ezchat/ws/connect'
                    );
                });
            });
        }
    });
}

export
{
  register
};
