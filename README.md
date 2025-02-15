# EZChat for PeerTube
A Twitch-like chat plugin for PeerTube livestreams.

This is a very early release and only has barebone functionallity.

My goal with this project was to create a frictionless, viewer focused, chat feature for PeerTube that allows everyone to get into the chat as fast as possible without any sign-ups or other annoying things. Authenticate EZ and get into the chat!

## Features
- Chat like you would in Twitch chat.
- Local users are automatically logged in to chat.
- Remote users can authenticate to chat with any Fediverse account by using an OTP DM method.
- Remote users can authenticate with Twitch using OAuth.
- Custom display name and colors.

## Todo
- Make the UI look better.
- Add moderation capabilities. Timeout and ban.
- Add custom emotes.
- Make the chat remove messages after like 100.

## Contribute
Feel free to fix my horrible JavaScript code or implement any todo. This is my first JS project and it is a mess. But a working mess.

# Configuration
The addon does not have any configuration, which is part of the philosofy of the addon. It should "just work". The only "configuration" is that if you want to use an external OAuth method like Twitch, you must enter the Client Id and Client Secret in settings.

## Twitch OAuth
Here is how to set up Twitch OAuth:

1. Go to https://dev.twitch.tv/console and log in with your Twitch account.
2. In the menu, open Applications.
3. Click "Register Your Application".
4. - Name. (Can be anything but must be unique)
   - OAuth Redirect URL: https://my-peertube-instance.example.com/plugins/ezchat/0.0.5/router/auth/twitch/callback (Make sure the version number in the URL matches your installedversion of ezchat.)
   - Category: Website integration
   - Client Type: Confidantial
5. Click Manage on your new app.
6. Copy the Client Id and Client Secret (new secret) to the corresponding fields on the settings page for ezchat plugin.