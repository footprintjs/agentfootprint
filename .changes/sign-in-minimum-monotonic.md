---
type: fixed
---
**The sign-in door's minimum answer time is never cut short.** `signInDoor`
holds every `POST /auth/login` answer until `minimumResponseMs` has passed, so
"no such user" and "wrong password" cannot be told apart by how fast they come
back. It measured that time on its epoch clock (`now`, `Date.now` by default),
which counts whole milliseconds, so an answer could go out up to a millisecond
early. And when the system time was set forward during a login (NTP, an
operator), the answer went out at once; set back, it waited that much longer.
The minimum is now measured on the monotonic clock (`performance.now()`) from
the moment the login starts, and waited in full. `now` still dates sign-ins and
attempt windows.
