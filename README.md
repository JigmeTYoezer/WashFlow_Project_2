# WashFlow Project II

Expo and React Native TypeScript app for the CST hostel laundry booking proposal.

## Run it

```sh
npm start
```

Scan the Expo Go QR code from an Android or iOS device. The local Firebase settings are stored in the ignored `.env.local` file and started from the Project I archive. Expo's Firebase JavaScript SDK needs a Web app config: if this Firebase project does not already have a Web app, register one in Firebase Console and replace the matching values in `.env.local`. Also enable Email/Password under Authentication and make sure Firestore is active. Restart Expo after changing settings.

## Working flows

- Student registration and sign-in through Firebase Authentication. Student accounts must use an 8-digit ID followed by `.cst@rub.edu.bt` (for example, `12345678.cst@rub.edu.bt`); students can then sign in using just the 8-digit ID. Staff/admin sign in with the username before `@washflow.app` (for example, `staff01` or `admin`). Students with an older Project I `@washflow.app` login need to create a new CST email account. The 8-digit prefix maps to the existing student ID so prior booking records remain associated.
- Live machine, booking, and staff dashboard updates through Firestore listeners.
- Machine and time selection over the next five days, with a Firestore transaction and unique reservation record preventing simultaneous bookings for the same machine and start time.
- One-hour default slots run 5–6 pm and 7–11 pm on weekdays, and 10 am–12 pm, 1–6 pm, and 7–11 pm on weekends; admin custom slots are also one hour.
- Cancellation that releases the reserved time, plus local reminders 15 minutes before a wash and at its expected end.
- Wash progress calculated from the booking start time and selected cycle length.
- Staff dashboards provide Bookings and Machines tabs; staff see today's bookings and update wash statuses.
- Admin dashboards provide Bookings, Machines, Reports, and Users tabs. Admins can add, rename, remove, and set machines as available or under maintenance; manage booking slot times; view daily booking totals; add staff profiles; and remove student or staff WashFlow profiles.
- All account roles can edit their profile, change their password, and log out from the Profile tab.

New Project II machine reservations and machine settings are stored as tagged documents in the existing Firestore `bookings` collection. This keeps Project I's existing `slots` data and slot seeder untouched. Machine settings and reservations are filtered out of booking lists.

New accounts are students. To enable staff/admin tools for an account, an administrator must set that account's `role` field to `STAFF` or `ADMIN` in Firestore. Email/password sign-in must be enabled in the Firebase project. No default admin credentials are embedded in the app.

The existing Project I Firestore rules allow any signed-in account to read and write the shared collections. That supports a supervised classroom demo, but backend role and ownership checks should be tightened before using real student records.

Removing a user removes their WashFlow profile, which blocks sign-in through the app. Firebase Authentication does not let one client delete another user's underlying authentication account; full account deletion requires a trusted server-side Firebase Admin operation.

The starter screens have been replaced with Firebase-backed data. Firebase configuration is local and ignored by Git; the source Project I ZIP and its Firebase file remain unchanged.
