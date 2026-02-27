# Fawazeer Seif - فوازير سيف

## Overview
Real-time live quiz web app (Kahoot-like) for the Annual Suhoor event. Features big screen display, mobile player interface, host controller, and question management.

## Tech Stack
- **Frontend**: React + TypeScript + Tailwind CSS + Framer Motion + Wouter
- **Backend**: Express.js + Socket.io
- **Real-time**: Socket.io for WebSocket communication
- **Storage**: In-memory (per session)
- **Theme**: Deep navy + premium gold gradients
- **Fonts**: IBM Plex Sans Arabic + IBM Plex Sans

## Architecture

### Routes
- `/` - Home page with navigation
- `/join` - Player mobile join screen
- `/join?pin=XXXX` - Direct join with PIN
- `/display?pin=XXXX` - Big screen display
- `/host` - Host controller
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
- `player:join`, `player:answer`, `player:reconnect`
- `display:join`
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

### Dependencies Added
- socket.io, socket.io-client
- qrcode.react
- canvas-confetti, @types/canvas-confetti
