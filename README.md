<<<<<<< HEAD
# Carnage — Full Stack Quantum Learning Platform

This package connects the supplied Carnage frontend pages to a Node/Express backend.

## Included
- `public/index.html` — Carnage landing page
- `public/game.html` — Quantum Games + flashcards
- `public/quiz.html` — 50-question quiz UI
- `public/lab/index.html` — Quantum Lab UI
- `public/lab/app.js` — Lab frontend connected to backend APIs
- `public/lab/style.css` — Lab styling
- `public/assets/carnage-logo.png` — supplied Carnage logo
- `server.js` — API server
- `public/data/quizzes.json` — backend quiz dataset extracted from the supplied quiz page
- `.env.example` — secure configuration template

## Run
1. Install Node.js 18+.
2. Open this folder in a terminal.
3. Run `npm install`.
4. Copy `.env.example` to `.env`.
5. Start with `npm start`.
6. Open `http://localhost:3000`.

## Quantum AI setup
Do **not** put the API key in HTML or browser JavaScript.

1. Copy `.env.example` to `.env`.
2. Set `QUANTUM_AI_API_URL` to your OpenAI-compatible chat-completions endpoint.
3. Set `QUANTUM_AI_API_KEY` to your secret key.
4. Set `QUANTUM_AI_MODEL` to the model available from your provider.
5. Restart `npm start` after changing `.env`.

The lab AI now supports:
- Multi-turn conversation history instead of sending only the latest message.
- Circuit-aware prompts using the current qubit count, gates, simulator results, execution mode, and shots.
- Structured circuit actions: the AI can build/replace a circuit and optionally run it immediately.
- Bell and GHZ generation, gate placement, explanation, debugging, and optimization in offline fallback mode.
- Safe server-side validation of AI-generated gates before the browser applies them.
- 30-second provider timeout and no API-key logging.

If no AI key is configured, the lab still has a **Smart Offline Assistant** for common quantum commands. Open-ended questions require a configured AI provider.

## Backend endpoints
- `GET /api/health`
- `GET /api/quizzes`
- `POST /api/quiz/answer`
- `POST /api/quiz/submit`
- `POST /api/quantum/run`
- `POST /api/quantum/optimize`
- `POST /api/quantum-chat`
- `POST /api/auth/email`

The quantum simulator supports H, X, Y, Z, S, T, CX/CNOT and SWAP for 1–4 qubits, shot sampling, state amplitudes, and per-qubit Bloch vectors. The noisy mode applies configurable bit/phase noise to sampled results.

## Important
The current Google/GitHub buttons in the supplied landing page are UI placeholders. Real OAuth needs provider credentials and callback routes; those should be added only when you provide the OAuth configuration.

## Profiles and learning progress
- Email sign-in creates or restores a profile. Profile data is stored in `data/users.json` on the server and survives restarts; users sign in again after a restart.
- The profile dashboard shows points, level, daily streak, quiz results, mastered flashcards, active days, and circuits run. It supports editing the display name, exporting profile data, signing out, and deleting the profile.
- Points: +10 the first time each quiz question is answered correctly, +20 for the first full quiz completed each day, +5 the first time each flashcard is marked known, and +3 for the first circuit run each day. Each 100 points advances one level.
- Email-only sign-in is still a demo: it does not verify email ownership. Do not use it as production authentication until an email verification or OAuth provider is configured. Sessions are held in memory, so users sign in again if the server restarts.
=======
# First-Project-
>>>>>>> 1a0fc9ed669b89ed1d9958a6295807a7339e7d96
