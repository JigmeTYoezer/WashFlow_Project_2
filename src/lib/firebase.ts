import AsyncStorage from '@react-native-async-storage/async-storage';
import { getApp, getApps, initializeApp } from 'firebase/app';
import { getAuth, type Auth } from 'firebase/auth';
import { getReactNativePersistence, initializeAuth } from '@firebase/auth';
import { Platform } from 'react-native';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
};

export const firebaseEnabled = Boolean(firebaseConfig.apiKey && firebaseConfig.projectId);

const app = firebaseEnabled
  ? getApps().length > 0 ? getApp() : initializeApp(firebaseConfig)
  : null;

function makeAuth(): Auth | null {
  if (!app) return null;
  if (Platform.OS === 'web') return getAuth(app);

  try {
    return initializeAuth(app, {
      persistence: getReactNativePersistence(AsyncStorage),
    });
  } catch {
    return getAuth(app);
  }
}

export const auth = makeAuth();
export const db = app ? getFirestore(app) : null;

export function getProvisioningAuth(): Auth | null {
  if (!firebaseEnabled) return null;
  const name = 'washflow-user-provisioning';
  const provisioningApp = getApps().find((candidate) => candidate.name === name)
    ?? initializeApp(firebaseConfig, name);
  if (Platform.OS === 'web') return getAuth(provisioningApp);
  try {
    return initializeAuth(provisioningApp, {
      persistence: getReactNativePersistence(AsyncStorage),
    });
  } catch {
    return getAuth(provisioningApp);
  }
}
