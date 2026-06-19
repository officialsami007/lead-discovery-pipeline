# Decisions

## What I'd do differently with 2 more days

- **Optimize API call for more accurate results:** I would have spend time tuning the Travily API calls that was used for discovery so the output comes back cleaner. That means writing better search queries and filtering the results more strictly, so the leads are more relevant, the email guesses are more reliable, and verification has less junk to throw away.

- **Tidy up the database:** The schema and migrations got a bit messy as features moved around. I would have clean up the naming, drop anything that is no longer used, add the indexes the queries actually rely on, use a better format for the ids and optimize a few of the heavier queries.

- **Create an Admin for users and organiztion management:** Right now users, organizations, and credits only exist through the seed script. I could have build proper screens to invite and manage users, change which organization someone belongs to, and top up or adjust credit balances, instead of editing the database by hand.

## Risks accepted for the time box

- **Demo style login:** You sign in by picking one of the seeded users, with no password with fixed number of credits. The session itself is still secure as it is signed, stored on the server, kept in a cookie that scripts cannot read, and checked against the user's organization membership. That is fine for a demo, but it is not a real production login.

- **Rate limiting is in memory:** The per organization search limit is counted inside a single process, so it is not shared across instances. If the app ran on more than one server, each server would keep its own count and the real limit would end up higher than intended. For a single instance demo this is fine, and a production version would store the count in Redis or a database table so every instance sees the same number.
