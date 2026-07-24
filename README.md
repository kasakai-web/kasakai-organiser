# Kasa Kai — Organiser Portal

Dashboard for game organisers on the Kasa Kai football platform. Organisers create and manage games, track registrations in real time, approve waitlists, record attendance, rate players, and view financial summaries.

> **Port:** `3001`  
> **Audience:** Organisers

---

## Table of Contents

- [Tech Stack](#tech-stack)
- [Features](#features)
- [Architecture](#architecture)
- [Directory Structure](#directory-structure)
- [Environment Variables](#environment-variables)
- [Getting Started](#getting-started)
- [Key Screens & Routes](#key-screens--routes)
- [Authentication Flow](#authentication-flow)
- [Real-Time Updates](#real-time-updates)
- [Game Management Workflow](#game-management-workflow)
- [Deployment](#deployment)

---

## Tech Stack

| Layer | Technology | Version |
|---|---|---|
| Framework | Next.js (App Router) | 16.2 |
| UI library | React | 19.2 |
| Language | TypeScript | 5 |
| Styling | Tailwind CSS | 4 · custom CSS modules |
| Real-time | Socket.io client | 4.8 |
| Linter | ESLint + eslint-config-next | 9 / 16.2 |

---

## Features

### Game management
- Create games (title, turf, date/time, format, total slots, fee, minimum players, cutoff)
- Edit all game settings before and after opening for registration
- Open, confirm, and complete a game through its full lifecycle
- Cancel a game — triggers automatic refunds to all registered players

### Confirmation algorithm (auto-pilot) — spec §3.1–3.3
- **Confirmation check-ins** at game creation: two editable times that auto-default by kickoff
  (morning game → 8 PM & 10 PM the day before; evening → 2 PM & 4 PM on game day). Date is derived; you edit only the times.
- **Alternate format** — define a smaller fallback format (format/turf/min/max; fee = main fee). Used when the main format can't fill.
- **Automation toggle** — ON: the second check-in auto-confirms (main/alternate) or auto-cancels + refunds. OFF: you're notified to decide.
- **Switch** button — switch to the alternate format now (players who said "No" to format changes at signup are opted out + refunded).
- **SOS** button — invite the venue's regulars (rule-based: top 10 who played there at that time, >5 of last 15 games — never everyone).
- **Dashboard pop-up** (`LifecycleAlertModal`) — appears for the 30-min reminder and any pending decision, with Confirm / Switch / SOS / Cancel / Keep Waiting actions.
- Backend engine + full reference: `kasakai-backend/docs/PART3_LIFECYCLE_HANDOFF.md`.

### Registration management (real-time)
- View all registered players and guests with position and team preference
- Live slot counter — updates instantly via Socket.io when any player joins or leaves
- Add players manually (no payment deducted)
- Add organiser guests (occupies a slot)
- Remove any registration (player or guest) — triggers refund
- Approve waitlisted players

### Organiser participation
- Toggle `organiserIsPlaying` — occupies one slot when enabled; blocked if game is already full
- Add and remove organiser's own guests

### Post-game
- Record per-player attendance (present / absent)
- **Rate individual players** — conduct, gameplay, GK affinity, preferred position, play-with / play-against. Stars start **unrated** (no pre-filled default); only players the organiser actually rates (valid 1–5 for both conduct & gameplay) are saved — no fake `3` is ever stored
- View all player feedback submitted for the game
- View aggregated organiser rating summary

### Team distribution
- **Auto-distribute balanced teams** from a game's attended players
- Skill is the player's **average gameplay rating only** (conduct is not used); GK affinity, position, and play-with/against preferences also factor in
- No default values — unrated players and guests contribute 0 skill / 0 GK; config is read fresh each run (changing a rating reflects immediately)
- **Copy List** produces a shareable game summary with a readable registration link (`/join/<name>-<date>-<id>`)

### Finance
- Per-game financial summary (registrations, revenue, refunds)
- Cross-game financial overview

### Notifications
- Real-time notification bell with unread badge
- Notifications for: new player registered, player backed out, waitlist activity

---

## Architecture

```
organiser-portal/
└── src/
    ├── app/                             # Next.js 16 App Router
    │   ├── layout.tsx                   # Root layout — includes SocketClient
    │   ├── SocketClient.tsx             # Socket.io connection; relays events as DOM CustomEvents
    │   ├── page.tsx                     # Landing / redirect page
    │   ├── login/                       # Organiser login
    │   └── dashboard/
    │       └── organizer/[id]/          # Main organiser dashboard
    │           └── page.tsx             # Event cards, modals, stats
    ├── components/
    │   ├── auth/                        # Login form, password reset
    │   ├── dashboard/
    │   │   ├── EditEventModal.tsx       # Full game editor + real-time participant panel
    │   │   ├── CreateEventModal.tsx     # New game creation form
    │   │   ├── OrganizerEventCard.tsx   # Game card on the dashboard grid
    │   │   └── PlayerDetailsModal.tsx   # Player list with remove/approve actions
    │   ├── notifications/               # NotificationBell
    │   └── ui/                          # Shared: ConfirmationModal, Toast
    ├── hooks/
    │   ├── useAuthGuard.ts              # JWT + role check; redirects to login if invalid
    │   └── useAutoRefresh.ts            # Poll + focus + visibility refresh
    └── utils/
        └── api.ts                       # buildApiUrl(), getSession(), clearSession()
```

---

## Directory Structure (key files)

```
src/app/dashboard/organizer/[id]/
└── page.tsx              # Dashboard shell — fetches games, manages all modal state

src/components/dashboard/
├── EditEventModal.tsx    # Primary work surface:
│                         #   - Edit game details (Save button)
│                         #   - Toggle organiserIsPlaying (instant, no Save needed)
│                         #   - Add / remove organiser guests (instant)
│                         #   - View real-time player list
│                         #   - Approve waitlisted players
│                         #   - Live capacity bar (green / red / orange for over-cap)
├── CreateEventModal.tsx  # Create new game
├── OrganizerEventCard.tsx
└── PlayerDetailsModal.tsx
```

---

## Environment Variables

Create `organiser-portal/.env.local`:

```env
NEXT_PUBLIC_API_BASE_URL=http://localhost:5000/api/v1
```

In production:

```env
NEXT_PUBLIC_API_BASE_URL=https://api.kasakai.in/api/v1
```

---

## Getting Started

### Prerequisites

- Node.js >= 18
- Backend server running on port 5000 (see `kasakai-backend/README.md`)

### Install

```bash
cd organiser-portal
npm install
```

### Run in development

```bash
npm run dev      # Hardcoded to port 3001 — always runs on http://localhost:3001
```

### Build for production

```bash
npm run build
npm start
```

### Lint

```bash
npm run lint
```

---

## Key Screens & Routes

| Route | Description |
|---|---|
| `/` | Redirect to login or dashboard |
| `/login` | Organiser login |
| `/dashboard/organizer/[id]` | Main dashboard — event cards, stats, create/edit game modals |

All meaningful interaction happens inside modals on the dashboard page:
- **Create Event Modal** — new game form
- **Edit Event Modal** — full game editor with live participant panel
- **Player Details Modal** — full registration list with remove and approve actions

---

## Authentication Flow

### Login

1. Enter registered email and password
2. JWT returned → stored in `localStorage` as `authToken`

### Auth guard

Every protected page includes `useAuthGuard({ requiredRole: "organiser", routeUserId: id })`:
- Reads JWT from `localStorage`
- Validates expiry and role (must be `"organiser"`)
- Redirects to `/login` if invalid, expired, or wrong role
- Redirects if the `routeUserId` in the URL doesn't match the JWT subject

### Logout

`clearSession()` removes `authToken` from localStorage and dispatches `kk-auth-changed` so the socket disconnects immediately.

---

## Real-Time Updates

`app/SocketClient.tsx` maintains one Socket.io connection per browser tab:

| Server event | DOM event dispatched | Effect on dashboard |
|---|---|---|
| `new-notification` | `kk-new-notification` | NotificationBell badge increments; dashboard re-fetches silently |
| `game-update` | `kk-game-update` | `spotsRemaining` + `totalSlots` patched in game state immediately — card counts update without a full re-fetch |

The **Edit Event Modal** also performs instant API calls (no Save button needed) for:
- `organiserIsPlaying` toggle — `PATCH /api/v1/games/organisers/:id`
- Add organiser guest — `POST /api/v1/games/organisers/:id/add-guest`
- Remove organiser guest — `DELETE /api/v1/games/organisers/:id/registrations/:regId`

The parent dashboard is notified via the `onParticipationChange` prop so it silently re-fetches after each real-time change.

---

## Game Management Workflow

### Creating a game

1. Click **+ Create Event** on the dashboard
2. Fill in: title, turf, date, time, format, total slots, fee, minimum players, cutoff time, duration, reporting time
3. (Optional) Enable **Format Change** to define an alternate format, set the two **Confirmation Check-in** times, and toggle **automation**
4. Submit → game created in `open` status (immediately open for registration)

### Managing registrations

1. Click any event card to open the **Edit Event Modal**
2. The **Participants** panel shows:
   - Live slot bar (green = slots available, red = full, orange = over-capacity)
   - All registered players and guests
   - Organiser participation toggle and guest controls
3. To remove a player or guest: click Remove in the player list (triggers refund)
4. To approve a waitlisted player: click Approve in the waitlist section

### After the game

1. Open the **Player Details Modal** → record attendance (present / absent)
2. Rate each player (optional)
3. View and respond to player feedback via the Edit Event Modal

### Cancelling a game

1. Open Edit Event Modal → scroll to Danger Zone → Cancel Game
2. Enter a cancellation message
3. All players receive refunds automatically

---

## Deployment

### Environment (production)

```env
NEXT_PUBLIC_API_BASE_URL=https://api.kasakai.in/api/v1
```

### Build

```bash
npm run build
npm start
```

### Port

The dev server is hardcoded to port `3001` in `package.json`. The production `npm start` uses Next.js default (usually `3000` unless `PORT` env var is set — set it to `3001` in your hosting config).

### CORS

The production backend `CORS_ORIGIN` must include the deployed organiser portal URL, e.g. `https://organiser.kasakai.in`.