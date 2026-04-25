"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { auth, signInWithGoogle, logOut, updateUserProfile, handleRedirectResult } from "./firebase";
import { syncUser, updateAvatar, getAvatar } from "./api";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Complete redirect sign-in if user was redirected back from Google
    handleRedirectResult().catch(() => {});

    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        // Sync user to our backend database
        try {
          await syncUser(firebaseUser);
          // Load custom avatar from backend if exists
          const { avatar } = await getAvatar(firebaseUser.uid).catch(() => ({ avatar: null }));
          const photoURL = avatar || firebaseUser.photoURL || null;
          setUser({
            uid: firebaseUser.uid,
            email: firebaseUser.email,
            displayName: firebaseUser.displayName,
            photoURL,
          });
        } catch (e) {
          console.error("Failed to sync user:", e);
          setUser({
            uid: firebaseUser.uid,
            email: firebaseUser.email,
            displayName: firebaseUser.displayName,
            photoURL: firebaseUser.photoURL,
          });
        }
      } else {
        setUser(null);
      }
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  const login = async () => {
    try {
      const firebaseUser = await signInWithGoogle();
      if (firebaseUser) await syncUser(firebaseUser);
    } catch (e) {
      console.error("Login failed:", e);
    }
  };

  const logout = () => logOut();

  const editProfile = async ({ displayName }) => {
    await updateUserProfile({ displayName, photoURL: auth.currentUser?.photoURL });
    setUser((prev) => ({ ...prev, displayName }));
    await syncUser({ uid: user.uid, email: user.email, displayName, photoURL: auth.currentUser?.photoURL });
  };

  const changeAvatar = async (base64) => {
    await updateAvatar(user.uid, base64);
    // Update local user object with new photo
    setUser((prev) => ({ ...prev, photoURL: base64 }));
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, editProfile, changeAvatar }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
