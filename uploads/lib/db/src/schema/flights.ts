import { pgTable, text, serial, integer, timestamp, real, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const activeFlightsTable = pgTable("active_flights", {
  id: serial("id").primaryKey(),
  hex: text("hex").notNull(),
  registration: text("registration").notNull(),
  callsign: text("callsign"),
  startTime: timestamp("start_time", { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  latitude: real("latitude"),
  longitude: real("longitude"),
  altitude: integer("altitude"),
  speed: real("speed"),
  track: real("track"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const flightHistoryTable = pgTable("flight_history", {
  id: serial("id").primaryKey(),
  hex: text("hex").notNull(),
  registration: text("registration").notNull(),
  startTime: timestamp("start_time", { withTimezone: true }).notNull(),
  endTime: timestamp("end_time", { withTimezone: true }).notNull(),
  durationSeconds: integer("duration_seconds").notNull(),
  maxAltitude: integer("max_altitude"),
  maxSpeed: real("max_speed"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const pollLogsTable = pgTable("poll_logs", {
  id: serial("id").primaryKey(),
  polledAt: timestamp("polled_at", { withTimezone: true }).notNull().defaultNow(),
  isAirborne: boolean("is_airborne").notNull(),
  rawData: text("raw_data"),
  errorMessage: text("error_message"),
});

export const positionBreadcrumbsTable = pgTable("position_breadcrumbs", {
  id: serial("id").primaryKey(),
  hex: text("hex").notNull(),
  registration: text("registration").notNull(),
  latitude: real("latitude").notNull(),
  longitude: real("longitude").notNull(),
  altitude: integer("altitude"),
  speed: real("speed"),
  track: real("track"),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertPositionBreadcrumbSchema = createInsertSchema(positionBreadcrumbsTable).omit({ id: true });
export type InsertPositionBreadcrumb = z.infer<typeof insertPositionBreadcrumbSchema>;
export type PositionBreadcrumb = typeof positionBreadcrumbsTable.$inferSelect;

export const insertActiveFlightSchema = createInsertSchema(activeFlightsTable).omit({ id: true, createdAt: true, updatedAt: true });
export const insertFlightHistorySchema = createInsertSchema(flightHistoryTable).omit({ id: true, createdAt: true });
export const insertPollLogSchema = createInsertSchema(pollLogsTable).omit({ id: true });

export type InsertActiveFlight = z.infer<typeof insertActiveFlightSchema>;
export type ActiveFlight = typeof activeFlightsTable.$inferSelect;
export type InsertFlightHistory = z.infer<typeof insertFlightHistorySchema>;
export type FlightHistory = typeof flightHistoryTable.$inferSelect;
export type InsertPollLog = z.infer<typeof insertPollLogSchema>;
export type PollLog = typeof pollLogsTable.$inferSelect;
