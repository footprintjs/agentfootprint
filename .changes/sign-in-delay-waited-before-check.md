---
type: internal
---
**A test now pins that the sign-in door waits the attempt delay before it
checks the password.** The X-Forwarded-For tests read the limiter's decision
off the door, and their recorded waits end at once, so they passed even with
the door's `await` on the delay dropped, which turns the brute-force slow-down
off. `test/hosting/sign-in-door-delay.test.ts` holds each wait for one turn of
the event loop and requires a delayed login to go wait, waited, check, answer.
It uses no clock. No library behaviour changed.
