# Dot Wave duel boundaries

- `DotWaveCabinet.tsx` renders cabinet controls and result/challenge notices.
- `useDotWaveCabinet.ts` binds one controller lifetime to a React effect. Strict Mode creates a fresh controller after cleanup.
- `cabinetController.ts` owns cabinet state, credit arbitration, server clock, transport callbacks, and shared audio. Its default transport is `createCabinetSession({ gameId: "dot-wave", ...handlers })`; tests can inject the same client-compatible factory.
- `network.ts` defines the `DuelLink` simulation boundary: received frames/input, server time, solo admission, publishing, strikes, and results. The controller does not advance the game simulation.
- `engine.ts` defines simulation state independently of React. `core.ts` and `campaign.ts` implement game rules; `MochiDuel.tsx` owns the simulation loop and its UI.

Controller disposal explicitly leaves the session, removes the profile listener, clears clock/solo timers, settles pending solo admission, and closes shared audio. Late bootstrap/credit responses cannot reconnect or notify; reservations obtained after disposal are released. Audio cannot schedule new voices after disposal, including a pending resume.

## Credit service review

The current shared `executePlay` starts the game before capturing credit, does not pass the reservation ID to its start callback, and does not accept a reservation purpose. DOT solo captures before sending `startSolo`; challenge/rematch reserve with a purpose, send their reservation ID over the protocol, and capture later on `challengeAccepted`. Reusing `executePlay` would change these ordering guarantees, so the controller retains its disposal-aware reserve/capture wrappers.

If the parent expands the common service, a lower-level transaction handle could expose `reservationId`, `capture()`, and `release()`, accept `purpose` and `isActive()`, and suppress wallet callbacks after disposal. It should release reservations returned after disposal and validate the capture status. Keep that primitive separate from the existing start-then-capture policy; DOT must retain protocol/acknowledgement ordering.

The route lifecycle tests invoke the actual cabinet component and hook with a minimal effect/ref harness and stub child UI. They verify cleanup followed by a new mount, fresh credit/network/audio state, ignored stale callbacks, and released late reservations. They are not browser DOM/router integration tests.

Run focused controller, audio, and existing simulation tests from `apps/web`:

```sh
npx vitest run --config src/games/dot-wave/duel/vitest.config.ts
```
