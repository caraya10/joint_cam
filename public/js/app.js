// StreamSync - WebRTC & App Logic

const socket = io();

// STUN Servers for WebRTC NAT Traversal
const peerConnectionConfig = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' }
    ]
};

// State
let peerConnection;
let localStream;
let currentRoomId;
let myRole; // 'camera' or 'monitor'

// DOM Elements
const views = {
    home: document.getElementById('view-home'),
    cameraSetup: document.getElementById('view-camera-setup'),
    streaming: document.getElementById('view-streaming'),
    monitorSetup: document.getElementById('view-monitor-setup'),
    monitoringActive: document.getElementById('view-monitoring-active')
};

const localVideo = document.getElementById('local-video');
const remoteVideo = document.getElementById('remote-video');

// Utility to switch views
function showView(viewName) {
    Object.values(views).forEach(v => {
        v.classList.remove('active');
        setTimeout(() => v.classList.add('hidden'), 200); // fade out duration
    });

    setTimeout(() => {
        views[viewName].classList.remove('hidden');
        // Small delay to allow display block to apply before animating opacity
        setTimeout(() => views[viewName].classList.add('active'), 50);
    }, 200);
}

// Generate random room ID
function generateRoomId() {
    return Math.random().toString(36).substring(2, 10);
}

let configTargetHost = '';

// Check URL on load for room ID (If monitor scanned QR)
window.onload = async () => {
    try {
        const res = await fetch('/config.json');
        const config = await res.json();
        if (config.HOST_DOMAIN) {
            configTargetHost = config.HOST_DOMAIN;
            if (!configTargetHost.startsWith('http')) {
                configTargetHost = `https://${configTargetHost}`;
            }
        }
    } catch (e) {
        console.error("Could not load config", e);
    }

    const urlParams = new URLSearchParams(window.location.search);
    const room = urlParams.get('r');
    if (room) {
        document.getElementById('input-room-id').value = room;
        showView('monitorSetup');
    }
};

/* ================== General WebRTC & Socket Handlers ================== */

socket.on('ice-candidate', (candidate) => {
    if (peerConnection) {
        // Add a delay or check target state before adding
        peerConnection.addIceCandidate(new RTCIceCandidate(candidate)).catch(e => console.error("Error adding ice candidate:", e));
    }
});

socket.on('stream-stopped', () => {
    alert("The stream has ended.");
    stopAndResetApp();
});

/* ================== Camera Flow ================== */

document.getElementById('btn-home-camera').addEventListener('click', async () => {
    myRole = 'camera';
    currentRoomId = generateRoomId();

    try {
        // 1. Get local camera immediately upon user gesture
        localStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'environment' },
            audio: true
        });
        localVideo.srcObject = localStream;
    } catch (err) {
        console.error("Failed to start camera:", err);
        alert("Could not access camera. Please check permissions.");
        return; // Halt flow if camera fails
    }

    showView('cameraSetup');

    // Generate Share URL
    const baseUrl = configTargetHost || window.location.origin;
    const shareUrl = `${baseUrl}?r=${currentRoomId}`;
    document.getElementById('share-url').textContent = shareUrl;

    // Generate QR Code
    document.getElementById('qrcode').innerHTML = ''; // clear previous
    new QRCode(document.getElementById('qrcode'), {
        text: shareUrl,
        width: 200,
        height: 200,
        colorDark: "#000000",
        colorLight: "#ffffff",
        correctLevel: QRCode.CorrectLevel.H
    });

    socket.emit('join-room', currentRoomId, 'camera');
});

// User copied URL
document.getElementById('btn-copy-url').addEventListener('click', () => {
    const text = document.getElementById('share-url').textContent;
    navigator.clipboard.writeText(text).then(() => {
        const btn = document.getElementById('btn-copy-url');
        btn.textContent = 'Copied!';
        setTimeout(() => btn.textContent = 'Copy Link', 2000);
    });
});

