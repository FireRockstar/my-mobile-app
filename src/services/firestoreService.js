// src/services/firestoreService.js
//
// DESIGN: instead of a bespoke hook per collection, this exposes THREE
// generic hooks that mirror useState's exact calling convention
// ([value, setValue], setValue accepts either a new value or an updater
// function). That means migrating a collection is a one-line change in
// App.jsx — e.g.:
//
//   const [jobs, setJobs] = useState(SEED_JOBS);
//     becomes
//   const [jobs, setJobs] = useFirestoreArrayState("jobs", "id", "intake");
//
// ...and every existing setJobs((js) => js.map(...)) / .filter(...) /
// [newItem, ...js] call site in the rest of the file keeps working
// completely unchanged — the hook diffs prev vs next under the hood and
// writes only what changed to Firestore, with an optimistic local update
// so the UI still feels instant.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  collection, doc, setDoc, addDoc,deleteDoc,
  onSnapshot, query, orderBy, limit as fsLimit, writeBatch,
} from "firebase/firestore";
import { db } from "../firebase";

/* ---------------------------------------------------------------------- */
/*  1. ARRAY STATE — for jobs, customers, technicians, parts, invoices,    */
/*     standbyLoans, attendance, extraTasks: any list of records keyed by  */
/*     a stable id field.                                                 */
/* ---------------------------------------------------------------------- */

async function diffAndWrite(collectionName, idField, prev, next) {
  const prevById = new Map(prev.map((r) => [String(r[idField]), r]));
  const nextById = new Map(next.map((r) => [String(r[idField]), r]));
  const batch = writeBatch(db);
  let ops = 0;

  for (const [id, record] of nextById) {
    const before = prevById.get(id);
    if (!before || JSON.stringify(before) !== JSON.stringify(record)) {
      batch.set(doc(db, collectionName, id), record);
      ops++;
    }
  }
  for (const [id] of prevById) {
    if (!nextById.has(id)) {
      batch.delete(doc(db, collectionName, id));
      ops++;
    }
  }
  // Firestore batches cap at 500 ops — comfortably above anything this
  // app does in one update. If you ever bulk-import thousands of
  // records at once, chunk them into multiple batches instead.
  if (ops) await batch.commit();
}

export function useFirestoreArrayState(collectionName, idField = "id", orderField = null) {
  const [data, setDataState] = useState([]);
  const dataRef = useRef([]);

  useEffect(() => {
    const ref = collection(db, collectionName);
    const q = orderField ? query(ref, orderBy(orderField, "desc")) : ref;
    const unsub = onSnapshot(
      q,
      (snap) => {
        const next = snap.docs.map((d) => d.data());
        dataRef.current = next;
        setDataState(next);
      },
      (err) => console.error(`useFirestoreArrayState(${collectionName}) snapshot error:`, err)
    );
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collectionName, idField, orderField]);

  const setData = useCallback(
    (updater) => {
      const prev = dataRef.current;
      const next = typeof updater === "function" ? updater(prev) : updater;
      dataRef.current = next;
      setDataState(next); // optimistic — UI updates immediately
      diffAndWrite(collectionName, idField, prev, next).catch((err) =>
        console.error(`setData(${collectionName}) write failed:`, err)
      );
    },
    [collectionName, idField]
  );

  return [data, setData];
}

/* ---------------------------------------------------------------------- */
/*  2. VALUE STATE — for a single shared document: notificationSettings,   */
/*     loginWindowSettings, smsDispatchMode. Always a full overwrite (no   */
/*     Firestore merge), which exactly matches the object-spread pattern   */
/*     the app already uses, and sidesteps Firestore's nested-map-merge    */
/*     gotcha entirely.                                                    */
/* ---------------------------------------------------------------------- */

export function useFirestoreValueState(collectionName, docId, defaultValue) {
  const [data, setDataState] = useState(defaultValue);
  const dataRef = useRef(defaultValue);

  useEffect(() => {
    const ref = doc(db, collectionName, docId);
    const unsub = onSnapshot(
      ref,
      (snap) => {
        const next = snap.exists() ? snap.data().value : defaultValue;
        dataRef.current = next;
        setDataState(next);
      },
      (err) => console.error(`useFirestoreValueState(${collectionName}/${docId}) snapshot error:`, err)
    );
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collectionName, docId]);

  const setData = useCallback(
    (updater) => {
      const prev = dataRef.current;
      const next = typeof updater === "function" ? updater(prev) : updater;
      dataRef.current = next;
      setDataState(next);
      setDoc(doc(db, collectionName, docId), { value: next }).catch((err) =>
        console.error(`setData(${collectionName}/${docId}) write failed:`, err)
      );
    },
    [collectionName, docId]
  );

  return [data, setData];
}

/* ---------------------------------------------------------------------- */
/*  3. LOG STATE — for append-only logs with no natural id (smsLog): the   */
/*     setter here takes the NEW ENTRY directly (not an updater function), */
/*     since there's nothing to diff against — every call is an append.    */
/* ---------------------------------------------------------------------- */

export function useFirestoreLogState(collectionName, orderField = "ts", limitN = 500) {
  const [data, setDataState] = useState([]);

  useEffect(() => {
    const q = query(collection(db, collectionName), orderBy(orderField, "desc"), fsLimit(limitN));
    const unsub = onSnapshot(
      q,
      (snap) => setDataState(snap.docs.map((d) => d.data())),
      (err) => console.error(`useFirestoreLogState(${collectionName}) snapshot error:`, err)
    );
    return unsub;
  }, [collectionName, orderField, limitN]);

  const append = useCallback(
    (entry) => {
      addDoc(collection(db, collectionName), entry).catch((err) =>
        console.error(`append(${collectionName}) failed:`, err)
      );
    },
    [collectionName]
  );

  return [data, append];
}

/*
  ------------------------------------------------------------------------
  ONE-TIME SEEDING: fresh Firestore collections start EMPTY — the demo's
  SEED_JOBS / SEED_CUSTOMERS / SEED_ATTENDANCE / SEED_INVOICES fake data is
  intentionally NOT migrated (you don't want fake demo customers in a live
  business tool). Real technicians and inventory parts, though, you likely
  DO want to enter once — just use the app's own "Add Technician" /
  "Add Part" forms after deploying; they write through setTechnicians /
  setParts exactly like everything else, no separate import step needed.
  ------------------------------------------------------------------------

  SECURITY RULES — paste into Firestore → Rules once you're past test mode:
  ------------------------------------------------------------------------

  rules_version = '2';
  service cloud.firestore {
    match /databases/{database}/documents {
      match /{document=**} {
        allow read, write: if request.auth != null;
      }
    }


  }
  ------------------------------------------------------------------------
*/
// Firestore-லிருந்து நேரடியாக ஒரு பதிவை நீக்க (Delete Record)
export const deleteFirestoreRecord = async (collectionName, recordId) => {
  try {
    const docRef = doc(db, collectionName, String(recordId));
    await deleteDoc(docRef);
    console.log(`Document ${recordId} successfully deleted from ${collectionName}`);
  } catch (error) {
    console.error("Error deleting document from Firestore: ", error);
  }
};