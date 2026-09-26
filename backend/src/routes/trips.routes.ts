/**
 * Travelog MVP1 — Trips Routes
 */

import { Router } from "express";
import tripsController from "../controllers/trips.controller.js";

const router = Router();

// GET /trips — list trips (paginated, filterable)
router.get("/", tripsController.listTrips);

// POST /trips — create a trip manually
router.post("/", tripsController.createTrip);

// GET /trips/export — CSV export of all active trips
// (registered before /:tripId so "export" is not treated as an id)
router.get("/export", tripsController.exportTripsCsv);

// GET /trips/map — panoramic overview map of all active trips
// (registered before /:tripId so "map" is not treated as an id)
router.get("/map", tripsController.getTripsOverviewMap);

// POST /trips/map/recalculate — rebuild the cached overview aggregation
router.post("/map/recalculate", tripsController.recalculateTripsOverviewMap);

// GET /trips/:tripId/ics — ICS (iCalendar) export of a single trip
// (registered before /:tripId so "ics" is not treated as an id)
router.get("/:tripId/ics", tripsController.exportTripIcs);

// GET /trips/:tripId — get trip details
router.get("/:tripId", tripsController.getTrip);

// PATCH /trips/:tripId — update a trip
router.patch("/:tripId", tripsController.updateTrip);

// PUT /trips/:tripId/days — replace the manual days of a trip
router.put("/:tripId/days", tripsController.replaceTripDays);

// DELETE /trips/:tripId — explicitly delete a trip
router.delete("/:tripId", tripsController.deleteTrip);

// Map visualization data — MUST be before the catch-all params routes above
// However since :tripId is at the end of the path and map is after it, this
// order works correctly (longer paths match first).
router.get("/:tripId/map", tripsController.getTripMap);

export default router;
