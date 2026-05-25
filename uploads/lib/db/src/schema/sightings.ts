import { pgTable, serial, text, real, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const sightingsTable = pgTable("sightings", {
  id: serial("id").primaryKey(),
  latitude: real("latitude").notNull(),
  longitude: real("longitude").notNull(),
  kind: text("kind").notNull(),
  note: text("note"),
  reporterId: text("reporter_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

export const insertSightingSchema = createInsertSchema(sightingsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertSighting = z.infer<typeof insertSightingSchema>;
export type Sighting = typeof sightingsTable.$inferSelect;
