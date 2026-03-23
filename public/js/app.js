// ArayaLogic QuickCam - WebRTC & App Logic

const socket = io();

// Resilience: Re-join room on reconnection
socket.on('connect', () => {
    console.log('Socket connected:', socket.id);
    if (currentRoomId && myRole && currentRoomKey) {
        console.log(`Re-joining room ${currentRoomId} as ${myRole}`);
        socket.emit('join-room', currentRoomId, myRole, currentRoomKey);
    }
});

// Analytics Helper
function trackEvent(name, params = {}) {
    if (typeof gtag === 'function') {
        gtag('event', name, params);
    }
}

// Dynamic Google Analytics Initialization
function initGA(id) {
    if (!id) return;
    
    // 1. Inject gtag.js script
    const script = document.createElement('script');
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${id}`;
    document.head.appendChild(script);

    // 2. Initialize layer
    window.dataLayer = window.dataLayer || [];
    window.gtag = function() { dataLayer.push(arguments); };
    gtag('js', new Date());
    gtag('config', id);
    
    console.log(`Google Analytics initialized with ID: ${id}`);
}

// STUN Servers for WebRTC NAT Traversal
const peerConnectionConfig = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' }
    ]
};

// State
let peerConnections = {}; // Keyed by monitorSocketId
let localStream;
let currentRoomId;
let currentRoomKey;
let myRole; // 'camera' or 'monitor'
let currentUser = null;
let configTargetHost = '';
let dashboardInterval = null;

// DOM Elements
const views = {
    home: document.getElementById('view-home'),
    dashboard: document.getElementById('view-dashboard'),
    streaming: document.getElementById('view-streaming'),
    monitorSetup: document.getElementById('view-monitor-setup'),
    monitoringActive: document.getElementById('view-monitoring-active')
};

const localVideo = document.getElementById('local-video');
const remoteVideo = document.getElementById('remote-video');

// Utility to switch views
function showView(viewName) {
    if (dashboardInterval && viewName !== 'dashboard') {
        clearInterval(dashboardInterval);
        dashboardInterval = null;
    }

    Object.values(views).forEach(v => {
        if (!v) return;
        v.classList.remove('active');
        setTimeout(() => v.classList.add('hidden'), 200);
    });

    setTimeout(() => {
        if (!views[viewName]) return;
        views[viewName].classList.remove('hidden');
        setTimeout(() => views[viewName].classList.add('active'), 50);
    }, 200);
}

// Generate random string for IDs and keys
function generateRandomId() {
    return Math.random().toString(36).substring(2, 12);
}

/* ================== Initialization & Auth ================== */

window.onload = async () => {
    // 1. Load Config
    try {
        const res = await fetch('/config.json');
        const config = await res.json();
        if (config.HOST_DOMAIN) {
            configTargetHost = config.HOST_DOMAIN.startsWith('http') ? config.HOST_DOMAIN : `https://${config.HOST_DOMAIN}`;
        }
        if (config.GA_MEASUREMENT_ID) {
            initGA(config.GA_MEASUREMENT_ID);
        }
    } catch (e) {
        console.error("Could not load config", e);
    }

    // 2. Handle URL params FIRST (to prevent redirect flashes)
    const urlParams = new URLSearchParams(window.location.search);
    const room = urlParams.get('r');
    const key = urlParams.get('k');
    
    // 3. Check Auth
    await checkAuth(!!room); // Pass flag to skip auto-dashboard if room joining

    if (room && key) {
        console.log(`Auto-joining room from URL: ${room}`);
        document.getElementById('input-room-id').value = room;
        joinAsMonitor(room, key, true);
    } else if (room) {
        alert("This camera link is missing a security key.");
    }
};

