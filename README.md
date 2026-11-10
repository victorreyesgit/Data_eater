# Data Eater

Downloads random data to use up mobile data on purpose. Free, no account, no API key.

## Publish
1. Create a GitHub repo and upload all these files to the root (index.html must be at the top level).
2. Settings > Pages > Source: Deploy from a branch > main / (root) > Save.
3. Open https://YOUR-USER.github.io/YOUR-REPO/ on your phone and choose Add to Home Screen / Install app.

## Update
Replace the files in the repo. If the phone shows the old version, close the app fully and reopen it.

## Notes
- Cool (20 Mbit/s, 2 min on / 1 min rest), Normal (50 Mbit/s, 3 on / 1 rest), Max (no limit, 2 on / 2 rest): screen stays on.
  Parallel streams are automatic (1 to 4). Black screen = screen on but fully black (tap to return).
- Background: Android Chrome only. Works with the screen off or the app closed. Chrome controls the speed
  (no limit, no breaks) and shows its own download notification with a cancel button.
  Chrome keeps the data on disk until the download ends, so you need that much free space. Capped at 5 GB
  (change MAX_BG_GB in script.js).
- Screen-on modes stop if you press the power button (browsers freeze web pages).
- A notification is sent when it finishes (allow notifications the first time).
