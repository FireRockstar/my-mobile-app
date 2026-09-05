// src/services/authService.js
//
// AUTH MODEL:
//   - Everyone signs in with Google (their own Gmail) — no passwords to
//     manage.
//   - OWNER_EMAIL (set below) is always Admin — this solves the
//     chicken-and-egg problem of "who's allowed to add the first Admin".
//   - Every other person (Front Desk, technicians) is controlled by
//     Admin through the "Manage Staff" screen, which writes a doc to the
//     `staff` collection keyed by their Gmail address:
//       { email, name, role, techId (for tech roles), active, addedAt }
//   - Signing in with a Gmail that has no active `staff` doc (and isn't
//     OWNER_EMAIL) lands on an "access pending" screen — they physically
//     cannot get into the app until Admin adds them.

import { useEffect, useState } from "react";
import { doc, collection, onSnapshot, setDoc, deleteDoc } from "firebase/firestore";
import {
  GoogleAuthProvider, signInWithCredential, signInWithPopup,
  signOut as firebaseSignOut, onAuthStateChanged,
} from "firebase/auth";
import { Capacitor } from "@capacitor/core";
import { FirebaseAuthentication } from "@capacitor-firebase/authentication";
import { auth, db } from "../firebase";

// CHANGE THIS to your real Gmail address — this account always has Admin
// access, regardless of what's in the `staff` collection.
export const OWNER_EMAIL = "aitechlabledtvservice@gmail.com";

/* ---------------------------------------------------------------------- */
/*  Sign-in / sign-out                                                     */
/* ---------------------------------------------------------------------- */

export async function signInWithGoogle() {
  if (Capacitor.isNativePlatform()) {
    // NATIVE (Android/iOS via Capacitor): a plain Firebase JS SDK popup
    // gets rejected inside a WebView with "disallowed_useragent" — Google
    // blocks OAuth popups from embedded browsers as a security measure.
    // @capacitor-firebase/authentication instead opens the device's real
    // native Google Sign-In UI, then we hand the resulting idToken to the
    // Firebase JS SDK via signInWithCredential — so onAuthStateChanged /
    // useAuthUser / everything else downstream works identically on web
    // and native, no branching needed anywhere else in the app.
    const result = await FirebaseAuthentication.signInWithGoogle();
    const idToken = result?.credential?.idToken;
    if (!idToken) throw new Error("Google sign-in didn't return a token — check google-services.json is in place.");
    const credential = GoogleAuthProvider.credential(idToken);
    await signInWithCredential(auth, credential);
  } else {
    // WEB (browser / PWA): the standard popup flow works fine here.
    const provider = new GoogleAuthProvider();
    // Always show the account chooser — helpful on a shared shop computer/
    // tablet where more than one person's Gmail may already be cached.
    provider.setCustomParameters({ prompt: "select_account" });
    await signInWithPopup(auth, provider);
  }
}

export async function signOutUser() {
  if (Capacitor.isNativePlatform()) {
    await FirebaseAuthentication.signOut();
  }
  await firebaseSignOut(auth);
}

/* ---------------------------------------------------------------------- */
/*  Live auth state — the Firebase user object, or null                    */
/* ---------------------------------------------------------------------- */

export function useAuthUser() {
  const [user, setUser] = useState(undefined); // undefined = still checking, null = signed out
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, setUser);
    return unsub;
  }, []);
  return user;
}

/* ---------------------------------------------------------------------- */
/*  Live staff directory — every entry Admin has ever added, so the        */
/*  Manage Staff screen can list/edit/remove them.                         */
/* ---------------------------------------------------------------------- */

export function useStaffDirectory() {
  const [staff, setStaff] = useState([]);
  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, "staff"),
      (snap) => setStaff(snap.docs.map((d) => d.data())),
      (err) => console.error("useStaffDirectory:", err)
    );
    return unsub;
  }, []);
  return staff;
}

/* ---------------------------------------------------------------------- */
/*  Resolves the signed-in user's role from OWNER_EMAIL + the staff doc    */
/*  matching their email. This is what the app actually gates access on.  */
/* ---------------------------------------------------------------------- */

export function useMyStaffRecord(user) {
  const [record, setRecord] = useState(undefined); // undefined = loading, null = no record found
  useEffect(() => {
    if (!user) {
      setRecord(null);
      return;
    }
    if (user.email === OWNER_EMAIL) {
      setRecord({ email: user.email, name: user.displayName || "Admin", role: "admin", active: true, isOwner: true });
      return;
    }
    const ref = doc(db, "staff", user.email);
    const unsub = onSnapshot(
      ref,
      (snap) => setRecord(snap.exists() ? { ...snap.data(), isOwner: false } : null),
      (err) => {
        console.error("useMyStaffRecord:", err);
        setRecord(null);
      }
    );
    return unsub;
  }, [user]);
  return record;
}

/* ---------------------------------------------------------------------- */
/*  Admin: manage staff (add / edit role / activate / deactivate / remove) */
/* ---------------------------------------------------------------------- */

export async function upsertStaffDoc(email, { name, role, techId, active }) {
  await setDoc(doc(db, "staff", email), {
    email,
    name: name || email,
    role, // "admin" | "frontdesk" | "indoor_tech" | "outdoor_tech"
    techId: techId || null, // links a tech-role login to a technicians/{id} record
    active: active !== false,
    addedAt: Date.now(),
  });
}

export async function setStaffActive(email, active) {
  await setDoc(doc(db, "staff", email), { active }, { merge: true });
}

export async function deleteStaffDoc(email) {
  await deleteDoc(doc(db, "staff", email));
}
