# Lagos Life field notes — 9 October 2026

Source: signed-in browser exploration of https://lagoslife.app/. This is a research report and proposed direction, not an implementation claim or exhaustive app audit.

## Actually used

- Character setup, traits, ambition, Yaba home, needs and onboarding goals.
- Phone food ordering: delivered food improved hunger and fun and advanced the onboarding goal.
- Home bathing: timed object interaction restored hygiene.
- Furniture shopping and placement: bought an Acoustic Guitar for 4,200 game naira, placed it, and practised. Music reached level 2. Songwriting is gated at Music 3.
- Skills, wishes, lifetime ambition, daily missions and story selection. Started Shrine Open Mic; story remains unfinished.
- Map travel: walked to Afrika Shrine. Travel increased Fitness and consumed energy/hygiene.
- Shrine interior: visible stage, dance floor, tables, wall, avatars and venue activity controls. Open Mic was a nine-second timed action; completion paid 4,300 game naira and completed the night-out mission. It did not require rhythm inputs.

## Inspected, not completed

- Games hub: pool, Ayo, Whot, Ludo and chess; join/watch tables, venue associations and friendly/stakes options. No match played; multiplayer reliability unverified.
- Housing catalogue and home guest controls. No house move or guest session tested.
- Courses: lessons, quizzes, certificates and career boosts advertised; no course taken.
- Jobs: careers linked to venues and skills; several gated by skill level, with shifts and promotion paths. No job applied for.
- Phone launcher includes food, transport, shopping, homes, courses, careers and numerous social/business/civic apps. Presence in the launcher is not proof each works.
- Online counters and player labels are UI observations only; neither audience size nor network synchronisation was independently verified.

No real-money transaction, wager, public message or player invitation performed. The account now has a placed guitar and an unfinished Shrine story. Last observed wallet: 1,096,400 game naira.

## What Manchester should learn

The useful pattern is a connected life: phone discovery → place/object → action → progression → another reason to visit. Furniture participates in that loop. Local venue identity gives otherwise simple actions context. Short missions help the player choose what to do next.

Manchester already has a wealthy start, seven-room penthouse, shopping, tram rides and small activities. Its next improvement should connect those existing pieces. Preserve comfort and generosity; progression should unlock mastery, expression and experiences. Avoid compulsory work, debt, rent pressure and absence penalties.

## Proposed phone direction

| App | Purpose | Concrete first experience |
| --- | --- | --- |
| Today | Three optional outings with resume and route buttons | Row at the Quays, visit the Lowry, cook at home |
| Explore | Destinations, activities, travel and venue status | Tram directly into the selected activity flow |
| Clubs | Hobby progress, challenges and personal bests | Running splits and rowing technique, then new routes |
| What's On | In-world performances and playable events | Northern Quarter open mic and Lowry programme |
| Home | Existing furnishings plus useful hobby objects | Buy a keyboard, practise, unlock a performance |
| Camera & Album | Photos, visit memories and home display | Photograph three landmarks, frame a favourite |
| Friends | Invitations, shared outings, home visits | Requires real account/presence/session implementation |

All events initially fictional in-world programmes, not claims about real venue schedules. Existing compressed Sale cruise remains clearly fictionalised.

## Recommended first connected journey

Start with a Quays day out: choose an outing on Today, travel, play a rowing challenge, save a personal best, unlock a memento, and display it at home. Offer a Northern Quarter music journey next: purchase keyboard → touch rhythm practice → skill progress → venue performance → saved recording/memento.

Three approaches considered: a larger phone catalogue gives breadth but risks shallow screens; a connected hobby journey gives immediate depth and reuses existing work; multiplayer first offers social value but needs substantial backend and synchronisation work. Recommend the connected journey first, then shared sessions.

## Delivery boundaries and verification for future work

- Activity results should be committed once, with cancellation granting no completion reward.
- Persist outing progress, bests and inventory with migration of existing local saves. Show when saving fails.
- Keep existing home, phone-shop and travel behaviour working; lazy-load activity scenes and retain mobile touch controls.
- Verify one whole discovery/travel/play/reward/home-display/reload flow, plus cancellation and interrupted travel. Inspect portrait and landscape layouts and test on physical mobile hardware before claiming broad device performance.
- Shared races, spectating and home guests need authoritative sessions and genuine presence; local solo state cannot establish multiplayer support.

No Manchester code or deployment changed during this research pass.
