const main_html = `<div id="peertube-plugin-chat-messages"></div>
<div id="peertube-plugin-chat-user-area">
    <div id="peertube-plugin-chat-settings-area" style="display: none;">
        <label for="peertube-plugin-chat-display-name">Display name:</label>
        <input class="form-control ng-pristine ng-valid ng-touched" id="peertube-plugin-chat-display-name" type="text" value="" />
        <label for="peertube-plugin-chat-color">Color:</label>
        <input class="form-control ng-pristine ng-valid ng-touched" id="peertube-plugin-chat-color" type="text" value="" />
        <button class="btn" id="peertube-plugin-chat-update-settings" />Update</button>
        <button class="btn" id="peertube-plugin-chat-log-out" />Log out</button>
    </div>
    <div id="peertube-plugin-chat-message-area" style="display: none;">
        <input class="form-control ng-pristine ng-valid ng-touched" type="text" id="peertube-plugin-chat-message-input" placeholder="Say something here..." />
        <button id="peertube-plugin-chat-message-send" style="display: none;"></button>
        <button class="btn" id="peertube-plugin-chat-toggle-settings">⚙️</button>
    </div>
    <div id="peertube-plugin-chat-auth-area">
        <div id="peertube-plugin-chat-auth-alternatives">
            <button class="btn" id="peertube-plugin-chat-auth-fedi">Fediverse</button>
            <button class="btn" id="peertube-plugin-chat-auth-twitch">Twitch</button>
            <!--<button class="btn" id="peertube-plugin-chat-auth-youtube">Youtube</button>-->
            <!--<button class="btn" id="peertube-plugin-chat-auth-x">X (Twitter)</button>-->
        </div>
        <div id="peertube-plugin-chat-auth-fedi-module"  style="display: none;">
            <p id="peertube-plugin-chat-auth-fedi-username">
                <input class="form-control ng-pristine ng-valid ng-touched" type="text" id="peertube-plugin-chat-auth-fedi-user-address" placeholder="username@fediverse.domain" />
                <button class="btn" id="peertube-plugin-chat-auth-fedi-get-code">Auth</button>
            </p>
            <p id="peertube-plugin-chat-auth-fedi-code-area" style="display: none;">
                <input type="text" id="peertube-plugin-chat-auth-fedi-code" />
                <button class="btn" id="peertube-plugin-chat-auth-fedi-validate-code">Send</button>
            </p>
        </div>
    </div>
</div>`;

export
{
    main_html
}
