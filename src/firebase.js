// src/firebase.js
import { initializeApp } from "firebase/app";
import { initializeFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyCubA0nTLeF_H6rW2KCmcjhpFZoBbczIK4",
  authDomain: "ai-tech-lab-crm.firebaseapp.com",
  projectId: "ai-tech-lab-crm",
  storageBucket: "ai-tech-lab-crm.firebasestorage.app",
  messagingSenderId: "422945982803",
  appId: "1:422945982803:web:57fa582ddad3d9a743f9a6",
};

const app = initializeApp(firebaseConfig);
// ignoreUndefinedProperties: the demo app sometimes leaves an optional
// field as `undefined` (vs. explicitly `null`) — Firestore rejects
// `undefined` by default, so this avoids random write failures on fields
// like an unset `customerId` or `location`.
export const db = initializeFirestore(app, { ignoreUndefinedProperties: true });
export const auth = getAuth(app);
