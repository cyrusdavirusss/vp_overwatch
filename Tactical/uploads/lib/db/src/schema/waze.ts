import { pgTable, serial, text, real, timestamp, integer, index } from "drizzle-orm/pg-core";

export const wazeAlertsTable = pgTable(
  "waze_alerts",
  {
    id: serial("id").primaryKey(),
    wazeUuid: text("waze_uuid").notNull().unique(),
    type: text("type").notNull(),
    subtype: text("subtype"),
    latitude: real("latitude").notNull(),
    longitude: real("longitude").notNull(),
    street: text("street"),
    city: text("city"),
    country: text("country"),
    reliability: integer("reliability"),
    confidence: integer("confidence"),
    nThumbsUp: integer("n_thumbs_up"),
    reportedAt: timestamp("reported_at", { withTimezone: true }).notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => ({
    expiresAtIdx: index("waze_alerts_expires_at_idx").on(t.expiresAt),
    typeIdx: index("waze_alerts_type_idx").on(t.type),
  }),
);

export type WazeAlert = typeof wazeAlertsTable.$inferSelect;
