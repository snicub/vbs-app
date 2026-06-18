/**
 * App-level domain types. Mirrors the database schema closely but
 * intentionally separate so the schema and the UI can evolve independently.
 * The Supabase-generated types live in src/lib/supabase/types.ts.
 */

export type UserRole =
  | "parent"
  | "driver"
  | "aide"
  | "table_volunteer"
  | "coordinator"
  | "admin";

export type TransportMode =
  | "van"
  | "parent_dropoff_only"
  | "parent_pickup_only"
  | "parent_both";

export type RouteDirection = "am" | "pm";

export type ConsentKind =
  | "media_release"
  | "medical"
  | "transport"
  | "general_liability"
  | "photo_release";

export type Family = {
  id: string;
  primaryGuardianName: string;
  primaryEmail: string;
  primaryPhone: string;
  streetAddress: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  lat: number | null;
  lng: number | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  emergencyContactRelationship: string | null;
  notes: string | null;
  smsOptedOutAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type Guardian = {
  id: string;
  familyId: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  relationship: string | null;
  userId: string | null;
};

export type Student = {
  id: string;
  familyId: string;
  legalFirstName: string;
  legalLastName: string;
  preferredFirstName: string | null;
  dob: string | null;
  ageAtRegistration: number | null;
  grade: string | null;
  allergies: string | null;
  medicalNotes: string | null;
  photoPath: string | null;
  wristbandCode: string;
};

export type Stop = {
  id: string;
  name: string;
  town: string;
  streetAddress: string | null;
  lat: number | null;
  lng: number | null;
  colorCode: string;
  colorName: string;
  scheduledAmTime: string;
  scheduledPmTime: string;
  notes: string | null;
  sortOrder: number;
};

export type Van = {
  id: string;
  name: string;
  capacity: number;
  plate: string | null;
  notes: string | null;
  active: boolean;
};

export type Route = {
  id: string;
  vanId: string;
  direction: RouteDirection;
  stopIds: string[];
};

export type StudentDayStatus = {
  recordId: string;
  studentId: string;
  eventDate: string;
  attending: boolean;
  mode: TransportMode;
  morningStopId: string | null;
  afternoonStopId: string | null;
  state: import("@/lib/events/state-machine").DayState;
  lastEventId: string | null;
  lastEventType: import("@/lib/events/state-machine").EventType | null;
  lastEventAt: string | null;
  morningVanId: string | null;
  afternoonVanId: string | null;
  scheduledAmTime: string | null;
  scheduledPmTime: string | null;
  wristbandColorForDay: string | null;
  wristbandColorName: string | null;
  isLateAm: boolean;
  isBoardedButNotArrived: boolean;
  isInButNotOut: boolean;
  isPmVanStuck: boolean;
};

export type RecordEventResult = {
  eventId: string;
  derivedState: import("@/lib/events/state-machine").DayState;
  wasIdempotent: boolean;
  wasOverride: boolean;
};