async function checkAuth(isJoiningRoom = false) {
    try {
        const res = await fetch('/api/user');
        currentUser = await res.json();

        if (currentUser) {
            trackEvent('login', { method: 'google', email: currentUser.email });
        }

        const loggedOutDiv = document.getElementById('auth-logged-out');
        const loggedInDiv = document.getElementById('auth-logged-in');

        // Reuse config if already loaded in window.onload
        const resConfig = await fetch('/config.json');
        const config = await resConfig.json();

        if (currentUser) {
            loggedOutDiv.classList.add('hidden');
            loggedInDiv.classList.remove('hidden');
            document.getElementById('user-display-name').textContent = currentUser.name;
            document.getElementById('dash-user-name').textContent = currentUser.name;

            // Auto-navigate to dashboard if not joining a specific room
            if (!isJoiningRoom) {
                loadDashboard();
            }
        } else {
            loggedOutDiv.classList.remove('hidden');
            loggedInDiv.classList.add('hidden');

            // Initialize GSI if not logged in
            if (config.GOOGLE_CLIENT_ID && window.google) {
                initGSI(config.GOOGLE_CLIENT_ID);
            }

            if (config.IS_DEV_LOGIN) {
                document.getElementById('dev-login-container').classList.remove('hidden');
            }
        }
    } catch (e) {
        console.error("Auth check failed", e);
    }
}

function initGSI(clientId) {
    google.accounts.id.initialize({
        client_id: clientId,
        login_uri: window.location.origin + '/auth/gsi/callback',
        ux_mode: 'redirect'
    });
    google.accounts.id.renderButton(
        document.getElementById('g_id_signin'),
        { theme: 'outline', size: 'large', width: 240 }
    );
}

document.getElementById('btn-login-dev-1')?.addEventListener('click', () => {
    window.location.href = '/auth/dev-login/1';
});

document.getElementById('btn-login-dev-2')?.addEventListener('click', () => {
    window.location.href = '/auth/dev-login/2';
});

document.getElementById('btn-logout').addEventListener('click', () => {
    window.location.href = '/logout';
});

document.getElementById('btn-logout-dash')?.addEventListener('click', () => {
    window.location.href = '/logout';
});

/* ================== Dashboard Flow ================== */

async function loadDashboard() {
    showView('dashboard');
    const list = document.getElementById('camera-list');
    list.innerHTML = '<p class="empty-msg">Loading cameras...</p>';

    await refreshCameraList();

    // Start auto-refresh interval (every 10 seconds)
    if (!dashboardInterval) {
        dashboardInterval = setInterval(refreshCameraList, 10000);
    }
}

