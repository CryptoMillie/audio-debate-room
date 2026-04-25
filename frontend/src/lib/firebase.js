import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, signOut, updateProfile } from "firebase/auth";

// Replace with your Firebase project config
// Get these values from: Firebase Console → Project Settings → Your Apps → Web App
const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || "YOUR_API_KEY",
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || "YOUR_PROJECT.firebaseapp.com",
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "YOUR_PROJECT_ID",
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || "YOUR_PROJECT.appspot.com",
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || "000000000000",
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || "YOUR_APP_ID",
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: "select_account" });

export async function signInWithGoogle() {
  try {
    const result = await signInWithPopup(auth, googleProvider);
    return result.user;
  } catch (err) {
    // If popup fails for any reason (blocked, in-app browser, etc.), fall back to redirect
    console.log("Popup sign-in failed, trying redirect:", err.code);
    await signInWithRedirect(auth, googleProvider);
    return null;
  }
}

export async function handleRedirectResult() {
  const result = await getRedirectResult(auth);
  return result?.user || null;
}

export async function logOut() {
  await signOut(auth);
}

export async function updateUserProfile({ displayName, photoURL }) {
  const currentUser = auth.currentUser;
  if (!currentUser) throw new Error("Not signed in");
  await updateProfile(currentUser, { displayName, photoURL });
  return currentUser;
}

export { auth };
