require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const session = require('express-session');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const { OAuth2Client } = require('google-auth-library');
const { loadData, saveData } = require('./storage');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

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
        appData.users[user.id] = { email: user.email, name: user.displayName, sharingList: [], theme: 'light' };
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
    saveUninitialized: false,
    cookie: {
        maxAge: 1000 * 60 * 60 * 24 * 30 * 3 // 3 months
    }
}));
app.use(passport.initialize());
app.use(passport.session());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

if (DEV_LOGIN) {
    app.get('/auth/dev-login/:id', (req, res) => {
        const user = testUsers[req.params.id];
        if (user) {
            req.login(user, (err) => {
                if (err) return res.status(500).send('Login failed');
                if (!appData.users[user.id]) {
                    appData.users[user.id] = { email: user.email, name: user.displayName, sharingList: [], theme: 'light' };
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

app.post('/auth/gsi/callback', async (req, res) => {
    const { credential } = req.body;
    if (!credential) {
        return res.status(400).send('No credential provided');
    }

    try {
        const ticket = await client.verifyIdToken({
            idToken: credential,
            audience: process.env.GOOGLE_CLIENT_ID
        });
        const payload = ticket.getPayload();
        
        const user = {
            id: payload.sub,
            displayName: payload.name,
            email: payload.email
        };

        if (!appData.users[user.id]) {
            appData.users[user.id] = { email: user.email, name: user.displayName, sharingList: [], theme: 'light' };
        } else {
            appData.users[user.id].email = user.email;
            appData.users[user.id].name = user.displayName;
        }
        saveData(appData);

        req.login(user, (err) => {
            if (err) return res.status(500).send('Login failed');
            res.redirect('/');
        });
    } catch (e) {
        console.error('GSI verification failed', e);
        res.status(401).send('Invalid credential');
    }
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
    const detailedSharingList = (user.sharingList || []).map(email => {
        const foundUser = Object.values(appData.users).find(u => u.email === email);
        return {
            email: email,
            name: foundUser ? foundUser.name : null
        };
    });
    res.json(detailedSharingList);
});

app.delete('/api/user/sharing', (req, res) => {
    try {
        if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
        const email = (req.body && req.body.email) || req.query.email;
        console.log(`Attempting to remove share: ${email} for user: ${req.user.id}`);
        
        if (!email) return res.status(400).json({ error: 'Email required' });

        const user = appData.users[req.user.id];
        if (!user) {
            console.error(`User ${req.user.id} not found in appData.users`);
            return res.status(404).json({ error: 'User not found' });
        }

        if (user.sharingList) {
            const initialLen = user.sharingList.length;
            user.sharingList = user.sharingList.filter(e => e !== email);
            console.log(`Sharing list reduced from ${initialLen} to ${user.sharingList.length}`);
            saveData(appData);
        }
        res.json({ success: true, sharingList: user.sharingList || [] });
    } catch (err) {
        console.error("Internal error in DELETE /api/user/sharing:", err);
        res.status(500).json({ error: 'Internal Server Error', details: err.message });
    }
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

app.post('/api/user/theme', (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    const { theme } = req.body;
    if (!theme || (theme !== 'light' && theme !== 'dark')) {
        return res.status(400).json({ error: 'Invalid theme' });
    }

    const user = appData.users[req.user.id];
    if (user) {
        user.theme = theme;
        saveData(appData);
        res.json({ success: true, theme: user.theme });
    } else {
        res.status(404).json({ error: 'User not found' });
    }
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
    const cameraKey = Math.random().toString(36).substring(2, 12);
    appData.cameras[cameraId] = {
        name: finalName,
        owner: req.user.id,
        key: cameraKey,
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
        IS_DEV_LOGIN: DEV_LOGIN,
        GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
        GA_MEASUREMENT_ID: process.env.GA_MEASUREMENT_ID
    });
});

app.use(express.static(path.join(__dirname, 'public')));

// Socket.IO
io.on('connection', (socket) => {

    socket.on('join-room', (roomId, role, key) => {
        const cam = appData.cameras[roomId];

        if (cam) {
            // Verify key if camera exists
            if (cam.key !== key) {
                console.log(`Join rejected for room ${roomId}: Invalid key`);
                socket.emit('error', 'Invalid camera key');
                return;
            }
        } else {
            // If camera doesn't exist, only allow 'camera' role to create it (Quick Connect)
            if (role === 'camera') {
                console.log(`Creating ephemeral camera ${roomId} via Quick Connect`);
                appData.cameras[roomId] = {
                    name: `Quick Stream ${roomId}`,
                    owner: 'anonymous',
                    key: key,
                    hostSocketId: socket.id
                };
            } else {
                console.log(`Join rejected for room ${roomId}: Camera does not exist`);
                socket.emit('error', 'Camera not found');
                return;
            }
        }

        socket.join(roomId);
        console.log(`User ${socket.id} joined room ${roomId} as ${role}`);

        if (role === 'camera') {
            appData.cameras[roomId].hostSocketId = socket.id;
            console.log(`Camera ${roomId} is now hosted by ${socket.id}`);
        } else if (role === 'monitor') {
            socket.to(roomId).emit('monitor-joined', socket.id);
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

        // Find any ephemeral cameras hosted by this socket
        for (const [id, cam] of Object.entries(appData.cameras)) {
            if (cam.hostSocketId === socket.id) {
                console.log(`Host ${socket.id} disconnected for camera ${id}. Waiting 10s grace period...`);
                // Use a closure to capture the socket ID and room ID
                const disconnectedSocketId = socket.id;
                const roomId = id;
                
                setTimeout(() => {
                    const currentCam = appData.cameras[roomId];
                    // Only delete if the camera still exists AND the host hasn't changed (reconnected)
                    if (currentCam && currentCam.hostSocketId === disconnectedSocketId) {
                        console.log(`Grace period expired for camera ${roomId}. Removing.`);
                        delete appData.cameras[roomId];
                        io.to(roomId).emit('stream-stopped');
                    } else if (currentCam) {
                        console.log(`Host reconnected for camera ${roomId}. Grace period cancelled.`);
                    }
                }, 10000); // 10 second grace period
            }
        }
    });
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
    console.log(`Signaling server running on port ${PORT}`);
});
