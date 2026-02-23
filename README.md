# Place Sequencer — Spica Take-Home Assignment

A deterministic itinerary planner. Given a starting location, time budget, start time, and user preferences, it selects 2–3 places and sequences them optimally.

## Run

```bash
# Main output
node index.js

# With custom input files
node index.js --places data/places.json --input data/input.json

# Tests (zero dependencies)
node test.js
```

No `npm install` needed. Pure Node.js.

---

## Design Overview

### Pipeline

```
Input → [Phase 1: Filter] → [Phase 2: Score] → [Phase 3: Select Top-3] → [Phase 4: Sequence] → Output
```

### Phase 1 — Filter (Hard, Order-Invariant)
Only removes places that are **invalid regardless of ordering**:
- Category is in user's `avoid` list

Opening hours and time budget are **not** checked here — they depend on the actual arrival time, which varies by ordering. Filtering them early would wrongly discard valid candidates.

### Phase 2 — Score (Soft Constraints → Composite Number)

| Component | Formula | Weight |
|---|---|---|
| Proximity | `max(0, 100 − dist_km × 10)` | ×1.5 |
| User interest match | `+30` if category in `interests` | ×1.0 |
| Crowd level | `low→30, medium→15, high→0` | ×1.0 |
| Time cost | `−(dwell_mins / 60) × 5` | ×1.0 |

Proximity is weighted highest (1.5×) because travel time is the dominant constraint on short trips — a distant place, however good, can consume the entire budget.

Tie-break: alphabetical by `place_id`.

### Phase 3 — Select
Take the top-3 scored candidates.

### Phase 4 — Sequence (Full Permutation Search)
With ≤3 places there are at most **6 permutations**. For each:

1. Simulate the timeline from `start_time`
2. Compute actual `arrival_time` at each place
3. Enforce hard constraints:
   - `arrival_time ≥ place.open_from`
   - `arrival_time + dwell ≤ place.open_to`
   - Cumulative `(travel + dwell) ≤ budget`
4. Record `total_travel_km` for valid permutations

Pick: **lowest total travel distance** among valid permutations.  
Tie-break: lexicographic order of `place_id` sequence.

---

## Required Written Explanations

### Q1: What constraints mattered most and why?

**Most important: opening hours (validated at actual arrival time).**  
Opening hours are a hard, binary constraint — you either make it or you don't. But critically, whether you make it depends entirely on *when* you arrive, which depends on the ordering. This is why opening hours had to be checked per-permutation during simulation rather than up front. Getting this wrong produces itineraries that sound valid but fail in practice.

**Second: time budget.**  
The budget determines the maximum number of places and their ordering. It's also sequence-dependent: a place 2 km away first is fine, but 2 km *after* a 3 km detour might not be.

**Third: proximity (weighted 1.5× in scoring).**  
On a short trip (2–3 hours), travel time is a significant fraction of the budget. A highly-rated place 10 km away may consume 40+ minutes of walking — more than some venues' dwell time. Prioritizing nearby places preserves time for actual experiences.

### Q2: What did you intentionally simplify or ignore?

- **Transport mode**: Assumes walking (4.5 km/h). A real app would use the user's mode (driving, transit) and real road distances via a routing API.
- **Real-time data**: Crowd levels are static labels (`low/medium/high`). Real crowd levels fluctuate by hour, day, and season.
- **Place ratings/reviews**: Not modelled. A richer scorer would incorporate them.
- **Lunch/dinner timing**: No meal-time awareness. Users might want a cafe at noon regardless of its score.
- **Return-to-start**: The sequence ends at the last place; doesn't account for getting back to the origin.
- **Re-visiting**: Assumes each place is visited at most once.

### Q3: What would break if the number of places doubled?

The current pipeline has two scaling concerns:

1. **Phase 4 (Permutation search)**: Currently O(N!) on the selected candidates. We select top-3, so it's always 6 permutations regardless of input size — this is fine. But if we raised `MAX_PLACES` to 6, that's 720 permutations. At 10, it's 3.6M. The fix is to switch to a dynamic programming approach (e.g. held-karp for TSP) for the sequencing phase.

2. **Phase 2 (Scoring)**: Scoring all N places is O(N) — this scales fine even at 100+ places.

So practically: **doubling the input from 6→12 places doesn't break anything** because we still only sequence the top-3. Doubling MAX_PLACES would break the permutation search.

### Q4: How would your approach change for a friend group?

For a group, preferences become a **multi-dimensional aggregation problem**:

- **Pooled interests**: Union of all members' interests (anyone's preference is a signal).
- **Pooled avoids**: Union of all avoid lists (if anyone avoids bars, exclude bars — strictest common constraint).
- **Crowd tolerance**: Take the minimum crowd tolerance across the group.
- **Dwell time**: Longer dwell times become more appropriate (groups browse slower, need restrooms, etc.)
- **Group size constraints**: Some venues have capacity limits. This would need to be a new field.

The scoring function would compute a **consensus score** — for each soft constraint, aggregate across all member profiles (e.g., interest bonus = number of members interested / total members × 30).

---

## Optional Architecture Questions

### Where should this logic live in a mobile app?

**On the server.** Reasons:
- The scoring weights and business rules should be centrally controlled (easy to tune without app updates)
- Place data and opening hours are server-side anyway
- The computation is cheap (milliseconds) — no reason to push it to the client
- Keeps the client thin: just sends the request and renders the result

A lightweight edge function (e.g., Cloudflare Workers or AWS Lambda) would be ideal — low latency, no persistent infrastructure needed.

### What would the API shape look like?

```
POST /api/plan-itinerary

Request:
{
  "start_location": { "lat": 12.9716, "lng": 77.5946 },
  "start_time": "10:00",
  "available_time_minutes": 180,
  "preferences": {
    "interests": ["park", "cafe"],
    "avoid": ["bar"]
  },
  "place_ids": ["p1", "p2", "p3", "p4"]   // or radius-based discovery
}

Response 200:
{
  "sequence": ["p2", "p1", "p4"],
  "total_time_minutes": 155,
  "explanation": { "p2": "...", "p1": "...", "p4": "..." }
}

Response 422:
{
  "error": "NO_VALID_ITINERARY",
  "message": "No valid sequence found within the given constraints."
}
```

### What constraints would you consider for production?

| Concern | Approach |
|---|---|
| **Latency** | Cache scored place lists (scores don't change per-request); only run sequencing fresh |
| **Offline usage** | Cache last-known itinerary on device; flag it as "last synced at HH:MM" |
| **Errors** | Distinguish between user errors (bad prefs) and server errors; return structured error codes |
| **State consistency** | Itinerary is computed at request time; if user deviates mid-trip, client should re-request with updated `start_location` and reduced `available_time_minutes` |
| **Stale data** | Opening hours change (holidays, events). Add a `last_updated` timestamp and re-validate before finalizing. |

---

## One Explicit Limitation

**The scorer is unaware of sequence position.**

Scoring happens before sequencing. A place scores highly because it's nearby and quiet — but the sequencer might place it *second* after a detour, making its effective distance longer than scored. The score is computed from the starting location, not from wherever you'd actually be when you visit it.

A position-aware scorer (scoring each place relative to the previous stop's location) would be more accurate but would interleave scoring and sequencing — adding complexity that isn't warranted for 2–3 places. For larger itineraries, this trade-off would need to be revisited.
