# AutoShorts.ai

AI-powered faceless video generator for TikTok and YouTube Shorts.

## Stack
- Static HTML/CSS/JS frontend in `app.html`
- Local Node relay server in `server.js`
- `kie.ai` for image generation
- OpenAI for script generation, TTS, and caption timing
- Web Audio API for music synthesis

## Files
```text
index.html   -> Landing page
app.html     -> Full application
server.js    -> Local API relay
```

## Run locally
1. Ensure `.env` contains your API keys.
2. Start the relay server:
   `npm start`
3. Open:
   `http://localhost:3000`
