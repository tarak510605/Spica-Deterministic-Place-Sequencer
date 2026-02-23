/**
 * index.js — CLI entry point
 *
 * Usage:
 *   node index.js
 *   node index.js --input data/input.json
 *
 * Reads a single JSON file matching the assignment spec:
 *   { user: { lat, lng, time_available_minutes, preferences, avoid, start_time }, places: [...] }
 *
 * Prints the result as JSON to stdout.
 */

"use strict";

const fs = require("fs");
const path = require("path");

const { filter, scoreAndRank } = require("./src/scorer");
const { sequence, parseTime } = require("./src/sequencer");

// ─── Parse CLI args ───────────────────────────────────────────────────────────
function getArg(flag, defaultVal) {
    const idx = process.argv.indexOf(flag);
    return idx !== -1 ? process.argv[idx + 1] : defaultVal;
}

const inputFile = getArg("--input", path.join(__dirname, "data", "input.json"));

// ─── Load data ────────────────────────────────────────────────────────────────
const { user, places } = JSON.parse(fs.readFileSync(inputFile, "utf8"));

const startLocation = { lat: user.lat, lng: user.lng };
const startMinutes = parseTime(user.start_time);
const budget = user.time_available_minutes;

// ─── Pipeline ─────────────────────────────────────────────────────────────────
// Phase 1: Filter (avoid constraints that are order-invariant)
const candidates = filter(places, user);

if (candidates.length === 0) {
    console.error("No candidates remain after filtering.");
    process.exit(1);
}

// Phase 2: Score and rank
const scored = scoreAndRank(candidates, startLocation, user);

// Phase 3 + 4: Select top-3 and find best valid sequence via permutation search
const result = sequence(scored, startLocation, startMinutes, budget);

if (!result) {
    console.error(
        "No valid itinerary found. All permutations violated at least one hard constraint."
    );
    process.exit(1);
}

// ─── Build explanation per place ──────────────────────────────────────────────
function buildExplanation(place, index) {
    const parts = [];

    if (index === 0) parts.push("first stop");
    else parts.push(`stop ${index + 1}`);

    // Explain why it matched preferences
    const prefs = (user.preferences || []).map((p) => p.toLowerCase());
    if (prefs.includes(place.type)) parts.push(`matches your preference for ${place.type}`);
    if (prefs.includes("coffee") && place.type === "cafe") parts.push("matches your coffee preference");
    if (prefs.includes("walk") && place.type === "park") parts.push("great for a walk");
    if (prefs.includes("quiet") && place.crowd_level === "low") parts.push("quiet environment");

    parts.push(`crowd level is ${place.crowd_level}`);
    parts.push(`~${place.avg_duration_minutes} min visit`);

    return `${place.name}: ${[...new Set(parts)].join(", ")}.`;
}

// ─── Output ───────────────────────────────────────────────────────────────────
const explanation = {};
result.sequence.forEach((place, i) => {
    explanation[place.id] = buildExplanation(place, i);
});

const output = {
    sequence: result.sequence.map((p) => p.id),
    total_time_minutes: result.totalMinutes,
    explanation,
};

console.log(JSON.stringify(output, null, 2));
