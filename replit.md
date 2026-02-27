# Fawazeer Seif - فوازير سيف

## Overview
Real-time live quiz web app (Kahoot-like) for the Annual Suhoor event. Features big screen display, mobile player interface, host controller, and question management. All UI in Arabic, RTL layout.

## Tech Stack
- **Frontend**: React + TypeScript + Tailwind CSS + Framer Motion + Wouter
- **Backend**: Express.js + Socket.io
- **Real-time**: Socket.io for WebSocket communication
- **Storage**: In-memory (per session)
- **Theme**: Background #1C1F2A, Gold #CDB58B
- **Fonts**: IBM Plex Sans Arabic + IBM Plex Sans

## Architecture

### Join Flow (QR-only)
- No visible PIN. Each session generates a secure random sessionId (UUID).
- The big screen lobby shows a QR code linking to `/join?s=<sessionId>`.
- Players scan the QR code, enter their name, and join.
- No public session listing. No way to join without the QR URL.

### Routes
- `/` - Home page with navigation
- `/join?s=<sessionId>` - Player mobile join screen (QR-only access)
- `/display?s=<sessionId>` - Big screen display
- `/host` - Host controller (creates session, opens display)
- `/admin` - Question management (CRUD, CSV import, JSON export)

### API Endpoints
- `GET /api/questions` - List all questions
- `POST /api/questions` - Create question
- `PUT /api/questions/:id` - Update question
- `DELETE /api/questions/:id` - Delete question
- `POST /api/questions/import` - Import questions from CSV/JSON
- `GET /api/questions/export` - Export questions as JSON

### Socket.io Events
- `host:create`, `host:start`, `host:next`, `host:reveal`, `host:leaderboard`, `host:end`, `host:pause`, `host:resume`, `host:kick`, `host:restart`
- `player:join` (uses sessionId, not PIN), `player:answer`, `player:reconnect`
- `display:join` (uses sessionId)
- `game:playerJoined`, `game:questionStart`, `game:questionEnd`, `game:reveal`, `game:leaderboard`, `game:end`, `game:streakAlert`, `game:doublePoints`, `game:paused`, `game:resumed`

### Game State Machine
LOBBY -> QUESTION -> REVEAL -> LEADERBOARD -> (repeat) -> END

### Scoring
- Correct: 1000 base + up to 300 speed bonus
- Double points: 1 random question per game (x2 multiplier)
- Speed streak: 3 correct in a row = +500 bonus

### Key Files
- `shared/schema.ts` - All TypeScript types
- `server/gameEngine.ts` - Game state machine and scoring logic
- `server/socketHandler.ts` - Socket.io event handlers
- `server/sampleQuestions.ts` - Built-in sample questions
- `client/src/pages/DisplayScreen.tsx` - Big screen (lobby, question, reveal, leaderboard, end)
- `client/src/pages/PlayerScreen.tsx` - Mobile player interface
- `client/src/pages/HostScreen.tsx` - Host controller
- `client/src/pages/AdminScreen.tsx` - Question CRUD + CSV import
- `client/src/lib/socket.ts` - Socket.io client singleton

### Animations
- Framer Motion: spring/bounce entrance animations on all screens, countdown overlay (3-2-1) before questions, staggered list entries, bouncy feedback icons, whileTap on answer buttons
- CSS: gold-shimmer (animated gradient text), float-anim, pulse-glow utility classes
- canvas-confetti: fires on correct answer reveal (display) and correct feedback (player), continuous confetti on game end
- Timer pulse: countdown number and timer text pulse/scale when ≤5 seconds
- Haptic: navigator.vibrate on answer selection (mobile)

### Dependencies Added
- socket.io, socket.io-client
- qrcode.react
- canvas-confetti, @types/canvas-confetti

### localStorage Keys
- `fawazeer_playerId`, `fawazeer_sessionId` - Player reconnection
- `fawazeer_hostKey`, `fawazeer_hostSession` - Host reconnection
