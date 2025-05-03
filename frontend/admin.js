// ✅ admin.js — Alpine + DaisyUI Powered Tambola Admin Panel
const socket = io('https://tambola-backend.onrender.com', {
  transports: ['websocket', 'polling']
});

function adminDashboard() {
  return {
    roomId: '',
    called: [],
    players: [],
    ticketRequests: [],
    prizeClaims: [],
    winners: [],
    mode: 'Manual',
    interval: 3,
    ruleTypes: [
      { key: 'Full House', label: 'Full House', enabled: true, max: 1 },
      { key: 'Top Line', label: 'Top Line', enabled: true, max: 1 },
      { key: 'Middle Line', label: 'Middle Line', enabled: true, max: 1 },
      { key: 'Bottom Line', label: 'Bottom Line', enabled: true, max: 1 },
      { key: 'Corners', label: 'Corners', enabled: true, max: 1 }
    ],
    connected: false,

    connect() {
      if (!this.roomId) return alert('Enter Room ID');
      socket.emit('admin-connect', this.roomId);
      this.connected = true;
    },

    start() {
      this.called = [];
      const rules = this.ruleTypes.filter(r => r.enabled).map(r => r.key);
      const limits = Object.fromEntries(this.ruleTypes.map(r => [r.key, r.max]));
      socket.emit('admin-start', {
        roomId: this.roomId,
        mode: this.mode.toLowerCase(),
        interval: this.interval * 1000,
        rules,
        limits
      });
    },

    pause() {
      socket.emit('admin-pause', this.roomId);
    },

    stop() {
      socket.emit('admin-stop', this.roomId);
      this.called = [];
    },

    callNext() {
      socket.emit('admin-call-next', this.roomId);
    },

    toggleNumber(n) {
      if (!this.called.includes(n)) this.called.push(n);
    },

    approveRequest(id) {
      socket.emit('admin-approve-ticket', { roomId: this.roomId, playerId: id });
    },

    approveClaim(id) {
      const claim = this.prizeClaims.find(c => c.id === id);
      if (claim) {
        socket.emit('admin-accept-claim', {
          roomId: this.roomId,
          playerId: claim.playerId,
          claimType: claim.prize
        });
      }
    },

    rejectClaim(id) {
      const claim = this.prizeClaims.find(c => c.id === id);
      if (claim) {
        socket.emit('admin-reject-claim', {
          roomId: this.roomId,
          playerId: claim.playerId,
          claimType: claim.prize
        });
      }
    },

    init() {
      socket.on('number-called', (num) => {
        if (!this.called.includes(num)) this.called.push(num);
      });

      socket.on('update-players', (players) => {
        this.players = players;
      });

      socket.on('update-ticket-requests', (requests) => {
        this.ticketRequests = requests;
      });

      socket.on('update-claims', (claims) => {
        this.prizeClaims = claims.map((c, i) => ({
          id: i + 1,
          playerId: c.playerId,
          player: c.playerName,
          prize: c.claimType
        }));
      });

      socket.on('game-summary', (winners) => {
        this.winners = winners.map(w => ({
          player: w.playerName,
          prize: w.claimType
        }));
      });
    }
  };
}
