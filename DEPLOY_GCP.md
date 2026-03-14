# StreamSync GCP Deployment Guide

This repository contains a simple WebRTC streaming app designed for Google Cloud Run. 
Cloud Run seamlessly handles WebSocket traffic (Socket.IO) and standard HTTP requests, and auto-scales down to zero when not in use.

## Prerequisites

1.  **Google Cloud Platform Account:** And a project with billing enabled.
2.  **gcloud CLI installed:** [Install the Google Cloud SDK](https://cloud.google.com/sdk/docs/install).
3.  **Project Initialized:** `gcloud auth login` and `gcloud config set project [YOUR_PROJECT_ID]`.

## Deployment with Cloud Build

This repository includes a `cloudbuild.yaml` file, which builds the Docker image and deplोस it to Cloud Run. The configuration also sets an environment variable `HOST_DOMAIN`, which is used by the frontend to generate the correct stream URLs and QR codes.

1.  **Enable necessary APIs:**
    ```bash
    gcloud services enable cloudbuild.googleapis.com run.googleapis.com
    ```

2.  **Submit the Build:**
    Run the following command in the root of the project to trigger Google Cloud Build:
    
    ```bash
    gcloud builds submit --config cloudbuild.yaml .
    ```

3.  **Customizing the Domain:**
    If you have mapped a custom domain (e.g., `streamsync.arayalogic.com`) to your Cloud Run service, you should update the `HOST_DOMAIN=streamsync.arayalogic.com` line inside `cloudbuild.yaml` so that the generated QR codes point to that exact domain.

4.  **Important Notes:**
    *   **HTTPS Requirement:** WebRTC `getUserMedia()` (camera access) **requires** a secure context (`https://`). Cloud Run provides an `https://` URL automatically.
    *   **WebSocket traffic:** Cloud Run supports WebSockets out-of-the-box on the same port. No special configuration is needed for Socket.IO.