async function refreshCameraList() {
    const list = document.getElementById('camera-list');

    try {
        const resCams = await fetch('/api/cameras');
        const cameras = await resCams.json();

        if (cameras.length === 0) {
            list.innerHTML = '<p class="empty-msg">No active cameras found. Start one to see it here!</p>';
        } else {
            list.innerHTML = '';
            cameras.forEach(cam => {
                const item = document.createElement('div');
                item.className = 'camera-item';
                const isOwner = cam.owner === currentUser.id;

                item.innerHTML = `
                    <div class="camera-info">
                        <h4>${cam.name}</h4>
                        <div class="owner-info">${isOwner ? 'Your Camera' : 'Shared with you'}</div>
                    </div>
                    <div class="camera-actions">
                        <button class="btn btn-sm btn-primary btn-monitor" data-id="${cam.id}" data-key="${cam.key}">Monitor</button>
                    </div>
                `;
                list.appendChild(item);
            });

            // Add event listeners
            list.querySelectorAll('.btn-monitor').forEach(btn => {
                btn.addEventListener('click', () => {
                    const id = btn.getAttribute('data-id');
                    const key = btn.getAttribute('data-key');
                    joinAsMonitor(id, key, true);
                });
            });
        }

        // Load Sharing List (only if first time or minimal refresh)
        const resSharing = await fetch('/api/user/sharing');
        const sharingList = await resSharing.json();
        const sharingContainer = document.getElementById('sharing-list');
        if (sharingContainer) {
            sharingContainer.innerHTML = '';
            if (sharingList.length === 0) {
                sharingContainer.innerHTML = '<p class="empty-msg-sm">No users shared yet.</p>';
            } else {
                sharingList.forEach(user => {
                    const item = document.createElement('div');
                    item.className = 'sharing-item';
                    const userName = user.name || 'Unknown User';

                    item.innerHTML = `
                        <div class="sharing-info">
                            <h4>${user.email}</h4>
                        </div>
                        <div class="sharing-actions">
                            <button class="btn btn-sm btn-outline btn-danger btn-remove-share" data-email="${user.email}">Remove</button>
                        </div>
                    `;
                    sharingContainer.appendChild(item);
                });

                // Add event listeners for removal
                sharingContainer.querySelectorAll('.btn-remove-share').forEach(btn => {
                    btn.addEventListener('click', async (e) => {
                        const email = btn.getAttribute('data-email');
                        // Use a non-blocking confirmation or just proceed for better UX in this simple app
                        try {
                            const res = await fetch(`/api/user/sharing?email=${encodeURIComponent(email)}`, {
                                method: 'DELETE'
                            });
                            if (res.ok) {
                                refreshCameraList(); // Refresh the list
                            } else {
                                console.error("Failed to remove sharing email", res.status);
                            }
                        } catch (err) {
                            console.error("Failed to remove sharing email", err);
                        }
                    });
                });
            }
        }

    } catch (e) {
        console.error("Failed to refresh camera list", e);
    }
}

document.getElementById('btn-new-camera').addEventListener('click', async () => {
    const nameInput = document.getElementById('input-new-camera-name');
    const name = nameInput.value.trim();

    try {
        const res = await fetch('/api/cameras', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name })
        });
        if (res.ok) {
            const newCam = await res.json();
            nameInput.value = '';
            // Immediately start hosting the new camera
            startCameraStream(newCam.id, newCam.key, true);
        }
    } catch (e) {
        console.error("Failed to create camera", e);
    }
});

document.getElementById('btn-add-share-email').addEventListener('click', async () => {
    const emailInput = document.getElementById('input-new-share-email');
    const email = emailInput.value.trim();
    if (!email) return;

    try {
        const res = await fetch('/api/user/sharing', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email })
        });
        if (res.ok) {
            emailInput.value = '';
            refreshCameraList();
        }
    } catch (e) {
        console.error("Failed to add sharing email", e);
    }
});

/* ================== General Handlers ================== */

socket.on('ice-candidate', (candidate, fromId) => {
    const pc = peerConnections[fromId];
    if (pc) {
        pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(e => console.error("Error adding ice candidate:", e));
    }
});

socket.on('stream-stopped', () => {
    alert("The stream has ended.");
    stopAndResetApp();
});

/* ================== Camera Flow ================== */

document.getElementById('btn-home-camera').addEventListener('click', () => startCameraStream());

async function startCameraStream(roomId, key, immediate = false) {
    myRole = 'camera';
    currentRoomId = roomId || generateRandomId();
    currentRoomKey = key || generateRandomId();

    try {
        localStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'environment' },
            audio: true
        });
        localVideo.srcObject = localStream;
    } catch (err) {
        console.error("Failed to start camera:", err);
        alert("Could not access camera.");
        return;
    }

    // Clear dashboard interval if hosting
    if (dashboardInterval) {
        clearInterval(dashboardInterval);
        dashboardInterval = null;
    }

    // Unified: Go straight to streaming view
    showView('streaming');
    trackEvent('camera_start', { room_id: currentRoomId, camera_name: roomId }); // roomId is name if created via dashboard

    const baseUrl = configTargetHost || window.location.origin;
    const shareUrl = `${baseUrl}?r=${currentRoomId}&k=${currentRoomKey}`;

    // Render QR and Link in streaming card
    document.getElementById('share-url-streaming').textContent = shareUrl;
    document.getElementById('qrcode-streaming').innerHTML = '';
    new QRCode(document.getElementById('qrcode-streaming'), {
        text: shareUrl, width: 140, height: 140, colorDark: "#000000", colorLight: "#ffffff", correctLevel: QRCode.CorrectLevel.H
    });

    socket.emit('join-room', currentRoomId, 'camera', currentRoomKey);
}

