import {
  createUserWithEmailAndPassword,
  deleteUser,
  EmailAuthProvider,
  onAuthStateChanged,
  reauthenticateWithCredential,
  signInWithEmailAndPassword,
  signOut,
  updatePassword,
  type UserCredential,
  type User as FirebaseUser,
} from 'firebase/auth';
import {
  addDoc,
  collection,
  doc,
  deleteDoc,
  getDoc,
  onSnapshot,
  query,
  runTransaction,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type Unsubscribe,
} from 'firebase/firestore';
import { auth, db, firebaseEnabled, getProvisioningAuth } from './firebase';

export type UserRole = 'STUDENT' | 'STAFF' | 'ADMIN';
export type UserProfile = {
  userId: string;
  fullName: string;
  role: UserRole;
  roomNumber?: string | null;
  hostel?: string | null;
};
export type BookingStatus = 'BOOKED' | 'COLLECTED' | 'WASHING' | 'READY' | 'DELIVERED' | 'COMPLETED' | 'CANCELLED';
export type WashBooking = {
  id: string;
  userId: string;
  fullName: string;
  roomNumber?: string | null;
  machineId: string;
  date: string;
  startTime: string;
  endTime: string;
  cycle: string;
  cycleMinutes: number;
  status: BookingStatus;
  startAt: number;
  endAt: number;
  createdAt: number;
};
export type MachineInfo = { id: string; floor?: string; status: 'Available' | 'Maintenance' };
export type SlotTime = { start: string; end: string };
export type UserNotification = { id: string; title: string; message: string };

const USER_COLLECTION = 'users';
const BOOKING_COLLECTION = 'bookings';
const MACHINE_LIST: MachineInfo[] = [
  { id: 'Washer 01', status: 'Available' },
  { id: 'Washer 02', status: 'Available' },
  { id: 'Washer 03', status: 'Available' },
  { id: 'Washer 04', status: 'Available' },
];
export const DEFAULT_SLOT_TIMES: SlotTime[] = [];

function requireBackend() {
  if (!auth || !db || !firebaseEnabled) {
    throw new Error('Firebase is not configured. Add the Firebase values to .env.local and restart Expo.');
  }
  return { auth, db };
}

export function emailForUserId(userId: string) {
  return userId.trim().toLowerCase();
}

function isCstStudentEmail(email: string | null | undefined) {
  return typeof email === 'string' && /^\d{8}\.cst@rub\.edu\.bt$/i.test(email.trim());
}

function userIdForEmail(email: string) {
  return email.split('@')[0].replace(/\.cst$/i, '');
}

function emailForLoginInput(input: string) {
  const value = input.trim().toLowerCase();
  if (/^\d{8}$/.test(value)) return `${value}.cst@rub.edu.bt`;
  if (value.includes('@')) return value;
  return `${value}@washflow.app`;
}

function cleanError(error: unknown) {
  const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : '';
  const message = error instanceof Error ? error.message : 'Please try again.';
  if (code.includes('user-not-found') || code.includes('invalid-credential')) return 'User ID or password is incorrect.';
  if (code.includes('email-already-in-use')) return 'That user ID already has an account.';
  if (code.includes('weak-password')) return 'Choose a password with at least 6 characters.';
  if (code.includes('network-request-failed')) return 'No internet connection. Check your network and try again.';
  if (code.includes('permission-denied')) return 'Firebase denied the request. Check the Firestore security rules.';
  return message;
}

export async function registerStudent(input: {
  userId: string;
  fullName: string;
  roomNumber: string;
  hostel: string;
  password: string;
}) {
  const { auth: firebaseAuth, db: firestore } = requireBackend();
  const email = emailForUserId(input.userId);
  if (!isCstStudentEmail(email)) throw new Error('Use your 8-digit student ID followed by .cst@rub.edu.bt.');
  const id = userIdForEmail(email);
  if (!input.fullName.trim() || !input.roomNumber.trim()) throw new Error('Fill in your name and room number.');
  if (input.password.length < 6) throw new Error('Choose a password with at least 6 characters.');

  let createdUser: FirebaseUser | null = null;
  try {
    const credential = await createUserWithEmailAndPassword(firebaseAuth, email, input.password);
    createdUser = credential.user;
    const profile: UserProfile = {
      userId: id,
      fullName: input.fullName.trim(),
      role: 'STUDENT',
      roomNumber: input.roomNumber.trim(),
      hostel: input.hostel.trim() || null,
    };
    await setDoc(doc(firestore, USER_COLLECTION, id), {
      ...profile,
      authUid: credential.user.uid,
      createdAt: Date.now(),
    });
    return profile;
  } catch (error) {
    if (createdUser) await deleteUser(createdUser).catch(() => undefined);
    throw new Error(cleanError(error));
  }
}

