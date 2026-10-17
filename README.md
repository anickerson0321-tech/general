# Encore — AI songs you can sing yourself

Encore is a Suno-style AI music app with one big addition: **you sing the song**. Make a song from a prompt, sing along karaoke-style while it records you, then use one slider to take your own voice from **Raw → Clean → Warm → Studio → Radio → Perfect**.

It runs entirely in the browser (phone or computer) and installs to your home screen like an app. Your songs, takes and keys stay on your device.

## What it does

| Suno-style features | Encore extras |
| --- | --- |
| Simple mode (describe a song) and Advanced mode (lyrics, styles, exclude styles, vocal gender, weirdness, style influence, length, title) | **Karaoke mode**: backing track, word-by-word highlighted lyrics, countdown, and a live pitch lane that shows whether you're on the note |
| Two versions per generation, model picker | **Records your voice** with latency compensation and a sync nudge |
| Write lyrics with AI, Enhance styles, random style dice, `[Verse]` / `[Chorus]` tag helpers | **Vocal Polish slider** (0–100): noise gate, EQ, de-esser, compression, reverb/delay, doubling and pitch correction toward the song's real melody, plus a hard-tune effect toggle and an A/B "hear raw" switch |
| Library (songs, liked, playlists), song pages, persistent player, full-screen now playing with synced lyrics | **In-tune score**: shows how in tune you were before and after polish |
| Cover / reuse prompt, downloads (song, instrumental and vocal stems) | **Studio**: multitrack mixer (instrumental, AI vocal, all your takes) with mute/solo/volume, drag to re-time, and MP3/WAV export |
| | **"My Version"**: saves your performance as a new song in your library |

## Engines

- **Encore Local** (built in, free, offline): writes the song, arranges it per genre, and sings it with a synthesized guide voice. It's good for practice and demos, but the voice is a synth, not a real singer.
- **fal.ai** (recommended, one key): MiniMax Music 3, ElevenLabs Music v2.5, MiniMax 2.6 and ACE-Step. These give real AI singers. The same key also splits vocals from the instrumental (for karaoke), times every lyric word, and writes lyrics. Pay-as-you-go, no subscription.
- **ElevenLabs** (alternative key): ElevenLabs Music with built-in word timing and stem separation.

To use real AI singers, open **Settings → paste your fal.ai key → Test**.

## Tips for singing

- Headphones give the cleanest takes. Without them, turn on **Echo cancel** in the karaoke mixer.
- If your voice sounds early or late, use **Settings → Auto-calibrate** once, or the **Sync** slider on a take.
- The polish slider tunes you toward the song's actual melody. Singing an octave lower or higher than the AI singer is fine.

## Development

```bash
cd app
npm install
npm run dev          # local dev server
npx vitest run       # unit tests (DSP, composer, lyrics alignment, providers)
npm run build && npx playwright test   # end-to-end tests with a fake mic + mocked AI provider
```

The repo is deployed to GitHub Pages by `.github/workflows/deploy.yml`. `supabase/functions/encore-proxy` is an optional CORS proxy, only needed if a provider ever blocks direct browser calls.

Encore is not affiliated with Suno.
