import { FirebaseSnapshot } from "./firebaseSnapshot.js";

export { FirebaseSnapshot } from "./firebaseSnapshot.js";

/**
 * Connects to a real Firestore database and returns a ready-to-use
 * FirebaseSnapshot, or null if Firebase isn't configured.
 *
 * Reads credentials from environment variables — set these in
 * Vercel's Project → Settings → Environment Variables:
 *   - FIREBASE_PROJECT_ID
 *   - FIREBASE_CLIENT_EMAIL
 *   - FIREBASE_PRIVATE_KEY  (paste exactly as given by Firebase,
 *     including the literal "\n" line breaks — this function converts
 *     them to real newlines for you)
 *
 * `firebase-admin` is dynamically imported so its absence (e.g. in
 * this codebase's own test runs, where it isn't installed) never
 * breaks anything else that imports this file.
 *
 * @returns {Promise<FirebaseSnapshot|null>}
 */
export async function connectFirebaseSnapshot() {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY;

  if (!projectId || !clientEmail || !privateKey) {
    return null;
  }

  let admin;
  try {
    admin = await import("firebase-admin");
  } catch (error) {
    throw new Error(
      "connectFirebaseSnapshot: Firebase credentials are set but the 'firebase-admin' package isn't installed. Make sure it's listed in package.json dependencies (it is, by default) so Vercel installs it on deploy."
    );
  }

  const app =
    admin.default.apps?.length > 0
      ? admin.default.apps[0]
      : admin.default.initializeApp({
          credential: admin.default.credential.cert({
            projectId,
            clientEmail,
            // Firebase gives you this key with literal "\n" sequences
            // (not real newlines) when copy-pasted from its console.
            privateKey: privateKey.replace(/\\n/g, "\n"),
          }),
        });

  const db = admin.default.firestore(app);
  return new FirebaseSnapshot({ db });
}
