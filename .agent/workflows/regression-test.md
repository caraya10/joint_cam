---
description: Running a regression test suite based on the functionality.md document.
---

1.  **Preparation**:
    - Kill any running version of the server
    - Start the server with `DEV_LOGIN=true`, don't touch the .env file. Also start the server at port 8081 since I may have a server running on 8080.
    - Verify that the server is running on the expected port (e.g., 8081).
  

2.  **Read Functionality**: View the latest `functionality.md` in the artifacts directory to identify the core features and regression testing plan.

3.  **Automated Execution**: Use the `browser_subagent` tool to perform the following checks:
    - **Landing Page**: Verify basic layout and presence of "Quick Connect" and auth options.
    - **Login Flow**: Click a developer login button and verify redirection to the dashboard.
    - **Dashboard Header**: Check for user name and logout button in the dashboard header.
    - **Camera Actions**: Create a new camera and verify it appears in the list.
    - **Sharing**: Add a test email to the share list and verify it's persisted in the UI.
    - **Logout**: Click the logout button and verify return to the home page.

4.  **Streaming Verification** (If possible):
    - Use the subagent to start a camera stream.
    - Capture a screenshot or recording of the streaming view.
    - Verify that the "Stop" and "Toggle Preview" buttons are functional.

5.  **Reporting**:
    - Capture screenshots of any failures or unexpected UI behavior.
    - Create a `test_results.md` artifact summarizing the pass/fail status of each test case.
    - Notify the user with the final report.


NOTES:
    - When you find problems try to figure out what the standard way of fixing it is.  See what standard methods or components can be used to solve the problem.  If you are writing something custom where a standard thing should be used that should be a red flag for you.
    - You don't need to test the google sign in.  Just use the test users to test functionality.