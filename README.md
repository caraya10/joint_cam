# StreamSync - WebRTC Video Streamer

A simple WebRTC mobile-first web app that allows one device to stream video directly to another over a peer-to-peer connection.

## Prerequisites
- Node.js installed on your machine.
- A camera (webcam on desktop or phone camera).

## How to Test Locally

Because of modern browser security policies, WebRTC (specifically the `getUserMedia` API that accesses the camera) **requires a secure context (HTTPS)**. The only exception to this rule is `localhost`. 

If you want to test the app between your computer and your phone, you cannot simply use your local network IP (e.g., `http://192.168.1.5:8080`) because your phone's browser will block camera access since it's not HTTPS.

Here are the two ways to test it:

### Method 1: Testing on a single computer (Localhost)
This is the easiest way to verify the UI and logic works, though it won't test the mobile-to-mobile experience.

1. Open your terminal in this directory (`webrtc-streamer`).
2. Run `npm install` (if you haven't already).
3. Start the server:
   ```bash
   node server.js
   ```
4. Open your computer's web browser and go to `http://localhost:8080`.
5. Click **"Host a Camera"**.
6. Open a *new incoming tab or incognito window* and copy-paste the URL shown next to the QR code (e.g., `http://localhost:8080?r=abc123xy`).
7. You should see the stream connect between the two tabs!

### Method 2: Testing with your Phone (Using Ngrok)
To test on your actual mobile device, you need to expose your local server securely using a tunnel tool like `ngrok`. This gives you a temporary `https://` URL that routes to your computer.

1. Start your local server:
   ```bash
   node server.js
   ```
2. Install `ngrok` if you haven't already: [https://ngrok.com/download](https://ngrok.com/download)
3. In a new terminal window, start an ngrok tunnel on port 8080:
   ```bash
   ngrok http 8080
   ```
4. Ngrok will output a Forwarding URL that looks something like this:
   `Forwarding  https://a1b2c3d4.ngrok.app -> http://localhost:8080`
5. Open that **HTTPS** link on your **computer**.
6. Click **"Host a Camera"**. It will generate a QR code for that secure URL.
7. Open the native Camera app on your **mobile phone** and scan the QR code displayed on your computer screen.
8. The phone will open the stream link securely, and WebRTC will connect!

## Configuration & Environment Variables

The app uses environment variables for authentication and domain settings. Create a `.env` file or set these in your environment:

| Variable | Description | Default |
| :--- | :--- | :--- |
| `GOOGLE_CLIENT_ID` | Your GCP OAuth 2.0 Client ID | |
| `GOOGLE_CLIENT_SECRET` | Your GCP OAuth 2.0 Client Secret | |
| `SESSION_SECRET` | Random string for secure sessions | `streamsync-default-secret` |
| `HOST_DOMAIN` | Your public domain (e.g., `streamsync.arayalogic.ai`) | `localhost:8080` |
| `DEV_LOGIN` | Multi-user test mode for local dev (bypasses Google) | `false` |
| `GCS_BUCKET_NAME` | Optional GCS bucket for data persistence | |

## Google Authentication Setup

To use Google Login, you must create a project in the **[Google Cloud Console](https://console.cloud.google.com/)**:

1.  **Create a Project**: Go to the project selector and create a new project.
2.  **OAuth Consent Screen**:
    - Go to **APIs & Services > OAuth consent screen**.
    - Choose **External** (unless you are in a Google Workspace organization).
    - Provide an App Name, User support email, and Developer contact information.
    - Add the `.../auth/userinfo.email` and `.../auth/userinfo.profile` scopes.
3.  **Create Credentials**:
    - Go to **APIs & Services > Credentials**.
    - Click **Create Credentials > OAuth client ID**.
    - Select **Web application**.
    - **Authorized JavaScript origins**: `http://localhost:8080` and your production URL.
    - **Authorized redirect URIs**: `http://localhost:8080/auth/google/callback` and `https://yourdomain.com/auth/google/callback`.
4.  Copy your **Client ID** and **Client Secret** into your `.env` file.

## Deployment
This app is ready to be deployed to Google Cloud Run, which handles HTTP, WebSockets (for Socket.io), and HTTPS provisioning automatically. See `DEPLOY_GCP.md` for instructions.
