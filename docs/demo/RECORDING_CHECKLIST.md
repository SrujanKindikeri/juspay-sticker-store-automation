# Demonstration Recording Checklist (Screen-Only, Windows Xbox Game Bar)

## 1. Environment & Display Preparation
- [ ] Set display resolution to **1920 × 1080** (`Settings → System → Display`).
- [ ] Set browser zoom to **100%** (`Ctrl + 0`) and close unnecessary browser tabs, bookmarks bar (`Ctrl + Shift + B`), and desktop notifications (**Focus Assist / Do Not Disturb: On**).
- [ ] Verify PostgreSQL container `juspay_postgres` is running (`docker compose up -d`).
- [ ] Verify FastAPI backend is running on `http://127.0.0.1:8001` (`GET /health` returns `"database": "connected"`).
- [ ] Verify Next.js production server is running on `http://localhost:3001`.
- [ ] Clear browser `localStorage` (`juspay_sticker_cart_v1`) so the shopping cart starts at `0`.

## 2. Privacy, Safety & Simulation Checks
- [ ] Confirm **NO** `.env` files, personal passwords, or real secrets are open in editor tabs.
- [ ] Confirm screen-recording microphone and webcam are **OFF** (screen-only recording, no voiceover, no music).
- [ ] Confirm on-screen disclaimer `"Educational payment simulation — no real money transferred."` is visible on Checkout, Payment Gateway, and Store Footer.
- [ ] Use **only** simulated test data during recording:
  - **Customer**: `Ananya Verma` / `9876543210` / `ananya.verma@example.com`
  - **Address**: `42 Indiranagar 100 Feet Road`, `Bengaluru`, `Karnataka`, `560038`
  - **Card**: `4111 2222 3333 4444` | Expiry: `12/28` | CVV: `123` | Holder: `ANANYA VERMA`
  - **OTP**: Use the on-screen **Autofill OTP** button in sandbox development mode.

## 3. Recording Steps Using Windows Xbox Game Bar
1. Open Chrome/Edge maximized at `http://localhost:3001/` (1920×1080).
2. Press **`Win + G`** to open **Windows Xbox Game Bar**.
3. In the **Capture** widget, ensure the **Microphone icon is muted/crossed out** (no narration).
4. Click the **Start Recording** circle button (or close Game Bar overlay and press **`Win + Alt + R`** directly inside the active browser window to begin recording immediately).
5. Follow `docs/demo/VIDEO_SHOT_LIST.md` smoothly from Step 1 through Step 12 (5–7 minutes total, pausing 2–3 seconds on each screen).
6. When finished with Step 12 (GitHub repo & passing test results), press **`Win + Alt + R`** (or click **Stop** in the floating capture bar) to end the recording.
7. Locate the saved `.mp4` file in `C:\Users\<username>\Videos\Captures\` and review playback before sharing.