export async function loginStudent(userId: string, password: string) {
  const { auth: firebaseAuth, db: firestore } = requireBackend();
  const email = emailForLoginInput(userId);
  const id = userIdForEmail(email);
  if (!userId.trim() || !password) throw new Error('Enter your user ID and password.');
  try {
    let credential;
    try {
      credential = await signInWithEmailAndPassword(firebaseAuth, email, password);
    } catch (error) {
      const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : '';
      const studentId = userId.trim();
      const canTryLegacyStaffLogin = /^\d{8}$/.test(studentId)
        && (code.includes('invalid-credential') || code.includes('user-not-found'));
      if (!canTryLegacyStaffLogin) throw error;
      // Older staff/admin accounts used the student's ID at @washflow.app.
      // The role check below still blocks these legacy addresses for students.
      credential = await signInWithEmailAndPassword(firebaseAuth, `${studentId}@washflow.app`, password);
    }
    const profile = await getDoc(doc(firestore, USER_COLLECTION, id));
    if (!profile.exists()) {
      await signOut(firebaseAuth);
      throw new Error('Your account has no WashFlow profile. Ask the warden to check it.');
    }
    const value = profileFromData(profile.data(), id);
    if (value.role === 'STUDENT' && !isCstStudentEmail(credential.user.email)) {
      await signOut(firebaseAuth);
      throw new Error('Student accounts must use an email ending in .cst@rub.edu.bt.');
    }
    return value;
  } catch (error) {
    throw new Error(cleanError(error));
  }
}

function profileFromData(data: Record<string, unknown>, fallbackId: string): UserProfile {
  const role = String(data.role ?? 'STUDENT').toUpperCase();
  return {
    userId: String(data.userId ?? fallbackId),
    fullName: String(data.fullName ?? fallbackId),
    role: role === 'ADMIN' || role === 'STAFF' ? role : 'STUDENT',
    roomNumber: typeof data.roomNumber === 'string' ? data.roomNumber : null,
    hostel: typeof data.hostel === 'string' ? data.hostel : null,
  };
}

export async function loadProfile(firebaseUser: FirebaseUser) {
  const { auth: firebaseAuth, db: firestore } = requireBackend();
  const userId = firebaseUser.email ? userIdForEmail(firebaseUser.email) : undefined;
  if (!userId) throw new Error('The signed-in account does not have a WashFlow ID.');
  const profile = await getDoc(doc(firestore, USER_COLLECTION, userId));
  if (!profile.exists()) {
    await signOut(firebaseAuth);
    return null;
  }
  const value = profileFromData(profile.data(), userId);
  if (value.role === 'STUDENT' && !isCstStudentEmail(firebaseUser.email)) {
    await signOut(firebaseAuth);
    throw new Error('Student accounts must use an email ending in .cst@rub.edu.bt.');
  }
  return value;
}

export function observeAuth(callback: (firebaseUser: FirebaseUser | null) => void): Unsubscribe {
  if (!auth) {
    callback(null);
    return () => undefined;
  }
  return onAuthStateChanged(auth, callback);
}

export async function logOut() {
  if (auth) await signOut(auth);
}

function stringOr(value: unknown, fallback: string) {
  return typeof value === 'string' ? value : fallback;
}