// A monitor has joined our room
socket.on('user-joined', async (id, role) => {
    if (myRole === 'camera' && role === 'monitor') {
        console.log("Monitor joined. Starting stream offer.");

        try {
            // 2. Setup Peer Connection
            setupPeerConnection();

            // 3. Add tracks
            localStream.getTracks().forEach(track => {
                peerConnection.addTrack(track, localStream);
            });

            // 4. Create and send offer
            const offer = await peerConnection.createOffer();
            await peerConnection.setLocalDescription(offer);
            socket.emit('offer', offer, currentRoomId);

            // 5. Update UI
            showView('streaming');

        } catch (err) {
            console.error("Failed to establish connection:", err);
            alert("Could not establish peer connection.");
            stopAndResetApp();
        }
    }
});

socket.on('answer', async (answer) => {
    if (myRole === 'camera' && peerConnection) {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
    }
});

/* ================== Monitor Flow ================== */

document.getElementById('btn-home-monitor').addEventListener('click', () => {
    showView('monitorSetup');
});

document.getElementById('btn-join-room').addEventListener('click', () => {
    const roomInput = document.getElementById('input-room-id').value.trim();
    if (!roomInput) return alert("Please enter a stream code.");

    myRole = 'monitor';
    currentRoomId = roomInput;

    socket.emit('join-room', currentRoomId, 'monitor');

    // Disable button to prevent spam
    document.getElementById('btn-join-room').disabled = true;
    document.getElementById('btn-join-room').textContent = 'Waiting for stream...';
});

socket.on('offer', async (offer) => {
    if (myRole === 'monitor') {
        setupPeerConnection();

        await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));

        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);

        socket.emit('answer', answer, currentRoomId);

        showView('monitoringActive');
    }
});

/* ================== Shared WebRTC Methods ================== */

function setupPeerConnection() {
    peerConnection = new RTCPeerConnection(peerConnectionConfig);

    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('ice-candidate', event.candidate, currentRoomId);
        }
    };

    peerConnection.ontrack = (event) => {
        if (myRole === 'monitor') {
            remoteVideo.srcObject = event.streams[0];
        }
    };

    peerConnection.onconnectionstatechange = () => {
        if (peerConnection.connectionState === 'disconnected' || peerConnection.connectionState === 'failed') {
            alert("Connection lost.");
            stopAndResetApp();
        }
    };
}

/* ================== Teardown & Navigation ================== */

function stopAndResetApp() {
    // Stop local media tracks
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }

    // Close WebRTC
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }

    // Tell others
    if (currentRoomId) {
        socket.emit('stop-stream', currentRoomId);
    }

    // Clear UI state
    localVideo.srcObject = null;
    remoteVideo.srcObject = null;
    currentRoomId = null;
    myRole = null;

    // Reset monitor join button
    const joinBtn = document.getElementById('btn-join-room');
    joinBtn.disabled = false;
    joinBtn.textContent = 'Join Stream';

    // Clear URL without reloading
    window.history.replaceState({}, document.title, window.location.pathname);

    showView('home');
}

// Stop Buttons
document.getElementById('btn-stop-streaming').addEventListener('click', stopAndResetApp);
document.getElementById('btn-stop-monitoring').addEventListener('click', stopAndResetApp);

// Cancel Buttons
document.getElementById('btn-cancel-setup').addEventListener('click', stopAndResetApp);
document.getElementById('btn-cancel-monitor').addEventListener('click', stopAndResetApp);

// Fullscreen Button
document.getElementById('btn-fullscreen').addEventListener('click', () => {
    const monitorView = document.getElementById('view-monitoring-active');

    if (!document.fullscreenElement) {
        if (monitorView.requestFullscreen) {
            monitorView.requestFullscreen();
        } else if (monitorView.webkitRequestFullscreen) { /* Safari */
            monitorView.webkitRequestFullscreen();
        } else if (monitorView.msRequestFullscreen) { /* IE11 */
            monitorView.msRequestFullscreen();
        }
        document.getElementById('btn-fullscreen').querySelector('.icon').textContent = '🗗';
    } else {
        if (document.exitFullscreen) {
            document.exitFullscreen();
        } else if (document.webkitExitFullscreen) { /* Safari */
            document.webkitExitFullscreen();
        } else if (document.msExitFullscreen) { /* IE11 */
            document.msExitFullscreen();
        }
        document.getElementById('btn-fullscreen').querySelector('.icon').textContent = '⛶';
    }
});
