# Keiken Player (Japanese - "Experience Player")  
![](https://img.shields.io/badge/Discord-Activity-blue)

**Watch movies, videos, or anime in perfect sync with friends on Discord!**  

Keiken Player is an HLS-based Discord activity designed for hosting interactive watch parties. Synchronize playback across all participants, chat in real-time, and enjoy shared experiences effortlessly. Perfect for movie nights, anime marathons, or casual video sharing.  

## Features  
- **HLS-Based Streaming**: Supports HTTP Live Streaming (HLS) for smooth, adaptive playback.  
- **Synchronized Playback**: Ensures everyone watches the same moment simultaneously.  
- **Discord Integration**: Launch directly as a Discord activity in voice channels.  
- **User-Friendly Interface**: Intuitive controls for play/pause, seek, and volume adjustment.  
- **Cross-Platform Compatibility**: Works on desktop and browser versions of Discord.  

## Quick Demo
[![Keiken Player Demo](/images/quickdemo.gif)](https://www.youtube.com/watch?v=Q6bJj2Z1b1A "Keiken Player Demo")

Watch this quick demonstration to see Keiken Player in action! This video shows how to set up the player and experience synchronized viewing with friends on Discord.

## Installation  
1. **Clone the Repository**  
```bash
git clone https://github.com/hari01584/keiken-player.git
cd keiken-player
```
2. Install Dependencies
```bash
npm install
```
3. Set up the environment variables (Create a .env file and add the required keys):
```bash
DISCORD_CLIENT_ID="<your-discord-client-id>"
VITE_DISCORD_CLIENT_ID="<your-discord-client-id>"
DISCORD_CLIENT_SECRET="<your-discord-client-secret>"
```
4. **Start the Server**  
```bash
npm run dev
```

## Usage
1. **Join a Voice Channel** - Start a Discord voice call with your friends.
2. **Start Keiken Player Activity** - Use the bot command to launch the activity.
3. **Load a Video** - Enter HLS URL (.m3u8) to start streaming (More on How to Find it Below)!
4. **Enjoy the Show!** - Watch together with synced playback controls.

## What kind of videos are supported?
Theoretically any video that can be converted to HLS format can be played on Keiken Player. However, most popular streaming services like YouTube, Netflix, and Amazon Prime Video do not provide direct HLS URLs, to extract these URLs you can use several chrome extensions (or sniff around in networks tab)! For simplicity, here is one I found: [m3u8 Sniffer TV - Find and Play HLS Streaming URLs](https://chromewebstore.google.com/detail/m3u8-sniffer-tv-find-and/akkncdpkjlfanomlnpmmolafofpnpjgn)

**How to use:**
1. Install the extension from the Chrome Web Store.
2. Open the video you want to watch.
3. Click on the extension icon, make sure the sniff mode (ie the one which captures the m3u8 URL) is enabled.
4. Play the video, the extension should ideally show a popup like below:
![m3u8 pic](/images/m3u8_sample.png "m3u8 pic")

Use this link to play the video on Keiken Player!

**What if there is error in playing the video? [Keiken Player]**

There can be several situations where the video might not play, some of the common ones are:
- The link is invalid / not a m3u8 playlist.
- The video is geo-restricted, the place where keiken player is hosted might not have access to the video. (Discord strict CSP do not allow direct access to the video by client, therefore we need to proxy the video through the server, which might not have access to the video).
- The m3u8 playlist is in non-standard format, or the video is encrypted.
- The link is IP restricted, usually it happens when keiken is hosted on a cloud provider, some websites generate special links that bind to the client IP address, therefore when you try to play the video on keiken, it might not work (as the IP which can used to generate m3u8 stream link, is different from the one accessing it).

## Player Controls (and how Sync works) - Design
There are each unique room created for each instance of Keiken Player launched, In each of the rooms **there is one host (the one who joins room first / launch player)** who will be responsible for adding videos / controlling playback etc, and other people joining the room will be considered as participants.

The host can control playback, change video but the participant may choose to not follow the room host, and watch the video at their own pace, How this works is, If participant is closely following the host, the participant will be in sync with the host (if host pauses, participant will also pause), but *if the participant is not following the host (ie the difference in playback time is more than 3 seconds), the participant will be considered as out of sync, and will be able to control their local playback at their own pace.*

However, beware the **host can anytime force sync all participants to their playback time**, by clicking on the sync button (host exclusive feature), Moreover *participants can also choose to sync with the host* by clicking on the sync button!

## Special Mentions
The pillars of this project are:
- [RoboJS](https://robojs.dev/) - Made building Discord Activities a breeze! Took care of all the boilerplate code, and allowed me to focus on the core functionality.
- [HLS-Proxy](https://github.com/warren-bank/HLS-Proxy) - For proxying the HLS stream, as Discord strict CSP do not allow direct access to the video by client, therefore we need to proxy the video through the server.
- [ShadCN](https://ui.shadcn.com/) - For the beautiful UI components, which made the player look so good (and ShadCN is extremely easy to use, and customize).
