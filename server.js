const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST']
    }
});

const PORT = process.env.PORT || 3001;

io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);

    socket.on('join-room', ({ roomId, role }) => {
        if (!roomId) return;
        socket.join(roomId);
        socket.data.roomId = roomId;
        socket.data.role = role;
        socket.to(roomId).emit('peer-joined', { socketId: socket.id, role });
    });

    // Cross-device state sync (patients / chats / currentPatientId)
    socket.on('sync-state', ({ roomId, state }) => {
        if (!state) return;
        if (roomId) {
            socket.to(roomId).emit('sync-state', { state, from: socket.id });
        } else {
            socket.broadcast.emit('sync-state', { state, from: socket.id });
        }
    });

    // Direct real-time chat event across devices
    socket.on('chat-message', ({ roomId, patientId, message }) => {
        if (!patientId || !message) return;
        const payload = { patientId, message, from: socket.id };
        if (roomId) {
            socket.to(roomId).emit('chat-message', payload);
        } else {
            socket.broadcast.emit('chat-message', payload);
        }
    });

    socket.on('call-request', ({ roomId, withVideo, callerName }) => {
        if (!roomId) return;
        socket.to(roomId).emit('call-request', { withVideo, callerName, from: socket.id });
    });

    socket.on('call-accepted', ({ roomId, withVideo }) => {
        if (!roomId) return;
        socket.to(roomId).emit('call-accepted', { withVideo, from: socket.id });
    });

    socket.on('call-declined', ({ roomId }) => {
        if (!roomId) return;
        socket.to(roomId).emit('call-declined', { from: socket.id });
    });

    socket.on('webrtc-offer', ({ roomId, offer, withVideo }) => {
        if (!roomId) return;
        socket.to(roomId).emit('webrtc-offer', { offer, withVideo, from: socket.id });
    });

    socket.on('webrtc-answer', ({ roomId, answer }) => {
        if (!roomId) return;
        socket.to(roomId).emit('webrtc-answer', { answer, from: socket.id });
    });

    socket.on('webrtc-ice-candidate', ({ roomId, candidate }) => {
        if (!roomId || !candidate) return;
        socket.to(roomId).emit('webrtc-ice-candidate', { candidate, from: socket.id });
    });

    socket.on('end-call', ({ roomId }) => {
        if (!roomId) return;
        socket.to(roomId).emit('end-call');
    });

    socket.on('disconnect', () => {
        const roomId = socket.data.roomId;
        if (roomId) {
            socket.to(roomId).emit('peer-left', { socketId: socket.id });
        }
        console.log('Client disconnected:', socket.id);
    });
});

server.listen(PORT, () => {
    console.log(`Signaling server running on http://localhost:${PORT}`);
});