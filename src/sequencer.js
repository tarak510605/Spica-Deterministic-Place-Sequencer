const { travelMinutes } = require("./scorer");
const { haversineKm } = require("./haversine");

const MAX_PLACES = 3;
const MIN_PLACES = 2;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Parse "HH:MM" into total minutes since midnight.
 */
function parseTime(hhmm) {
    const [h, m] = hhmm.split(":").map(Number);
    return h * 60 + m;
}

/**
 * Generate all permutations of an array.
 * For N≤3 produces at most 6 orderings.
 */
function permutations(arr) {
    if (arr.length <= 1) return [arr];
    const result = [];
    for (let i = 0; i < arr.length; i++) {
        const rest = [...arr.slice(0, i), ...arr.slice(i + 1)];
        for (const p of permutations(rest)) {
            result.push([arr[i], ...p]);
        }
    }
    return result;
}

// ─── Phase 3: Select ─────────────────────────────────────────────────────────
function selectCandidates(scoredPlaces) {
    return scoredPlaces.slice(0, MAX_PLACES);
}

// ─── Phase 4: Sequence ───────────────────────────────────────────────────────
/**
 * Simulate one permutation and determine if it is feasible.
 *
 * @param {object[]} orderedPlaces
 * @param {object}   startLocation  { lat, lng }
 * @param {number}   startMinutes   minutes since midnight
 * @param {number}   budgetMinutes
 */
function simulatePermutation(orderedPlaces, startLocation, startMinutes, budgetMinutes) {
    let currentPos = startLocation;
    let currentTime = startMinutes;
    let totalTravelKm = 0;
    let totalMinutes = 0;

    for (const place of orderedPlaces) {
        const placeLocation = { lat: place.lat, lng: place.lng };
        const travelMins = travelMinutes(currentPos, placeLocation);
        const arrivalTime = currentTime + travelMins;
        const departureTime = arrivalTime + place.avg_duration_minutes;

        const openFrom = parseTime(place.open_from);
        const openTo = parseTime(place.open_to);

        // Hard constraint: must arrive after opening
        if (arrivalTime < openFrom) return { valid: false };

        // Hard constraint: must depart before closing
        if (departureTime > openTo) return { valid: false };

        // Hard constraint: cumulative time must stay within budget
        totalMinutes += travelMins + place.avg_duration_minutes;
        if (totalMinutes > budgetMinutes) return { valid: false };

        totalTravelKm += haversineKm(currentPos, placeLocation);
        currentPos = placeLocation;
        currentTime = departureTime;
    }

    return { valid: true, totalTravelKm, totalMinutes };
}


function findBestSequence(candidates, startLocation, startMinutes, budgetMinutes) {
    const allPerms = permutations(candidates);

    let bestPerm = null;
    let bestTravelKm = Infinity;
    let bestTotalMins = 0;
    let bestKey = null;

    for (const perm of allPerms) {
        const result = simulatePermutation(perm, startLocation, startMinutes, budgetMinutes);
        if (!result.valid) continue;

        const key = perm.map((p) => p.id).join(",");
        const isBetter =
            result.totalTravelKm < bestTravelKm ||
            (result.totalTravelKm === bestTravelKm && key < bestKey);

        if (isBetter) {
            bestPerm = perm;
            bestTravelKm = result.totalTravelKm;
            bestTotalMins = result.totalMinutes;
            bestKey = key;
        }
    }

    if (!bestPerm) return null;
    return { sequence: bestPerm, totalMinutes: Math.round(bestTotalMins) };
}

// ─── Public API ──────────────────────────────────────────────────────────────
function sequence(scoredPlaces, startLocation, startMinutes, budgetMinutes) {
    const candidates = selectCandidates(scoredPlaces);
    if (candidates.length < MIN_PLACES) return null;
    return findBestSequence(candidates, startLocation, startMinutes, budgetMinutes);
}

module.exports = { sequence, parseTime, permutations, simulatePermutation };
