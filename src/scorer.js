const { haversineKm } = require("./haversine");

// ─── Weights ────────────────────────────────────────────────────────────────
const WEIGHT_PROXIMITY = 1.5;  // highest — distance dominates for short trips
const WEIGHT_PREFERENCE = 1.0;
const WEIGHT_CROWD = 1.0;
const WEIGHT_TIME_COST = 1.0;

const CROWD_SCORES = { low: 30, medium: 15, high: 0 };
const WALK_SPEED_KMH = 4.5;

// ─── Phase 1: Filter ────────────────────────────────────────────────────────

function filter(places, user) {
    const avoidSet = new Set((user.avoid || []).map((a) => a.toLowerCase()));
    const avoidCrowded = avoidSet.has("crowded");

    return places.filter((place) => {
        const type = (place.type || "").toLowerCase();

        // Hard constraint: avoid crowded places
        if (avoidCrowded && place.crowd_level === "high") {
            return false;
        }

        // Hard constraint: avoid specific place types
        if (avoidSet.has(type)) {
            return false;
        }

        return true;
    });
}

// ─── Phase 2: Score ─────────────────────────────────────────────────────────

function scoreAndRank(places, startLocation, user) {
    // preferences: match against type OR crowd vibe tags ("quiet" → low crowd)
    const prefSet = new Set((user.preferences || []).map((p) => p.toLowerCase()));

    const scored = places.map((place) => {
        const placeLocation = { lat: place.lat, lng: place.lng };
        const distKm = haversineKm(startLocation, placeLocation);
        const type = (place.type || "").toLowerCase();

        // Proximity: closer = higher score
        const proximityScore = Math.max(0, 100 - distKm * 10) * WEIGHT_PROXIMITY;

        // Preference: bonus if type matches any tag, or "quiet" preference + low crowd
        const typeMatch = prefSet.has(type);
        const quietMatch = prefSet.has("quiet") && place.crowd_level === "low";
        const walkMatch = prefSet.has("walk") && type === "park";
        const coffeeMatch = prefSet.has("coffee") && type === "cafe";
        const preferenceScore =
            (typeMatch || quietMatch || walkMatch || coffeeMatch ? 30 : 0) * WEIGHT_PREFERENCE;

        // Crowd: prefer quieter places
        const crowdScore = (CROWD_SCORES[place.crowd_level] ?? 0) * WEIGHT_CROWD;

        // Time cost: mild penalty for long dwell (opportunity cost)
        const timeCostPenalty =
            ((place.avg_duration_minutes / 60) * 5) * WEIGHT_TIME_COST;

        const score = proximityScore + preferenceScore + crowdScore - timeCostPenalty;

        return { ...place, _distKm: distKm, score };
    });

    // Sort descending by score; tie-break alphabetically by id
    scored.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return a.id.localeCompare(b.id);
    });

    return scored;
}

// ─── Travel time helper ──────────────────────────────────────────────────────

function travelMinutes(from, to) {
    return (haversineKm(from, to) / WALK_SPEED_KMH) * 60;
}

module.exports = { filter, scoreAndRank, travelMinutes, WALK_SPEED_KMH };
