# Place Sequencer — Spica Take-Home

A small deterministic engine that picks 3 places from a list and sequences them optimally, based on your location, time budget, and preferences.

No dependencies. Pure Node.js.

## Run

```bash
node index.js    # main output
node test.js     # 23 tests
```

---

## How it works

**Step 1 — Filter** hard constraints that don't depend on ordering:
- `"crowded"` in `avoid` → removes all `crowd_level: "high"` places
- Type strings in `avoid` (e.g. `"shopping"`) → removes places of that type

Opening hours and time budget are *not* filtered here — they depend on actual arrival time, which changes per ordering.

**Step 2 — Score** remaining places with a weighted formula:
- Proximity × 1.5 (highest weight — distance dominates on short trips)
- Preference match × 1.0 (`"coffee"` → cafe, `"walk"` → park, `"quiet"` → low crowd)
- Crowd level × 1.0 (low = 30, medium = 15, high = 0)
- Mild dwell-time penalty

**Step 3 — Sequence** the top 3 via full permutation search (max 6 orderings). For each ordering, simulate the full timeline and check:
- Arrival time ≥ `open_from`
- Departure ≤ `open_to`
- Cumulative (travel + dwell) ≤ budget

Pick the valid ordering with the least total travel distance. Tie-break: alphabetical by `id`.

---

## Questions

**Which constraints mattered most?**
Opening hours — but validated at *actual* arrival time, not start time. If you visit two places first, you might arrive at a third at 12:30 even though you started at 10:30. Proximity is second: on a short trip, a place 4km away can eat 50 minutes just in walking.

**What I simplified?**
Assumes walking at 4.5 km/h. No real-time crowd data. No return-to-start. No meal-time preferences.

**What breaks if places double?**
Nothing, immediately — the sequencer always works on 3 selected places (6 permutations). What would break is raising `MAX_PLACES` beyond ~7, where you'd need dynamic programming instead of enumeration.

**For a friend group?**
Union preferences (anyone's interest counts), intersect avoids (strictest wins), minimum crowd tolerance. Score each place by how many members share the preference rather than a binary match.

---

## Optional — App integration

**Client vs server:** Logic belongs on the server. Place data and hours are server-side, computation is fast, and central weights can be tuned without pushing an app update.

**API shape:**
```
POST /api/itinerary
Body:    { user: { lat, lng, start_time, time_available_minutes, preferences, avoid }, places: [...] }
Response: { sequence, total_time_minutes, explanation }
```

**Production constraints:** Cache scored place lists between requests (scores are stable). Store the last itinerary locally for offline access. Re-call the API with updated location and remaining time if the user deviates mid-trip. Return structured error codes so the client can handle "no valid itinerary" gracefully.

---

## Limitation

The scorer ranks places relative to your *starting* location, not relative to each other. A place scored high for being nearby might end up 3rd in the sequence — far from the previous stop. Doesn't matter much at 3 places, but breaks down at scale.
