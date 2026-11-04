# Deploying to Firebase App Hosting

The Next.js app root is the repository root. Without `FIREBASE_PROJECT_ID` the bot runs on local SQLite and local files, which is how it runs on a developer's computer.

## 1. Project setup

1. Turn on Firestore (Native mode) and Cloud Storage in the Firebase project.
2. Confirm the App Hosting backend's service account can read and write both. The app uses it directly, with no private key on the server.
3. Fill the `PUT_...` values in `apphosting.yaml`.
4. Set the secrets:

   ```bash
   firebase apphosting:secrets:set TOKEN
   firebase apphosting:secrets:set WEBHOOK_SECRET
   ```

## 2. Copy the data, once, from the computer that has it

Needs `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` and `FIREBASE_STORAGE_BUCKET` in `.env.local`. Never commit that file.

Stop the local bot first, so nothing changes during the copy.

```bash
npm run firebase-check
```

```bash
npm run upload-content
```

```bash
npm run copy-to-firestore
```

`copy-to-firestore` reads `data/store.db` and refuses to run if Firestore already has data, unless given `-- --force`, which overwrites matching records.

After this, remove the Firebase values from `.env.local` to run locally on SQLite again.

## 3. Deploy and connect Telegram

1. Deploy the backend.
2. Point Telegram at the deployed app. This also stops the local bot's polling method from working:

   ```bash
   npm run set-webhook -- https://YOUR_DOMAIN
   ```

## Check after the first deploy

These could not be tested before deploying:

- **Real Firestore and Storage:** all scenarios pass on a strict fake Firestore, and `firebase-check` tests the real connection only.
- **PDF receipts and cards:** the app ships `@sparticuz/chromium`, built for AWS Lambda. Print one order and sell one receipt. If rendering fails, the logs show `Render problem` or `Browser problem`, and the runtime may need Chromium's system libraries.
- **Node version:** `package.json` asks for Node 24 or newer. Confirm App Hosting builds with it.
- **Costs:** `minInstances: 0` means the first message after a quiet period waits for a cold start. `minInstances: 1` removes the wait and costs more.

`maxInstances` must stay 1. The bot keeps each user's message order and its flood limits in memory.
