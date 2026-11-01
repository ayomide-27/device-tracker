// Numbers that tune how the phone behaves. Change one here and the whole app follows.
// (window.__FOT_TEST_CONFIG__ is a hook so automated tests can use short timers.)
export const CFG = Object.freeze({
  // Tracking
  MIN_SECONDS_BETWEEN_POINTS: 15, // never save readings closer together in time than this...
  MIN_METRES_BETWEEN_POINTS: 10, // ...unless the phone moved at least this far
  STILL_POINT_EVERY_SECONDS: 60, // standing still: still save one reading this often
  MAX_ACCURACY_METRES: 200, // readings vaguer than this are shown but not saved
  MAX_QUEUED_POINTS: 20000, // most readings kept on the phone while offline

  // Uploading
  UPLOAD_EVERY_SECONDS: 10,
  PING_EVERY_SECONDS: 30, // "I'm alive" message when there is nothing to send
  BATCH_SIZE: 200,
  REQUEST_TIMEOUT_MS: 15000,

  // Check-ins
  MAX_FIX_AGE_SECONDS: 15, // a reading older than this is not used to start a check-in
  CHECKIN_WAIT_SECONDS: 30, // after this long without a precise fix, allow saving a weak one (flagged)
  DEFAULT_VISIT_ACCURACY_M: 50, // replaced by the server's rule once the plan has loaded
  KEEP_SENT_CHECKINS_DAYS: 3,
  PHOTO_MAX_EDGE: 1000,
  PHOTO_MAX_BYTES: 550_000, // server limit is 600 KB

  // Plan
  PLAN_REFRESH_SECONDS: 300,

  ...(globalThis.__FOT_TEST_CONFIG__ ?? {}),
});
