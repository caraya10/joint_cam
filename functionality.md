# StreamSync Functionality Tracking

This document tracks the core features of the StreamSync (ArayaLogic QuickCam) application and provides a verification plan to ensure stability as new features are added.

## Core Features

### 1. Authentication & User Profile
- **Google Login**: Secure login via Google Identity Services (GSI).
- **Developer Bypass**: Optional dev-only login for local testing.
- **Session Management**: Persistent user sessions using `express-session`.
- **User Dashboard**: Personalized landing page for logged-in users showing their name.

### 2. Dashboard & Asset Management
- **Camera List**: View all active cameras that the user owns or has been shared with.
- **Create Camera**: Start a new named or default-named camera stream.
- **Auto-Sharing**: Automatically share new cameras with a predefined list of user emails.
- **Sharing Management**: Add/view emails for automatic camera sharing.
- **Compact Header**: Integrated user info and logout button on the dashboard.

### 3. Live Streaming (Host Side)
- **P2P Streaming**: Real-time video/audio transmission using WebRTC.
- **Signaling Server**: Coordination via Socket.io.
- **Quick Share**: QR code and URL generation for instant access.
- **Camera Security Keys**: Unique, automatically generated keys for every camera. Both ID and Key are required for connection.
- **Privacy Controls**: Ability to hide/show the local camera preview.
- **Unified Controls**: Easy-to-reach "Stop" button.

### 4. Stream Monitoring (Visitor Side)
- **Direct Access**: Join a stream immediately via a URL parameter (`?r=ID&k=KEY`).
- **Manual Join**: Join a stream by entering a room code in the format `ID:KEY`.
- **Key Enforcement**: The server rejects any connection attempt without a valid matching key.
- **Fullscreen Mode**: Toggle fullscreen for better viewing.
- **Responsive Player**: Remote video scales to fit different screen sizes.

### 5. Quick Connect (Guest Mode)
- **Temporary Streams**: Start a camera or monitor a stream without logging in. Secret keys are automatically generated for these streams as well.

## Regression Testing Plan

| Feature Area | Test Case | Expected Result |
| :--- | :--- | :--- |
| **Auth** | Log in via Dev/Google | Redirects to Dashboard, shows user name. |
| **Auth** | Click Logout | Redirects to Home (landing) view. |
| **Dashboard** | Start New Camera | Navigates to Streaming view, camera appears in list. |
| **Dashboard** | Add Share Email | Email appears in "Share Users" list. |
| **Security** | Join via valid URL | Monitor is joined to the stream correctly. |
| **Security** | Join with invalid Key | Server rejects connection, monitor sees "Invalid camera key". |
| **Security** | Manual ID:KEY join | Monitor is joined to the stream correctly. |
| **Streaming** | Hide Preview | Host's local video becomes transparent/hidden locally. |
| **Monitoring** | Fullscreen | Video expands to fill the browser window. |
| **Networking** | Stop Stream (Host) | Monitor receives "Stream ended" alert and returns home. |