socket.on('user-joined', async (monitorId, role) => {
    if (myRole === 'camera' && role === 'monitor') {
        console.log(`Monitor ${monitorId} joined. Starting stream offer.`);

        try {
            const pc = setupPeerConnection(monitorId);
            peerConnections[monitorId] = pc;

            localStream.getTracks().forEach(track => {
                pc.addTrack(track, localStream);
            });

            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            socket.emit('offer', offer, currentRoomId, monitorId);
        } catch (err) {
            console.error("ArayaLogic QuickCam: Socket connection error", err);
        }
    }
});

socket.on('answer', async (answer, fromId) => {
    const pc = peerConnections[fromId];
    if (myRole === 'camera' && pc) {
        await pc.setRemoteDescription(new RTCSessionDescription(answer));
    }
});

/* ================== Monitor Flow ================== */

document.getElementById('btn-join-room').addEventListener('click', () => {
    const roomInput = document.getElementById('input-room-id').value.trim();
    if (!roomInput) return alert("Please enter a stream code.");
    // Manual join from home page doesn't have a key unless pasted in room field? 
    // Actually, normally people use the URL. If they use the field, we'd need a key field too.
    // Let's assume the ID field could contain "ID:KEY" or just "ID" (and warn).
    if (roomInput.includes(':')) {
        const [id, key] = roomInput.split(':');
        joinAsMonitor(id, key, true);
    } else {
        alert("Stream code requires a key (format ID:KEY) or use the full sharing URL.");
    }
});

function joinAsMonitor(roomId, key, immediate = false) {
    myRole = 'monitor';
    currentRoomId = roomId;
    currentRoomKey = key;

    if (dashboardInterval) {
        clearInterval(dashboardInterval);
        dashboardInterval = null;
    }

    if (immediate) {
        showView('monitoringActive');
    }

    const emitJoin = () => {
        console.log(`Emitting join-room for ${currentRoomId}`);
        socket.emit('join-room', currentRoomId, 'monitor', currentRoomKey);
        trackEvent('monitor_join', { room_id: currentRoomId });
    };

    if (socket.connected) {
        emitJoin();
    } else {
        socket.once('connect', emitJoin);
    }

    const joinBtn = document.getElementById('btn-join-room');
    if (joinBtn) {
        joinBtn.disabled = true;
        joinBtn.textContent = 'Waiting for stream...';
    }
}

socket.on('offer', async (offer, cameraSocketId) => {
    if (myRole === 'monitor') {
        const pc = setupPeerConnection(cameraSocketId);
        peerConnections[cameraSocketId] = pc;

        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        socket.emit('answer', answer, currentRoomId, cameraSocketId);
        showView('monitoringActive'); // Switch if not already there
    }
});

socket.on('error', (msg) => {
    alert(`Error: ${msg}`);
    stopAndResetApp();
});

/* ================== Shared WebRTC Methods ================== */

function setupPeerConnection(targetId) {
    const pc = new RTCPeerConnection(peerConnectionConfig);

    pc.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('ice-candidate', event.candidate, currentRoomId, targetId);
        }
    };

    pc.ontrack = (event) => {
        if (myRole === 'monitor') {
            remoteVideo.srcObject = event.streams[0];
            // Ensure video plays and show a brief unmute prompt
            remoteVideo.play().catch(err => console.warn("Autoplay failed:", err));
            
            // Show unmute button if currently muted
            document.getElementById('btn-unmute').classList.remove('hidden');
            remoteVideo.muted = true; 
        }
    };

    pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
            if (myRole === 'camera') {
                console.log(`Monitor ${targetId} disconnected.`);
                pc.close();
                delete peerConnections[targetId];
            } else {
                console.log("Connection lost, attempting to reset.");
                stopAndResetApp();
            }
        }
    };

    return pc;
}

