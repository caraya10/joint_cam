const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const session = require('express-session');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const { loadData, saveData } = require('./storage');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const DEV_LOGIN = process.env.DEV_LOGIN === 'true';

const testUsers = {
    '1': { id: 'dev_user_1', displayName: 'Dev User One', email: 'dev1@example.com' },
    '2': { id: 'dev_user_2', displayName: 'Dev User Two', email: 'dev2@example.com' }
};

let appData = { users: {}, cameras: {} };

// Load initial data
loadData().then(data => {
    appData = data;
    // Clear stale cameras on startup since they should be ephemeral
    appData.cameras = {};
});

// Auth Strategy
passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID || 'placeholder',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || 'placeholder',
    callbackURL: "/auth/google/callback"
}, (accessToken, refreshToken, profile, done) => {
    const user = {
        id: profile.id,
        displayName: profile.displayName,
        email: profile.emails[0].value
    };
    if (!appData.users[user.id]) {
        appData.users[user.id] = { email: user.email, name: user.displayName, sharingList: [] };
    } else {
        appData.users[user.id].email = user.email;
        appData.users[user.id].name = user.displayName;
    }
    saveData(appData);
    return done(null, user);
}));

passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser((id, done) => {
    const userData = appData.users[id];
    if (userData) {
        done(null, { id, ...userData });
    } else {
        done(null, null);
    }
});

app.use(session({
    secret: process.env.SESSION_SECRET || 'streamsync-default-secret',
    resave: false,
    saveUninitialized: false
}));
app.use(passport.initialize());
app.use(passport.session());
app.use(express.json());

if (DEV_LOGIN) {
    app.get('/auth/dev-login/:id', (req, res) => {
        const user = testUsers[req.params.id];
        if (user) {
            req.login(user, (err) => {
                if (err) return res.status(500).send('Login failed');
                if (!appData.users[user.id]) {
                    appData.users[user.id] = { email: user.email, name: user.displayName, sharingList: [] };
                }
                saveData(appData);
                res.redirect('/');
            });
        } else {
            res.status(404).send('User not found');
        }
    });
}

// Auth Routes
app.get('/auth/google', passport.authenticate('google', { scope: ['profile', 'email'] }));
app.get('/auth/google/callback', passport.authenticate('google', { failureRedirect: '/' }), (req, res) => {
    res.redirect('/');
});
app.get('/logout', (req, res) => {
    req.logout((err) => {
        res.redirect('/');
    });
});

// API Routes
app.get('/api/user', (req, res) => res.json(req.user || null));

app.get('/api/user/sharing', (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    const user = appData.users[req.user.id];
    res.json(user.sharingList || []);
});

app.post('/api/user/sharing', (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email required' });

    const user = appData.users[req.user.id];
    if (!user.sharingList) user.sharingList = [];
    if (!user.sharingList.includes(email)) {
        user.sharingList.push(email);
        saveData(appData);
    }
    res.json(user.sharingList);
});

app.get('/api/cameras', (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

    const userCameras = Object.entries(appData.cameras)
        .filter(([id, cam]) => cam.owner === req.user.id || (cam.sharedWith && cam.sharedWith.includes(req.user.email)))
        .map(([id, cam]) => ({ id, ...cam }));

    res.json(userCameras);
});

app.post('/api/cameras', (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

    let { name } = req.body;
    const user = appData.users[req.user.id];
    const userCameras = Object.values(appData.cameras).filter(c => c.owner === req.user.id);

    if (!name) {
        name = `Camera ${userCameras.length + 1}`;
    }

    // Ensure name is unique for this user
    let finalName = name;
    let counter = 1;
    while (userCameras.some(c => c.name === finalName)) {
        finalName = `${name} (${counter++})`;
    }

    const cameraId = Math.random().toString(36).substring(2, 12);
    appData.cameras[cameraId] = {
        name: finalName,
        owner: req.user.id,
        sharedWith: [...(user.sharingList || [])],
        hostSocketId: null // To be filled on join-room
    };

    // Note: Ephemeral cameras aren't saved to long-term storage (GCS) to stay clean
    // saveData(appData); 
    res.json({ id: cameraId, ...appData.cameras[cameraId] });
});

// Serve config dynamically
app.get('/config.json', (req, res) => {
    res.json({
        HOST_DOMAIN: process.env.HOST_DOMAIN || '',
        IS_DEV_LOGIN: DEV_LOGIN
    });
});

app.use(express.static(path.join(__dirname, 'public')));

// Socket.IO
io.on('connection', (socket) => {

    socket.on('join-room', (roomId, role) => {
        socket.join(roomId);
        console.log(`User ${socket.id} joined room ${roomId} as ${role}`);

        if (role === 'camera') {
            if (appData.cameras[roomId]) {
                appData.cameras[roomId].hostSocketId = socket.id;
                console.log(`Camera ${roomId} is now hosted by ${socket.id}`);
            }
        }

        socket.to(roomId).emit('user-joined', socket.id, role);
    });

    socket.on('offer', (offer, roomId, targetSocketId) => {
        if (targetSocketId) {
            io.to(targetSocketId).emit('offer', offer, socket.id);
        } else {
            socket.to(roomId).emit('offer', offer, socket.id);
        }
    });

    socket.on('answer', (answer, roomId, targetSocketId) => {
        if (targetSocketId) {
            io.to(targetSocketId).emit('answer', answer, socket.id);
        } else {
            socket.to(roomId).emit('answer', answer, socket.id);
        }
    });

    socket.on('ice-candidate', (candidate, roomId, targetSocketId) => {
        if (targetSocketId) {
            io.to(targetSocketId).emit('ice-candidate', candidate, socket.id);
        } else {
            socket.to(roomId).emit('ice-candidate', candidate, socket.id);
        }
    });

    socket.on('stop-stream', (roomId) => {
        const cam = appData.cameras[roomId];
        if (cam && cam.hostSocketId === socket.id) {
            console.log(`Host ${socket.id} stopping stream for room ${roomId}`);
            delete appData.cameras[roomId];
            socket.to(roomId).emit('stream-stopped');
        } else {
            console.log(`Non-host ${socket.id} tried to stop stream for room ${roomId}`);
        }
    });

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);

        // Find and remove any ephemeral cameras hosted by this socket
        for (const [id, cam] of Object.entries(appData.cameras)) {
            if (cam.hostSocketId === socket.id) {
                console.log(`Removing ephemeral camera ${id} due to host disconnect`);
                delete appData.cameras[id];
                io.to(id).emit('stream-stopped');
            }
        }
    });
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
    console.log(`Signaling server running on port ${PORT}`);
});
