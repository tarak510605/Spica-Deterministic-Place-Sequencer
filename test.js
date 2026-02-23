/**
 * test.js — Automated test suite (zero external dependencies)
 *
 * Run: node test.js
 * Exit code 0 = all passed, 1 = any failure.
 */

"use strict";

const { haversineKm } = require("./src/haversine");
const { filter, scoreAndRank } = require("./src/scorer");
const { sequence, parseTime, permutations, simulatePermutation } = require("./src/sequencer");

// ─── Tiny test runner ────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;

function test(name, fn) {
    try {
        fn();
        console.log(`  ✅ ${name}`);
        passed++;
    } catch (e) {
        console.error(`  ❌ ${name}`);
        console.error(`     ${e.message}`);
        failed++;
    }
}

function assert(condition, msg) { if (!condition) throw new Error(msg || "Assertion failed"); }
function assertEqual(a, b, msg) { if (a !== b) throw new Error(`${msg}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }
function assertDeepEqual(a, b, msg) { const sa = JSON.stringify(a), sb = JSON.stringify(b); if (sa !== sb) throw new Error(`${msg}: expected ${sb}, got ${sa}`); }

// ─── Fixtures ────────────────────────────────────────────────────────────────
const START = { lat: 12.9716, lng: 77.5946 };
const START_TIME = parseTime("10:30");   // 630 minutes (matches PDF sample)
const BUDGET = 300;

// Builds a place matching the PDF schema
function makePlace(id, type, lat, lng, openFrom, openTo, crowd, duration) {
    return {
        id,
        name: `Place ${id}`,
        type,
        lat,
        lng,
        avg_duration_minutes: duration,
        crowd_level: crowd,
        open_from: openFrom,
        open_to: openTo,
    };
}

// PDF sample user
const USER = {
    lat: 12.9716, lng: 77.5946,
    time_available_minutes: 300,
    preferences: ["coffee", "walk", "quiet", "books"],
    avoid: ["crowded"],
    start_time: "10:30",
};

// PDF sample places
const PDF_PLACES = [
    makePlace("p1", "cafe", 12.9721, 77.5950, "08:00", "20:00", "medium", 45),
    makePlace("p2", "park", 12.9730, 77.5932, "05:00", "19:00", "low", 40),
    makePlace("p3", "shopping", 12.9700, 77.5960, "11:00", "22:00", "high", 60),
    makePlace("p4", "bookstore", 12.9705, 77.5928, "10:00", "21:00", "low", 30),
];

// ─── 1. Haversine ─────────────────────────────────────────────────────────────
console.log("\n1. Haversine distance");

test("same point → 0 km", () => {
    assert(haversineKm(START, START) < 0.001);
});

test("known approximate distance (Bangalore to Chennai ~290 km)", () => {
    const d = haversineKm({ lat: 12.9716, lng: 77.5946 }, { lat: 13.0827, lng: 80.2707 });
    assert(d > 260 && d < 320, `Expected ~290km, got ${d.toFixed(1)}`);
});

test("distance is symmetric", () => {
    const a = { lat: 12.97, lng: 77.59 }, b = { lat: 12.95, lng: 77.58 };
    assert(Math.abs(haversineKm(a, b) - haversineKm(b, a)) < 0.0001);
});

// ─── 2. Filter ────────────────────────────────────────────────────────────────
console.log("\n2. Filter (Phase 1)");

test("'crowded' in avoid removes crowd_level:high places", () => {
    const result = filter(PDF_PLACES, USER);
    assert(!result.some(p => p.id === "p3"), "Market (high crowd) should be filtered out");
});

test("type-based avoid removes places of that type", () => {
    const user = { ...USER, avoid: ["shopping"] };
    const result = filter(PDF_PLACES, user);
    assert(!result.some(p => p.type === "shopping"), "Shopping type should be excluded");
});

test("nothing in avoid keeps all places", () => {
    const result = filter(PDF_PLACES, { ...USER, avoid: [] });
    assertEqual(result.length, PDF_PLACES.length, "All places kept when avoid is empty");
});

test("avoid matching is case-insensitive", () => {
    const places = [makePlace("x1", "Bar", 12.97, 77.59, "12:00", "23:00", "medium", 60)];
    const result = filter(places, { ...USER, avoid: ["bar"] });
    assertEqual(result.length, 0, "Case-insensitive type avoid should filter 'Bar'");
});

// ─── 3. Scorer ────────────────────────────────────────────────────────────────
console.log("\n3. Scorer (Phase 2)");

test("'walk' preference gives park a bonus", () => {
    const park = makePlace("pa", "park", 12.9716, 77.5946, "05:00", "19:00", "low", 40);
    const store = makePlace("st", "shopping", 12.9716, 77.5946, "10:00", "22:00", "low", 40);
    const scored = scoreAndRank([store, park], START, { ...USER, preferences: ["walk"] });
    assertEqual(scored[0].id, "pa", "Park should rank higher with 'walk' preference");
});

test("'quiet' preference gives low-crowd places a bonus", () => {
    const quiet = makePlace("q1", "cafe", 12.9716, 77.5946, "08:00", "20:00", "low", 45);
    const loud = makePlace("q2", "cafe", 12.9716, 77.5946, "08:00", "20:00", "medium", 45);
    const scored = scoreAndRank([loud, quiet], START, { ...USER, preferences: ["quiet"] });
    assertEqual(scored[0].id, "q1", "Quiet place should rank higher");
});

test("low crowd beats high crowd at same distance", () => {
    const lo = makePlace("lo", "cafe", 12.971, 77.594, "08:00", "20:00", "low", 45);
    const hi = makePlace("hi", "cafe", 12.971, 77.594, "08:00", "20:00", "high", 45);
    const scored = scoreAndRank([lo, hi], START, { ...USER, preferences: [] });
    assertEqual(scored[0].id, "lo", "Low crowd should score higher");
});

test("tie-break is alphabetical by id", () => {
    const p1 = makePlace("aaa", "cafe", 12.9716, 77.5946, "08:00", "20:00", "low", 45);
    const p2 = makePlace("zzz", "cafe", 12.9716, 77.5946, "08:00", "20:00", "low", 45);
    const scored = scoreAndRank([p2, p1], START, { ...USER, preferences: [] });
    assertEqual(scored[0].id, "aaa", "Alphabetically first id should win tie");
});

// ─── 4. Permutations ─────────────────────────────────────────────────────────
console.log("\n4. Permutations helper");

test("permutations of 1 element", () => { assertDeepEqual(permutations([1]), [[1]], ""); });
test("permutations of 2 elements gives 2 results", () => { assertEqual(permutations([1, 2]).length, 2, ""); });
test("permutations of 3 elements gives 6 results", () => { assertEqual(permutations([1, 2, 3]).length, 6, ""); });
test("all permutations of [a,b,c] contain all elements", () => {
    for (const p of permutations(["a", "b", "c"])) {
        assert(p.includes("a") && p.includes("b") && p.includes("c"), "Each perm must have all elements");
    }
});

// ─── 5. Simulate permutation ──────────────────────────────────────────────────
console.log("\n5. Simulate permutation");

test("valid sequence passes simulation", () => {
    const places = [
        makePlace("p1", "cafe", 12.9716, 77.5946, "08:00", "20:00", "low", 30),
        makePlace("p2", "park", 12.9720, 77.5950, "05:00", "19:00", "low", 30),
    ];
    const res = simulatePermutation(places, START, START_TIME, BUDGET);
    assert(res.valid, "Should be valid");
});

test("place not yet open at arrival → invalid", () => {
    // Opens at 14:00 but we arrive at ~10:30 (right next door)
    const places = [makePlace("p1", "cafe", 12.9716, 77.5946, "14:00", "21:00", "low", 30)];
    assert(!simulatePermutation(places, START, START_TIME, BUDGET).valid,
        "Should fail: arrives before opening");
});

test("place closes too early → invalid", () => {
    // Opens 10:30, closes 10:40, but dwell is 30 min
    const places = [makePlace("p1", "cafe", 12.9716, 77.5946, "10:30", "10:40", "low", 30)];
    assert(!simulatePermutation(places, START, START_TIME, BUDGET).valid,
        "Should fail: wouldn't finish before closing");
});

test("over budget → invalid", () => {
    const places = [
        makePlace("p1", "cafe", 12.9716, 77.5946, "08:00", "23:00", "low", 100),
        makePlace("p2", "park", 12.9720, 77.5950, "08:00", "23:00", "low", 100),
    ];
    assert(!simulatePermutation(places, START, START_TIME, 10).valid,
        "Should fail: over budget");
});

// ─── 6. Full pipeline ─────────────────────────────────────────────────────────
console.log("\n6. Full pipeline");

test("'crowded' avoid removes p3 (high crowd) before scoring", () => {
    const filtered = filter(PDF_PLACES, USER);
    assert(!filtered.some(p => p.id === "p3"), "p3 (high crowd, avoid:crowded) must be excluded");
});

test("full pipeline produces a valid sequence from PDF sample data", () => {
    const filtered = filter(PDF_PLACES, USER);
    const scored = scoreAndRank(filtered, START, USER);
    const result = sequence(scored, START, START_TIME, BUDGET);
    assert(result !== null, "Should produce a result");
    assert(result.sequence.length >= 2, "Should have at least 2 places");
    assert(result.totalMinutes <= BUDGET, "Should be within budget");
});

test("no valid sequence returns null", () => {
    const places = [
        makePlace("n1", "cafe", 12.97, 77.59, "23:00", "23:30", "low", 20),
        makePlace("n2", "park", 12.96, 77.58, "23:00", "23:30", "low", 20),
    ];
    const filtered = filter(places, { ...USER, avoid: [] });
    const scored = scoreAndRank(filtered, START, { ...USER, preferences: [] });
    const result = sequence(scored, START, START_TIME, BUDGET);
    assert(result === null, "Should return null when no valid itinerary");
});

// ─── 7. Determinism ───────────────────────────────────────────────────────────
console.log("\n7. Determinism");

test("same input always produces identical output (10 runs)", () => {
    const filtered = filter(PDF_PLACES, USER);
    const getKey = () => {
        const scored = scoreAndRank(filtered, START, USER);
        const result = sequence(scored, START, START_TIME, BUDGET);
        return result ? JSON.stringify(result.sequence.map(p => p.id)) : null;
    };
    const first = getKey();
    assert(first !== null, "First run must produce a result");
    for (let i = 1; i < 10; i++) {
        assert(getKey() === first, `Run ${i} produced a different output`);
    }
});

// ─── Summary ──────────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) { console.error("Some tests failed."); process.exit(1); }
else console.log("All tests passed ✅");