/* ================== Teardown & Navigation ================== */

function stopAndResetApp() {
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }

    Object.values(peerConnections).forEach(pc => pc.close());
    peerConnections = {};

    if (currentRoomId && myRole === 'camera') {
        socket.emit('stop-stream', currentRoomId);
    }

    if (dashboardInterval) {
        clearInterval(dashboardInterval);
        dashboardInterval = null;
    }

    const preview = document.querySelector('.camera-preview');
    if (preview) preview.style.opacity = '1';
    localVideo.srcObject = null;
    remoteVideo.srcObject = null;
    
    if (myRole) {
        trackEvent('session_stop', { role: myRole, room_id: currentRoomId });
    }

    currentRoomId = null;
    currentRoomKey = null;
    myRole = null;

    const joinBtn = document.getElementById('btn-join-room');
    if (joinBtn) {
        joinBtn.disabled = false;
        joinBtn.textContent = 'Join Stream';
    }

    // Reset mute state
    remoteVideo.muted = true;

    window.history.replaceState({}, document.title, window.location.pathname);
    if (currentUser) {
        loadDashboard();
    } else {
        showView('home');
    }
}

document.getElementById('btn-stop-streaming').addEventListener('click', stopAndResetApp);
document.getElementById('btn-stop-monitoring').addEventListener('click', stopAndResetApp);
document.getElementById('btn-cancel-monitor').addEventListener('click', stopAndResetApp);

document.getElementById('btn-unmute').addEventListener('click', () => {
    remoteVideo.muted = false;
    document.getElementById('btn-unmute').classList.add('hidden');
});

document.getElementById('btn-toggle-camera-view').addEventListener('click', () => {
    const previewContainer = document.querySelector('.camera-preview');
    const toggleBtn = document.getElementById('btn-toggle-camera-view');

    const currentOpacity = window.getComputedStyle(previewContainer).opacity;

    if (currentOpacity === '0') {
        previewContainer.style.opacity = '1';
        toggleBtn.querySelector('.svg-eye-open').style.display = 'block';
        toggleBtn.querySelector('.svg-eye-closed').style.display = 'none';
        toggleBtn.querySelector('.text').textContent = 'Hide Preview';
    } else {
        previewContainer.style.opacity = '0';
        toggleBtn.querySelector('.svg-eye-open').style.display = 'none';
        toggleBtn.querySelector('.svg-eye-closed').style.display = 'block';
        toggleBtn.querySelector('.text').textContent = 'Show Preview';
    }
});

document.getElementById('btn-fullscreen').addEventListener('click', () => {
    const monitorView = document.getElementById('view-monitoring-active');
    if (!document.fullscreenElement) {
        if (monitorView.requestFullscreen) monitorView.requestFullscreen();
        document.getElementById('btn-fullscreen').querySelector('.svg-enter').style.display = 'none';
        document.getElementById('btn-fullscreen').querySelector('.svg-exit').style.display = 'block';
    } else {
        if (document.exitFullscreen) document.exitFullscreen();
        document.getElementById('btn-fullscreen').querySelector('.svg-enter').style.display = 'block';
        document.getElementById('btn-fullscreen').querySelector('.svg-exit').style.display = 'none';
    }
});

document.getElementById('btn-copy-url-streaming').addEventListener('click', () => {
    const url = document.getElementById('share-url-streaming').textContent;
    navigator.clipboard.writeText(url).then(() => {
        const btn = document.getElementById('btn-copy-url-streaming');
        const originalText = btn.textContent;
        btn.textContent = 'Copied!';
        setTimeout(() => btn.textContent = originalText, 2000);
    });
});
