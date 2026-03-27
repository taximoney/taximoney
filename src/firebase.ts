import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged, User } from 'firebase/auth';
import { 
  getFirestore, 
  collection, 
  addDoc, 
  query, 
  where, 
  onSnapshot, 
  orderBy, 
  deleteDoc, 
  doc, 
  setDoc, 
  getDoc,
  Timestamp
} from 'firebase/firestore';

// Import the Firebase configuration
import firebaseConfig from '../firebase-applet-config.json';

// Initialize Firebase SDK
const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();

// Types
export interface Trip {
  id?: string;
  userId: string;
  amount: number;
  tip: number;
  paymentMethod: 'cash' | 'card';
  timestamp: string;
  driverPercent: number;
}

export interface UserConfig {
  userId: string;
  driverPercent: number;
  lastUpdated: string;
  accumulatedDebt: number;
}

export interface Shift {
  id?: string;
  userId: string;
  date: string;
  month: string;
  hours: number;
  totals: {
    caja: number;
    propinas: number;
    propinaTarjeta: number;
    tarjeta: number;
    efectivo: number;
    mio: number;
    jefe: number;
    ajuste: number;
  };
  timestamp: string;
}

// Auth Helpers
export const signIn = () => signInWithPopup(auth, googleProvider);
export const logOut = () => signOut(auth);

// Firestore Error Handler
export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export function handleFirestoreError(error: any, operationType: OperationType, path: string | null) {
  const errInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// Data Helpers
export const saveTrip = async (trip: Omit<Trip, 'id'>) => {
  try {
    return await addDoc(collection(db, 'trips'), trip);
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, 'trips');
  }
};

export const deleteTrip = async (tripId: string) => {
  try {
    await deleteDoc(doc(db, 'trips', tripId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `trips/${tripId}`);
  }
};

export const saveUserConfig = async (config: UserConfig) => {
  try {
    await setDoc(doc(db, 'userConfigs', config.userId), config);
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `userConfigs/${config.userId}`);
  }
};

export const getUserConfig = async (userId: string) => {
  try {
    const docSnap = await getDoc(doc(db, 'userConfigs', userId));
    return docSnap.exists() ? docSnap.data() as UserConfig : null;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, `userConfigs/${userId}`);
  }
};

export const saveShift = async (shift: Omit<Shift, 'id'>) => {
  try {
    return await addDoc(collection(db, 'shifts'), shift);
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, 'shifts');
  }
};

export const deleteShift = async (shiftId: string) => {
  try {
    await deleteDoc(doc(db, 'shifts', shiftId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `shifts/${shiftId}`);
  }
};

export const updateDebt = async (userId: string, newDebt: number) => {
  try {
    await setDoc(doc(db, 'userConfigs', userId), { accumulatedDebt: newDebt }, { merge: true });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `userConfigs/${userId}`);
  }
};
