const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Serve config dynamically so frontend knows about env vars
app.get('/config.json', (req, res) => {
    res.json({
        HOST_DOMAIN: process.env.HOST_DOMAIN || ''
    });
});

// Serve static files from the public directory
app.use(express.static(path.join(__dirname, 'public')));

// Handle Socket.IO connections
io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);

    // Join a specific room based on the randomly generated roomId
    socket.on('join-room', (roomId, role) => {
        socket.join(roomId);
        console.log(`User ${socket.id} joined room ${roomId} as ${role}`);

        // Notify others in the room
        socket.to(roomId).emit('user-joined', socket.id, role);
    });

    // Handle WebRTC Offer
    socket.on('offer', (offer, roomId) => {
        // Broadcast the offer to anyone else in the room (the monitor)
        socket.to(roomId).emit('offer', offer);
    });

    // Handle WebRTC Answer
    socket.on('answer', (answer, roomId) => {
        // Broadcast the answer back to the camera
        socket.to(roomId).emit('answer', answer);
    });

    // Handle WebRTC ICE Candidates
    socket.on('ice-candidate', (candidate, roomId) => {
        // Broadcast the candidate to others in the room
        socket.to(roomId).emit('ice-candidate', candidate);
    });

    // Handle when a peer disconnects / stops streaming
    socket.on('stop-stream', (roomId) => {
        console.log(`Stream stopped in room ${roomId}`);
        socket.to(roomId).emit('stream-stopped');
    });

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        // We could handle cleaning up rooms here if needed
    });
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
    console.log(`Signaling server running on port ${PORT}`);
});