function bookingFromData(id: string, data: Record<string, unknown>): WashBooking {
  const cycleMinutes = typeof data.cycleMinutes === 'number' ? data.cycleMinutes : 45;
  const date = stringOr(data.date, '');
  const startTime = stringOr(data.startTime, '');
  let derivedStart = 0;
  if (date && startTime) {
    const [hour, minute] = startTime.split(':').map(Number);
    if (Number.isFinite(hour) && Number.isFinite(minute)) derivedStart = new Date(`${date}T00:00:00`).getTime() + (hour * 60 + minute) * 60_000;
  }
  const startAt = typeof data.startAt === 'number' && data.startAt > 0 ? data.startAt : derivedStart;
  return {
    id,
    userId: stringOr(data.userId, ''),
    fullName: stringOr(data.fullName, ''),
    roomNumber: typeof data.roomNumber === 'string' ? data.roomNumber : null,
    machineId: stringOr(data.machineId, ''),
    date,
    startTime,
    endTime: stringOr(data.endTime, ''),
    cycle: stringOr(data.cycle ?? data.laundryType, 'Normal'),
    cycleMinutes,
    status: (stringOr(data.status, 'BOOKED').toUpperCase() as BookingStatus),
    startAt,
    endAt: typeof data.endAt === 'number' && data.endAt > 0 ? data.endAt : (startAt ? startAt + cycleMinutes * 60_000 : 0),
    createdAt: typeof data.createdAt === 'number' ? data.createdAt : 0,
  };
}

export function observeUserBookings(userId: string, callback: (items: WashBooking[]) => void, onError: (message: string) => void) {
  const { db: firestore } = requireBackend();
  return onSnapshot(query(collection(firestore, BOOKING_COLLECTION), where('userId', '==', userId)), (snapshot) => {
    callback(snapshot.docs.map((item) => bookingFromData(item.id, item.data())).sort((a, b) => b.startAt - a.startAt));
  }, (error) => onError(cleanError(error)));
}

export function observeUserNotifications(userId: string, callback: (items: UserNotification[]) => void, onError: (message: string) => void): Unsubscribe {
  const { db: firestore } = requireBackend();
  let initialized = false;
  return onSnapshot(query(collection(firestore, 'notifications'), where('userId', '==', userId)), (snapshot) => {
    if (!initialized) {
      initialized = true;
      return;
    }
    const added = snapshot.docChanges()
      .filter((change) => change.type === 'added')
      .map(({ doc: item }) => ({
        id: item.id,
        title: stringOr(item.data().title, 'WashFlow update'),
        message: stringOr(item.data().message, ''),
      }))
      .filter((item) => item.message.length > 0);
    if (added.length) callback(added);
  }, (error) => onError(cleanError(error)));
}

export function observeDateBookings(date: string, callback: (items: WashBooking[]) => void, onError: (message: string) => void) {
  const { db: firestore } = requireBackend();
  return onSnapshot(query(collection(firestore, BOOKING_COLLECTION), where('date', '==', date)), (snapshot) => {
    callback(snapshot.docs.filter((item) => !['machine-reservation', 'machine-config', 'slot-config'].includes(String(item.data().kind)))
      .map((item) => bookingFromData(item.id, item.data())));
  }, (error) => onError(cleanError(error)));
}

export function observeAllBookings(callback: (items: WashBooking[]) => void, onError: (message: string) => void) {
  const { db: firestore } = requireBackend();
  return onSnapshot(collection(firestore, BOOKING_COLLECTION), (snapshot) => {
    callback(snapshot.docs.filter((item) => !['machine-reservation', 'machine-config', 'slot-config'].includes(String(item.data().kind)))
      .map((item) => bookingFromData(item.id, item.data())).sort((a, b) => b.createdAt - a.createdAt));
  }, (error) => onError(cleanError(error)));
}

export function observeSlotTimes(callback: (items: SlotTime[]) => void, onError: (message: string) => void) {
  const { db: firestore } = requireBackend();
  return onSnapshot(query(collection(firestore, BOOKING_COLLECTION), where('kind', '==', 'slot-config')), (snapshot) => {
    const slots = new Map(DEFAULT_SLOT_TIMES.map((slot) => [slot.start, slot]));
    snapshot.docs.forEach((item) => {
      const data = item.data();
      const start = String(data.start ?? '');
      const end = String(data.end ?? '');
      if (!start || !end) return;
      if (data.removed === true) slots.delete(start);
      else slots.set(start, { start, end });
    });
    callback([...slots.values()].sort((a, b) => a.start.localeCompare(b.start)));
  }, (error) => onError(cleanError(error)));
}

