const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*" },
    transports: ['websocket', 'polling']
});

const rooms = {};
const MAX_SPEED = 10; // 最高速度は10でロック

io.on('connection', (socket) => {

    // 1. 部屋を作る
    socket.on('createRoom', (data) => {
        const code = Math.floor(1000 + Math.random() * 9000).toString();
        rooms[code] = {
            code: code,
            maxScore: parseInt(data.maxScore) || 5,
            ballCount: parseInt(data.ballCount) || 1,
            gameState: 'READY',
            p1: { id: socket.id, name: data.name, y: 160, ready: false },
            p2: null,
            score: { p1: 0, p2: 0 },
            balls: [],
            intervalId: null
        };
        socket.roomCode = code;
        socket.join(code);
        socket.emit('roomCreated', { code: code });
    });

    // 2. 部屋に入る
    socket.on('joinRoom', (data) => {
        const code = data.code;
        const room = rooms[code];

        if (!room) {
            socket.emit('roomError', "部屋が見つかりません。コードを確認してください。");
            return;
        }
        if (room.p2) {
            socket.emit('roomError', "この部屋は満員です。");
            return;
        }

        room.p2 = { id: socket.id, name: data.name, y: 160, ready: false };
        socket.roomCode = code;
        socket.join(code);

        socket.emit('roomJoined', { code: code });
        io.to(code).emit('roomReady', { p1Name: room.p1.name, p2Name: room.p2.name });
    });

    // 3. 準備完了
    socket.on('playerReady', () => {
        const room = rooms[socket.roomCode];
        if (!room) return;

        if (socket.id === room.p1.id) room.p1.ready = true;
        if (room.p2 && socket.id === room.p2.id) room.p2.ready = true;

        if (room.p1.ready && room.p2 && room.p2.ready && room.gameState !== 'PLAYING') {
            room.gameState = 'PLAYING';
            initRoomBalls(room);
            io.to(socket.roomCode).emit('gameStarted');
            
            if (!room.intervalId) {
                room.intervalId = setInterval(() => updateRoomGame(room), 1000 / 60);
            }
        }
    });

    // 4. パドル同期
    socket.on('paddleMove', (data) => {
        const room = rooms[socket.roomCode];
        if (!room) return;
        if (socket.id === room.p1.id) room.p1.y = data.y;
        if (room.p2 && socket.id === room.p2.id) room.p2.y = data.y;
    });

    // 5. 切断・退出
    const handleLeave = () => {
        const code = socket.roomCode;
        const room = rooms[code];
        if (room) {
            clearInterval(room.intervalId);
            io.to(code).emit('opponentLeft', "対戦相手が切断したため、ロビーに戻ります。");
            delete rooms[code];
        }
    };
    socket.on('leaveRoom', handleLeave);
    socket.on('disconnect', handleLeave);
});

// ボール初期化（必ずスピード5から開始、最初から少し上下角をつける）
function initRoomBalls(room) {
    room.balls = [];
    for (let i = 0; i < room.ballCount; i++) {
        const isLeft = Math.random() > 0.5;
        // 初期角度を真横ではなく上下20度以内のランダムにする
        const angle = (isLeft ? Math.PI : 0) + (Math.random() - 0.5) * 0.35;
        const speed = 5; 
        room.balls.push({ x: 300, y: 200, dx: Math.cos(angle) * speed, dy: Math.sin(angle) * speed, active: true });
    }
}

// オンライン物理演算（角度シミュレーション版）
function updateRoomGame(room) {
    if (room.gameState !== 'PLAYING') return;

    let activeCount = 0;
    room.balls.forEach(b => {
        if (!b.active) return;
        activeCount++;

        b.x += b.dx; b.y += b.dy;

        // 壁反射
        if (b.y < 0) { b.y = 0; b.dy *= -1; }
        if (b.y > 390) { b.y = 390; b.dy *= -1; }

        let hit = false;
        let paddleY = 0;
        let isLeftPaddle = true;

        // 左パドル判定
        if (b.x >= 10 && b.x <= 20 && b.dx < 0) {
            if (b.y >= room.p1.y - 10 && b.y <= room.p1.y + 80) {
                hit = true; paddleY = room.p1.y; isLeftPaddle = true;
                b.x = 21; // めり込み防止
            }
        }
        // 右パドル判定
        if (room.p2 && b.x >= 570 && b.x <= 580 && b.dx > 0) {
            if (b.y >= room.p2.y - 10 && b.y <= room.p2.y + 80) {
                hit = true; paddleY = room.p2.y; isLeftPaddle = false;
                b.x = 569; // めり込み防止
            }
        }

        // 跳ね返り処理（スピード可変 5 → 10 ＆ 10%で明後日の方向）
        if (hit) {
            let currentSpeed = Math.sqrt(b.dx * b.dx + b.dy * b.dy);
            let nextSpeed = Math.min(MAX_SPEED, currentSpeed + 0.6); // 当たるたびに+0.6ずつ加速

            let angle = 0;
            if (Math.random() < 0.10) {
                // 【10%の確率】明後日の方向（60度〜75度の超急角度で大暴走）
                let sign = Math.random() > 0.5 ? 1 : -1;
                let crazyAngle = sign * (Math.PI / 3 + Math.random() * (Math.PI / 12));
                angle = isLeftPaddle ? crazyAngle : Math.PI - crazyAngle;
            } else {
                // 【90%の通常反射】パドルの中心からの距離で打ち分ける（平坦化を防止！）
                let relativeY = (b.y + 5) - (paddleY + 40); // パドル中心からのズレ
                let normalizedHit = Math.max(-1, Math.min(1, relativeY / 40)); 
                let bounceAngle = normalizedHit * (Math.PI / 4); // 最大45度の角度をつける
                angle = isLeftPaddle ? bounceAngle : Math.PI - bounceAngle;
            }

            b.dx = Math.cos(angle) * nextSpeed;
            b.dy = Math.sin(angle) * nextSpeed;
        }

        if (b.x < -10) { room.score.p2++; b.active = false; }
        if (b.x > 610) { room.score.p1++; b.active = false; }
    });

    if (activeCount === 0) {
        if (room.score.p1 < room.maxScore && room.score.p2 < room.maxScore) {
            room.gameState = 'READY';
            room.p1.ready = false;
            if (room.p2) room.p2.ready = false;
            io.to(room.code).emit('roundCleared', { score: room.score });
            return; 
        } else {
            room.gameState = 'STOPPED';
            clearInterval(room.intervalId);
            const winner = room.score.p1 > room.score.p2 ? room.p1.name : room.p2.name;
            io.to(room.code).emit('matchResult', { winner: winner });
            return;
        }
    }

    io.to(room.code).emit('gameState', {
        balls: room.balls,
        score: room.score,
        p1Y: room.p1.y,
        p2Y: room.p2 ? room.p2.y : 160,
        gameState: room.gameState
    });
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
