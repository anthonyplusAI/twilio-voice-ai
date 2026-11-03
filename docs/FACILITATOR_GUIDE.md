# Facilitator guide

Use this guide to prepare and run a hosted **Build a Voice AI Agent** workshop. The repository root is the shared workshop site; each Builder attendee works in a separate Codespace under `workshop/`.

## Agenda at a glance

| Chapter | Focus | Pacing |
|---|---|---:|
| 1 · Mission Briefing | Call flow and setup | 15 min |
| 2 · First Contact | First AI phone call | 15 min |
| 3 · Identity | Persona, voice, and language | 15 min |
| 4 · Reflexes | Interruptions, keypad input, and silence | 15 min |
| 5 · Superpowers | Sample tools and optional handoff | 20 min |
| 6 · Launch | Polish, deployment options, and showcase | 15 min |

**Total pacing:** 95 minutes. Adjust for the audience and time spent on live calls.

## Before the event

1. **Prepare the workshop Twilio account.** Use an upgraded account with a voice-capable number. [Trial accounts block the `<ConversationRelay>` TwiML noun](https://www.twilio.com/docs/usage/trials/try-out-voice#blocked-verbs). Accept the [Conversation Relay AI/ML features addendum](https://www.twilio.com/docs/voice/conversationrelay/onboarding#configuration-steps-in-the-twilio-console) in Voice settings before the first test call.
2. **Limit destinations on that account.** In [Voice geographic permissions](https://www.twilio.com/docs/voice/api/dialing-permissions-resources), enable low-risk United States/Canada and leave high-risk categories off. Twilio groups these destinations under `US`. Recheck the setting when changing accounts.
3. **Set up the hosted site.** Follow the [Azure infrastructure guide](./INFRA_SETUP.md), then run `scripts/configure-call-protection.sh` before deploying. It creates the shared `CallLimits` and `AnalyticsEvents` tables and sets the storage, organizer password, and public URL secrets used by the Container App.
4. **Set the site's credentials.** Provide its Twilio account SID, auth token, phone number, and `OPENAI_API_KEY`. Set `HANDOFF_PHONE_NUMBER` to a second reachable phone if Chapter 5 should demonstrate a live transfer.
5. **Prepare attendee keys.** Builder attendees need a working OpenAI API key in their own `workshop/.env`. Public Codespaces do not receive the repository's Codespaces secrets. Give attendees an event-specific way to obtain a key, or ask them to use their own.
6. **Check call capacity and usage.** The site's **Call Me** endpoint is public so attendees can call without signing in. Review your Twilio account's [outbound calls-per-second setting](https://www.twilio.com/docs/voice/api/call-resource) before inviting a group to call at once, and monitor usage during the event.

## Test the attendee journey

Run this once with a fresh public attendee Codespace and a US or Canadian phone number:

1. Open the workshop site, choose **Builder**, and create a Codespace from this repository.
2. Add `OPENAI_API_KEY` to `workshop/.env` and follow Chapter 2 to create `workshop/server.js`. In the terminal under `workshop/`, run `npm run dev` after creating the server.
3. Run `tunnel-url` and paste the current public `/twiml` URL into the site's **Call Me** form. Keep Codespaces port `8080` **private** in the Ports tab.
4. Answer the call. Change the greeting in `workshop/server.js`, save, end the first call, and call again. The second call should speak the new greeting because the site fetches the current `/twiml` response on every Builder call.
5. If using handoff, set `HANDOFF_PHONE_NUMBER` in `workshop/.env` to a second reachable phone, restart `npm run dev`, then confirm a call transfers only to that number. The site checks the Codespace's guided `/call-ended` response before allowing a transfer.
6. Confirm the public tunnel returns `404` for `/call`. This helps verify that calls originate through the protected site path.
7. Place an **Explorer** call through the hosted agent. Check that persona, voice, language, and tool changes take effect on the next call.

The optional `npm run call` path uses the attendee's **own** upgraded Twilio account, with `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`, and `MY_PHONE_NUMBER` in `workshop/.env`. Test that path only when attendees plan to use personal Twilio accounts. The site's **Call Me** button always uses the organizer's Twilio account.

## Call paths and limits

| Path | Agent | Twilio account | Attendee setup |
|---|---|---|---|
| Explorer **Call Me** | Hosted reference agent | Organizer's site account | Enter a phone number in the site |
| Builder **Call Me** | Attendee's current Codespace server | Organizer's site account | Run the server and paste `tunnel-url`'s `/twiml` URL |
| Builder `npm run call` | Attendee's Codespace server | Attendee's own upgraded account | Add personal Twilio credentials and `MY_PHONE_NUMBER` |

The site accepts valid US and Canadian numbers. It allows **one active call per number** and **ten started calls per number in a rolling 60 minutes**, with a **five-minute limit per call**. These limits cover Explorer and Builder calls initiated by the site. They do not apply to an attendee's `npm run call` path. There is no site-wide daily cap, so continue to monitor Twilio usage during the event.

Builder calls accept the guided Conversation Relay TwiML and a single US or Canadian live handoff. Other TwiML verbs are refused by the shared site's **Call Me** route. The Codespace's public tunnel blocks direct `/call` requests and protects WebSocket connections with Twilio signature checks.

## During and after the event

- Open `/admin` with the organizer's HTTP Basic credentials. Both `/admin` and `/admin/reset-all` require the configured password.
- Start a fresh analytics run before attendees join. Reset when the prior workshop is idle; attendees with tabs open during a reset should reload.
- Analytics events are stored in the `AnalyticsEvents` Azure Table. The local SQLite dashboard database is rebuilt from that table and can be replaced without losing Table events. See [Deployment: State and data](./DEPLOYMENT.md#state--data) for recovery and rollback details.
- If a live handoff is unavailable, tell attendees before Chapter 5. The sample weather and order tools use demo data; they do not contact production services.

For releases and health checks, follow the [deployment guide](./DEPLOYMENT.md). A successful deployment health check does not place a phone call, so repeat an Explorer and Builder test call after deploying.
