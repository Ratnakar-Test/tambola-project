// ✅ admin.js for Tambola Admin Panel (Alpine.js + DaisyUI)
const socket = io("https://tambola-backend.onrender.com", {
  transports: ["websocket"]
});

function adminDashboard() {
  return {
    roomId: "",
    currentTab: "Numbers",
    called: [],
    players: [],
    ticketRequests: [],
    prizeClaims: [],
    winners: [],
    rules: [],
    limits: {},
    mode: "manual",
    interval: 3000,
    showMenu: false,

    init() {
      // Listen for events
      socket.on("update-players", players => this.players = players);
      socket.on("update-ticket-requests", list => this.ticketRequests = list);
      socket.on("update-claims", claims => this.prizeClaims = claims);
      socket.on("game-summary", winners => this.winners = winners);
      socket.on("number-called", num => {
        if (!this.called.includes(num)) this.called.push(num);
      });
    },

    connect() {
      if (!this.roomId) return alert("Enter Room ID");
      socket.emit("admin-connect", this.roomId);
      this.called = [];
      this.showMenu = true;
      this.generateQRCode();
    },

    startGame() {
      if (this.rules.length === 0) return alert("Select at least one rule");
      socket.emit("admin-start", {
        roomId: this.roomId,
        mode: this.mode,
        interval: this.interval,
        rules: this.rules,
        limits: this.limits
      });
      this.called = [];
    },

    pauseGame() {
      socket.emit("admin-pause", this.roomId);
    },

    resumeGame() {
      socket.emit("admin-resume", this.roomId);
    },

    stopGame() {
      socket.emit("admin-stop", this.roomId);
    },

    callNext() {
      socket.emit("admin-call-next", this.roomId);
    },

    isCalled(n) {
      return this.called.includes(n);
    },

    approveTicket(playerId) {
      socket.emit("admin-approve-ticket", { roomId: this.roomId, playerId });
    },

    acceptClaim(playerId, claimType) {
      socket.emit("admin-accept-claim", { roomId: this.roomId, playerId, claimType });
    },

    rejectClaim(playerId, claimType) {
      socket.emit("admin-reject-claim", { roomId: this.roomId, playerId, claimType });
    },

    toggleRule(rule) {
      if (this.rules.includes(rule)) {
        this.rules = this.rules.filter(r => r !== rule);
        delete this.limits[rule];
      } else {
        this.rules.push(rule);
        this.limits[rule] = 1;
      }
    },

    generateQRCode() {
      const canvas = document.getElementById("qrcode");
      if (!canvas) return;
      new QRious({ element: canvas, value: `https://mytambola.netlify.app/index.html?room=${this.roomId}`, size: 200 });
    }
  }
}
