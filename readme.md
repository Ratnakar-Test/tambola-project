# Tambola Project

A real-time, multiplayer Tambola (Bingo/Housie) game built with **Node.js**, **Express**, **Socket.IO** for the backend and **vanilla HTML/JavaScript** with **Tailwind CSS** for the frontend. No database is required; game state is maintained in-memory and tickets are pre-generated.

---

## 🚀 Features

* ✅ **Room Management**: Admins can create or join game rooms.
* 🎫 **Ticket Distribution**: Players can request up to *N* tickets; admin approves or denies requests.
* 📣 **Real-Time Number Calling**: Admin draws random numbers (1–90) via Socket.IO; players and admin see updates instantly.
* 🔔 **Prize Claims**: Players submit claims (Top Line, Two Lines, Full House); admin verifies or rejects.
* 🎯 **Auto-Mark Option**: Players can toggle auto-marking of called numbers on their tickets.
* 🔒 **Room Validation**: Players can only join existing rooms created by an admin.

---

## 🗂 Folder Structure

```
tambola-project/
│
├── backend/                     # Server-side code
│   ├── server.js                # Express + Socket.IO setup
│   ├── ticketStore.js           # In-memory game state management
│   ├── package.json             # Backend dependencies & scripts
│   └── scripts/
│       └── tickets.json         # Pre-generated 500 tickets
│
├── frontend/                    # Static client-side code
│   ├── index.html               # Player UI
│   ├── admin.html               # Admin dashboard
│   ├── app.js                   # Player logic & rendering
│   └── admin.js                 # Admin logic & rendering
│
├── public/                      # (Optional) Static assets
│   └── assets/                  # placeholder for images/CSS
│
└── README.md                    # Project overview & setup instructions
```

---

## 🛠 Tech Stack

* **Backend**: Node.js, Express, Socket.IO, UUID
* **Frontend**: HTML5, CSS (Tailwind), JavaScript
* **Hosting**: Render (backend), Netlify (frontend)

---

## 🔧 Backend Setup (Local)

1. **Prerequisites**: Ensure you have Node.js (v16+) installed.
2. **Install dependencies**:

   ```bash
   cd tambola-project/backend
   npm install
   ```
3. **Run the server**:

   ```bash
   npm run dev    # uses nodemon for hot-reload
   # or
   npm start      # runs server.js
   ```
4. Server listens on port `3000` by default. Override with `PORT` env var.

---

## 🎨 Frontend Setup (Local)

1. No build step required. Open `frontend/index.html` and `frontend/admin.html` in a browser, or serve via a simple HTTP server:

   ```bash
   cd tambola-project/frontend
   npx serve .            # or any static file server
   ```
2. Ensure the backend URL matches in your Socket.IO client script (default is same origin).

---

## 🚢 Deployment

### Backend (Render)

1. Create a new **Web Service** on Render.
2. Connect your GitHub repo branch (`master` or `main`).
3. Set build & start commands:

   ```bash
   npm install
   npm start
   ```
4. Set **Environment Variables**:

   * `PORT`: (optional)
   * `FRONTEND_ORIGIN`: URL of your Netlify frontend (for CORS)
5. Deploy and note the service URL (e.g., `https://tambola-backend.onrender.com`).

### Frontend (Netlify)

1. Create a new **Site** from Git.
2. Link your repo and branch.
3. Set **Build command**: *none* (static files).
4. Set **Publish directory**: `frontend/`.
5. Deploy and note the site URL (e.g., `https://tambola-player.netlify.app`).
6. Update `FRONTEND_ORIGIN` in Render to allow CORS from this URL.

---

## ⚙️ Usage

1. **Admin**:

   * Open `admin.html`, create or join a room, then call numbers and manage tickets/claims.
2. **Player**:

   * Open `index.html`, enter Room ID and name, join the game, request tickets, watch numbers, and claim prizes.

---

## 📄 License

This project is licensed under the MIT License. Feel free to modify and extend for your own use.