export function observeMachineConfig(callback: (items: MachineInfo[]) => void, onError: (message: string) => void) {
  const { db: firestore } = requireBackend();
  return onSnapshot(query(collection(firestore, BOOKING_COLLECTION), where('kind', '==', 'machine-config')), (snapshot) => {
    const machines = new Map(MACHINE_LIST.map((machine) => [machine.id, machine]));
    snapshot.docs.forEach((item) => {
      const value = item.data();
      const id = String(value.machineId ?? '');
      if (!id) return;
      if (value.removed === true) {
        machines.delete(id);
      } else {
        machines.set(id, { id, floor: typeof value.floor === 'string' ? value.floor : undefined,
          status: value.status === 'Maintenance' ? 'Maintenance' : 'Available' });
      }
    });
    callback([...machines.values()].sort((a, b) => a.id.localeCompare(b.id)));
  }, (error) => onError(cleanError(error)));
}

export function observeUsers(callback: (items: UserProfile[]) => void, onError: (message: string) => void) {
  const { db: firestore } = requireBackend();
  return onSnapshot(collection(firestore, USER_COLLECTION), (snapshot) => {
    callback(snapshot.docs.map((item) => profileFromData(item.data(), item.id)).sort((a, b) => a.userId.localeCompare(b.userId)));
  }, (error) => onError(cleanError(error)));
}

function requireAdmin() {
  const { auth: firebaseAuth, db: firestore } = requireBackend();
  const userId = firebaseAuth.currentUser?.email ? userIdForEmail(firebaseAuth.currentUser.email) : '';
  if (!userId) throw new Error('Sign in with an admin account to manage users and machines.');
  return getDoc(doc(firestore, USER_COLLECTION, userId)).then((snapshot) => {
    if (!snapshot.exists() || String(snapshot.data().role).toUpperCase() !== 'ADMIN') {
      throw new Error('Only an admin can manage users and machines.');
    }
    return { firestore, userId };
  });
}

async function requireStaffOrAdmin() {
  const { auth: firebaseAuth, db: firestore } = requireBackend();
  const userId = firebaseAuth.currentUser?.email ? userIdForEmail(firebaseAuth.currentUser.email) : '';
  if (!userId) throw new Error('Sign in with a staff or admin account to manage bookings.');
  const snapshot = await getDoc(doc(firestore, USER_COLLECTION, userId));
  if (!snapshot.exists() || !['STAFF', 'ADMIN'].includes(String(snapshot.data().role).toUpperCase())) {
    throw new Error('Only staff and admins can update booking status.');
  }
  return { firestore, userId };
}

