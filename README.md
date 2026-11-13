# Free Agent Game

A mobile-friendly React + Vite app backed by Supabase. Participants sign in on their own phones, join with an invite code, and enter private predictions for MLB free agents.

## Features

- Supabase authentication and invite-code leagues
- 50 ranked MLB free agents and all 30 MLB teams
- Player-by-player game-night predictions
- Live Results tab with per-player reveal after every member locks in
- Commissioner controls, actual signing entry, and live standings
- Scoring: ranks 1–15 = 50 points, 16–35 = 35 points, 36–50 = 25 points

## Local development

1. Install Node.js 22 or later.
2. Copy `.env.example` to `.env` and add the Supabase URL and publishable key.
3. Run `npm install`.
4. Run `npm run dev`.

Never put a Supabase service-role key in the browser app.
