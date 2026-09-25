import { getApps, initializeApp, type FirebaseApp, type FirebaseOptions } from 'firebase/app';
import { getAuth, type Auth } from 'firebase/auth';

function readFirebaseConfig(): FirebaseOptions | null {
  const apiKey = import.meta.env.VITE_FIREBASE_API_KEY;
  const authDomain = import.meta.env.VITE_FIREBASE_AUTH_DOMAIN;
  const projectId = import.meta.env.VITE_FIREBASE_PROJECT_ID;
  const storageBucket = import.meta.env.VITE_FIREBASE_STORAGE_BUCKET;
  const messagingSenderId = import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID;
  const appId = import.meta.env.VITE_FIREBASE_APP_ID;
  if (!apiKey || !authDomain || !projectId || !storageBucket || !messagingSenderId || !appId) return null;
  return { apiKey, authDomain, projectId, storageBucket, messagingSenderId, appId };
}

const firebaseConfig = readFirebaseConfig();
export const isFirebaseConfigured = firebaseConfig !== null;

function createFirebaseApp(config: FirebaseOptions | null): FirebaseApp | null {
  if (!config) return null;
  return getApps()[0] ?? initializeApp(config);
}

export const firebaseApp = createFirebaseApp(firebaseConfig);
export const firebaseAuth: Auth | null = firebaseApp ? getAuth(firebaseApp) : null;