function machineConfigId(machineId: string) {
  return `machine-config-${machineId.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
}

export async function addMachine(machineId: string) {
  const id = machineId.trim().replace(/\s+/g, ' ');
  if (!id) throw new Error('Enter a machine name.');
  const { firestore } = await requireAdmin();
  const ref = doc(firestore, BOOKING_COLLECTION, machineConfigId(id));
  try {
    const existing = await getDoc(ref);
    const isDefault = MACHINE_LIST.some((machine) => machine.id.toLowerCase() === id.toLowerCase());
    if ((existing.exists() && existing.data().removed !== true) || (isDefault && !existing.exists())) {
      throw new Error('A machine with that name already exists.');
    }
    await setDoc(ref, { kind: 'machine-config', machineId: id, status: 'Available', removed: false, updatedAt: Date.now() });
  } catch (error) {
    throw new Error(cleanError(error));
  }
}

export async function removeMachine(machine: MachineInfo) {
  const { firestore } = await requireAdmin();
  try {
    await setDoc(doc(firestore, BOOKING_COLLECTION, machineConfigId(machine.id)), {
      kind: 'machine-config', machineId: machine.id, status: machine.status, removed: true, updatedAt: Date.now(),
    });
  } catch (error) {
    throw new Error(cleanError(error));
  }
}

export async function renameMachine(machine: MachineInfo, nextId: string) {
  const id = nextId.trim().replace(/\s+/g, ' ');
  if (!id) throw new Error('Enter a machine name.');
  if (id.toLowerCase() === machine.id.toLowerCase()) return;
  if (MACHINE_LIST.some((candidate) => candidate.id.toLowerCase() === id.toLowerCase())) {
    throw new Error('A machine with that name already exists.');
  }
  const { firestore } = await requireAdmin();
  const oldRef = doc(firestore, BOOKING_COLLECTION, machineConfigId(machine.id));
  const newRef = doc(firestore, BOOKING_COLLECTION, machineConfigId(id));
  try {
    const existing = await getDoc(newRef);
    if (existing.exists() && existing.data().removed !== true) throw new Error('A machine with that name already exists.');
    const batch = writeBatch(firestore);
    batch.set(oldRef, { kind: 'machine-config', machineId: machine.id, status: machine.status, removed: true, updatedAt: Date.now() });
    batch.set(newRef, { kind: 'machine-config', machineId: id, status: machine.status, removed: false, updatedAt: Date.now() });
    await batch.commit();
  } catch (error) {
    throw new Error(cleanError(error));
  }
}

function slotConfigId(start: string) {
  return `slot-config-${start.replace(':', '')}`;
}

export async function addSlotTime(start: string, end: string) {
  const validTime = (value: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
  const minutes = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
  if (!validTime(start) || !validTime(end) || !start.endsWith(':00') || !end.endsWith(':00') || minutes(end) - minutes(start) !== 60) {
    throw new Error('Enter a full-hour, one-hour time range, such as 14:00 to 15:00.');
  }
  const { firestore } = await requireAdmin();
  try {
    await setDoc(doc(firestore, BOOKING_COLLECTION, slotConfigId(start)), {
      kind: 'slot-config', start, end, removed: false, updatedAt: Date.now(),
    });
  } catch (error) {
    throw new Error(cleanError(error));
  }
}

export async function removeSlotTime(slot: SlotTime) {
  const { firestore } = await requireAdmin();
  try {
    await setDoc(doc(firestore, BOOKING_COLLECTION, slotConfigId(slot.start)), {
      kind: 'slot-config', start: slot.start, end: slot.end, removed: true, updatedAt: Date.now(),
    });
  } catch (error) {
    throw new Error(cleanError(error));
  }
}

export async function addManagedUser(input: { userId: string; fullName: string; password: string; role: 'STUDENT' | 'STAFF' }) {
  const userId = input.userId.trim().toLowerCase();
  const student = input.role === 'STUDENT';
  if (student ? !/^\d{8}$/.test(userId) : !/^[a-z][a-z0-9._-]{1,30}$/.test(userId)) {
    throw new Error(student ? 'Student IDs must be exactly 8 digits.' : 'Staff IDs must start with a letter and use only letters, numbers, dots, underscores, or hyphens.');
  }
  if (!input.fullName.trim()) throw new Error('Enter the user’s full name.');
  if (input.password.length < 6) throw new Error('Choose a password with at least 6 characters.');
  const { firestore } = await requireAdmin();
  const profileRef = doc(firestore, USER_COLLECTION, userId);
  if ((await getDoc(profileRef)).exists()) throw new Error('That user ID already exists.');
  const secondaryAuth = getProvisioningAuth();
  if (!secondaryAuth) throw new Error('Firebase is not configured.');
  const email = student ? `${userId}.cst@rub.edu.bt` : `${userId}@washflow.app`;
  let credential: UserCredential | null = null;
  try {
    credential = await createUserWithEmailAndPassword(secondaryAuth, email, input.password);
    const profile: UserProfile = { userId, fullName: input.fullName.trim(), role: input.role };
    await setDoc(profileRef, { ...profile, authUid: credential.user.uid, createdAt: Date.now() });
    await signOut(secondaryAuth);
    return profile;
  } catch (error) {
    if (credential?.user) await deleteUser(credential.user).catch(() => undefined);
    throw new Error(cleanError(error));
  }
}

export async function removeManagedUser(user: UserProfile, currentUserId: string) {
  if (user.role === 'ADMIN') throw new Error('Admin accounts cannot be removed here.');
  if (user.userId === currentUserId) throw new Error('You cannot remove your own account.');
  const { firestore } = await requireAdmin();
  try {
    await deleteDoc(doc(firestore, USER_COLLECTION, user.userId));
  } catch (error) {
    throw new Error(cleanError(error));
  }
}

function slotDocumentId(machineId: string, date: string, startTime: string) {
  const machine = machineId.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `machine-${machine}-${date}-${startTime.replace(':', '')}`;
}

export async function reserveMachine(input: {
  profile: UserProfile;
  machineId: string;
  date: string;
  startTime: string;
  endTime: string;
  cycle: string;
  cycleMinutes: number;
}) {
  const { db: firestore } = requireBackend();
  const slotId = slotDocumentId(input.machineId, input.date, input.startTime);
  const reservationRef = doc(firestore, BOOKING_COLLECTION, `reservation-${slotId}`);
  const bookingRef = doc(collection(firestore, BOOKING_COLLECTION));
  const [hours, minutes] = input.startTime.split(':').map(Number);
  const startAt = new Date(`${input.date}T00:00:00`).getTime() + (hours * 60 + minutes) * 60_000;
  const endAt = startAt + input.cycleMinutes * 60_000;

  try {
    await runTransaction(firestore, async (transaction) => {
      const reservation = await transaction.get(reservationRef);
      if (reservation.exists() && reservation.data()?.active === true) {
        const linkedBookingId = String(reservation.data()?.bookingId ?? '');
        if (linkedBookingId) {
          const linkedBooking = await transaction.get(doc(firestore, BOOKING_COLLECTION, linkedBookingId));
          const linkedStatus = String(linkedBooking.data()?.status ?? '').toUpperCase();
          const isStillBooked = linkedBooking.exists() && !['CANCELLED', 'COMPLETED', 'DELIVERED'].includes(linkedStatus);
          if (isStillBooked) throw new Error('That machine and time have just been booked. Choose another time.');
        }
      }

      transaction.set(reservationRef, {
        kind: 'machine-reservation',
        active: true,
        reservationId: slotId,
        bookingId: bookingRef.id,
        machineId: input.machineId,
        date: input.date,
        startTime: input.startTime,
        updatedAt: Date.now(),
      });
      transaction.set(bookingRef, {
        kind: 'wash-booking',
        bookingId: bookingRef.id,
        slotId,
        reservationId: `reservation-${slotId}`,
        userId: input.profile.userId,
        fullName: input.profile.fullName,
        roomNumber: input.profile.roomNumber ?? null,
        machineId: input.machineId,
        date: input.date,
        startTime: input.startTime,
        endTime: input.endTime,
        cycle: input.cycle,
        laundryType: input.cycle,
        cycleMinutes: input.cycleMinutes,
        itemCount: 1,
        status: 'BOOKED',
        startAt,
        endAt,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });
    await addDoc(collection(firestore, 'notifications'), {
      userId: input.profile.userId,
      title: 'Laundry slot booked',
      message: `${input.machineId} is reserved for ${input.startTime}.`,
      createdAt: Date.now(),
    });
    return { id: bookingRef.id, startAt, endAt };
  } catch (error) {
    throw new Error(cleanError(error));
  }
}

export async function cancelReservation(booking: WashBooking, userId: string) {
  const { db: firestore } = requireBackend();
  const bookingRef = doc(firestore, BOOKING_COLLECTION, booking.id);
  const reservationRef = booking.machineId && booking.date && booking.startTime
    ? doc(firestore, BOOKING_COLLECTION, `reservation-${slotDocumentId(booking.machineId, booking.date, booking.startTime)}`)
    : null;
  try {
    await runTransaction(firestore, async (transaction) => {
      const current = await transaction.get(bookingRef);
      if (!current.exists() || current.data().userId !== userId) throw new Error('This booking could not be found.');
      const status = String(current.data().status ?? '').toUpperCase();
      if (status === 'CANCELLED' || status === 'COMPLETED' || status === 'DELIVERED') throw new Error('This booking can no longer be cancelled.');
      const reservation = reservationRef ? await transaction.get(reservationRef) : null;
      transaction.update(bookingRef, { status: 'CANCELLED', updatedAt: Date.now() });
      if (reservation?.exists() && reservation.data()?.bookingId === booking.id) {
        transaction.update(reservationRef!, { active: false, updatedAt: Date.now() });
      }
    });
    await addDoc(collection(firestore, 'notifications'), {
      userId,
      title: 'Booking cancelled',
      message: `${booking.machineId} on ${booking.date} is available again.`,
      createdAt: Date.now(),
    });
  } catch (error) {
    throw new Error(cleanError(error));
  }
}

export async function clearArchivedBookings(bookings: WashBooking[], userId: string) {
  const { db: firestore } = requireBackend();
  const clearable = bookings.filter((booking) => ['CANCELLED', 'COMPLETED', 'DELIVERED'].includes(booking.status));
  try {
    for (let index = 0; index < clearable.length; index += 200) {
      const chunk = clearable.slice(index, index + 200);
      await runTransaction(firestore, async (transaction) => {
        const refs = chunk.map((booking) => doc(firestore, BOOKING_COLLECTION, booking.id));
        const snapshots = await Promise.all(refs.map((reference) => transaction.get(reference)));
        const reservationRefs = chunk.map((booking) => booking.machineId && booking.date && booking.startTime
          ? doc(firestore, BOOKING_COLLECTION, `reservation-${slotDocumentId(booking.machineId, booking.date, booking.startTime)}`)
          : null);
        const reservationSnapshots = await Promise.all(reservationRefs.map((reference) => reference ? transaction.get(reference) : Promise.resolve(null)));
        snapshots.forEach((snapshot, itemIndex) => {
          if (!snapshot.exists() || snapshot.data().userId !== userId
            || !['CANCELLED', 'COMPLETED', 'DELIVERED'].includes(String(snapshot.data().status).toUpperCase())) {
            throw new Error('A booking changed before it could be cleared. Refresh and try again.');
          }
        });
        snapshots.forEach((snapshot, itemIndex) => {
          const reservationRef = reservationRefs[itemIndex];
          const reservationSnapshot = reservationSnapshots[itemIndex];
          transaction.delete(refs[itemIndex]);
          if (reservationRef && reservationSnapshot?.exists() && reservationSnapshot.data()?.bookingId === chunk[itemIndex].id) {
            transaction.update(reservationRef, { active: false, updatedAt: Date.now() });
          }
        });
      });
    }
    return clearable.length;
  } catch (error) {
    throw new Error(cleanError(error));
  }
}

export async function updateWashStatus(booking: WashBooking, status: BookingStatus) {
  const { firestore } = await requireStaffOrAdmin();
  try {
    await updateDoc(doc(firestore, BOOKING_COLLECTION, booking.id), { status, updatedAt: Date.now() });
    await addDoc(collection(firestore, 'notifications'), {
      userId: booking.userId,
      title: `Laundry ${status.toLowerCase()}`,
      message: `${booking.machineId} status changed to ${status.toLowerCase()}.`,
      createdAt: Date.now(),
    });
  } catch (error) {
    throw new Error(cleanError(error));
  }
}

export async function updateOwnProfile(profile: UserProfile, input: { fullName: string; roomNumber: string; hostel: string }) {
  const { auth: firebaseAuth, db: firestore } = requireBackend();
  const currentId = firebaseAuth.currentUser?.email ? userIdForEmail(firebaseAuth.currentUser.email) : '';
  if (currentId !== profile.userId) throw new Error('You can only edit your own profile.');
  if (!input.fullName.trim()) throw new Error('Enter your name.');
  try {
    const values = {
      fullName: input.fullName.trim(),
      ...(profile.role === 'STUDENT' ? { roomNumber: input.roomNumber.trim(), hostel: input.hostel.trim() || null } : {}),
    };
    await updateDoc(doc(firestore, USER_COLLECTION, profile.userId), values);
    return { ...profile, ...values };
  } catch (error) {
    throw new Error(cleanError(error));
  }
}

export async function changeOwnPassword(currentPassword: string, nextPassword: string) {
  const { auth: firebaseAuth } = requireBackend();
  const user = firebaseAuth.currentUser;
  if (!user?.email) throw new Error('Sign in again before changing your password.');
  if (!currentPassword) throw new Error('Enter your current password.');
  if (nextPassword.length < 6) throw new Error('Choose a new password with at least 6 characters.');
  try {
    const credential = EmailAuthProvider.credential(user.email, currentPassword);
    await reauthenticateWithCredential(user, credential);
    await updatePassword(user, nextPassword);
  } catch (error) {
    const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : '';
    if (code.includes('wrong-password') || code.includes('invalid-credential')) throw new Error('Your current password is incorrect.');
    throw new Error(cleanError(error));
  }
}

export async function setMachineMaintenance(machine: MachineInfo, status: 'Available' | 'Maintenance') {
  const { firestore } = await requireAdmin();
  const id = `machine-config-${machine.id.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  try {
    await setDoc(doc(firestore, BOOKING_COLLECTION, id), {
      kind: 'machine-config',
      machineId: machine.id,
      ...(machine.floor ? { floor: machine.floor } : {}),
      status,
      updatedAt: Date.now(),
    });
  } catch (error) {
    throw new Error(cleanError(error));
  }
}
