import { launchChat } from "./chat.js";

function register ({ registerHook, peertubeHelpers })
{
    registerHook({
        target: "action:video-watch.video.loaded",
        handler: ({ video }) => {

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
                launchChat(video, placeholder, peertubeHelpers.getUser(), data.token, '/plugins/ezchat/ws/connect');
            });
        }
    });
}

export
{
  register
};
