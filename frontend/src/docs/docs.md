# FLEET by Vector Brain — documentation

FLEET runs tasks on real Android phones. You write a task in plain words, an AI model reads each phone's screen and does the taps, and you watch every phone live from the dashboard at https://app.vectoragent.in. The phones are your own; the AI model is your own key.

## Getting started

### What you need

- Android phones on **Android 10 or newer**, any brand. No root, no ADB, no USB cable.
- The **Vector** app (an APK file) installed on each phone. Copy the APK to the phone and open it; Android asks once to allow installs from your browser or file manager.
- An account on https://app.vectoragent.in.
- An API key for an AI model (see *Add your AI key* below).

### Pair a phone

1. On the dashboard, open **Android Devices** and choose **Pair New Device**. Give the phone a nickname and press **Generate Pairing Code**.
2. The code is **6 characters**, letters and numbers (there is no 0, O, 1 or I, so it cannot be misread). It expires after **10 minutes**.
3. On the phone, open Vector, go to the **Device** tab, type the code and tap **Connect this phone**.

The app connects to `https://app.vectoragent.in` by default. To use another server, open **Use a different server** before connecting.

If pairing fails, the message says why: the code is wrong or expired (generate a new one), or the phone is already paired to another account (unpair it there first). To move a phone, use **Unpair this phone** in the app and pair it again with a new code.

### Finish the setup checklist on the phone

The Device tab lists every permission Vector needs, each with a button that opens the right Settings screen and a **How?** guide drawn for your phone's brand. The required ones:

| Step | Why | Notes |
|---|---|---|
| Screen control (Accessibility) | Lets Vector read the screen and tap, type and swipe | Turn on **Use Vector**. Xiaomi: Accessibility › Downloaded apps › Vector. Samsung: Accessibility › Installed apps › Vector |
| Allow restricted settings | Android 13+ blocks Accessibility for apps installed from a file | Only shown when needed. Open Accessibility and tap Vector (Android shows "Restricted setting", tap OK), then App info › ⋮ › Allow restricted settings |
| Unrestricted battery | Stops Android pausing Vector, which drops the connection when the screen is off | Xiaomi: No restrictions. Samsung: Unrestricted. OPPO / Realme / OnePlus: Allow background activity. Others: Don't optimise |
| Screen sharing | **Android 10 only**: screenshots need screen sharing | Choose **Start now**. Android turns it off after every restart or update; Vector reminds you with one notification |

Recommended, not required:

- **Autostart** (only on phones that have it: Xiaomi, OPPO, Vivo, Huawei and similar) lets Vector restart itself if the phone closes it.
- **Notifications** let Vector warn you when a setting was switched off or an update is ready.
- **Install apps** lets Vector install its own updates that you send from the dashboard.

### Add your AI key

Open **Settings** on the dashboard and choose **Add AI Provider**. Supported providers: **OpenAI, Google Gemini, Anthropic, DeepSeek, Groq, OpenRouter**, and **Custom** (any OpenAI-compatible API at a public address, set with a base URL; addresses on your local network are not accepted).

- Keys are stored **encrypted (AES-256-GCM)** and are never shown again after saving.
- Mark one model as **active**; it runs your tasks.
- Each model is labelled **Sees screenshots** or **Text only** (see *Screenshots and the vision helper*).
- Under **Settings › Agent engine** you can add a **Backup model**. It takes over for the rest of a run when the main model is rate-limited or has used up its daily limit, instead of the run failing. Short rate limits are waited out first.

### Phone states on the dashboard

| State | Meaning |
|---|---|
| Ready | Online and idle |
| Running | Doing a task now |
| Waiting | Waiting its turn in a proxy lane |
| Service needed | Connected, but Accessibility is off |
| Offline | Not connected |
| Completed / Failed / Cancelled / Interrupted | Result of its last run, shown for 30 minutes |

## Mission Control

Mission Control is a chat with **Vector**, the fleet assistant. You ask in your own words, in English, Hinglish or Hindi, and it starts missions across your phones, reports results and shows live screens. Each conversation is kept in the sidebar.

### Start a task

Type what you want done, and say which phones:

- **@name** for a phone, **#tag** for every ready phone with that tag (type `@` or `#` to pick from a list), **all phones**, or **on 3 phones**.
- If you name no phones, it reuses the phones from your last task and says so. If there is no last task, it asks which phones to use.
- Add a duration for timed work: *"for 30 min"*, *"2 ghante"*, *"for 1.5 hrs"*. Each phone keeps going for that long, up to **12 hours**.

Examples:

```
@Pixel 7 open YouTube and play the top trending video
#uk install WhatsApp from the Play Store
all phones: check the battery level and tell me which are under 20%
#lane-a scroll Instagram reels for 20 min
```

A mission can include up to **50 phones**. For *"any 3 phones"*, phones are spread across different proxy lanes so as many as possible start at once.

### Confirm before big runs

A mission on **more than 5 phones**, or one that runs **10 minutes or longer**, waits for your OK. The Confirm card shows the phones, the task, the duration and a rough step and cost estimate. Reply **yes** (or *ok*, *haan*, *chala do*, *start now*) or press **Confirm**; *no* or *cancel* drops it. An unconfirmed proposal expires after 10 minutes. Rotation or lane changes you ask for in the chat are always proposed first and never applied without your confirmation.

### Watch, pause, stop

- A running mission card shows a **live screen** for the phones that are working, with a step-by-step feed of what each is doing. When a phone finishes, its card shows the **final screenshot** of that run, not whatever the phone is doing later.
- **Pause** stops the running phones but keeps their progress; **Resume** starts each phone again from where it stopped, with its recent steps as context. A paused timed run only uses its remaining time.
- **Stop** cancels the mission for good. While a message is still being handled, the Send button turns into **Stop**, which cancels anything that message started.
- Ask *"show screens"* (or *"show screens of #uk"*) for one live preview per phone.

### Retries, busy and offline phones

- Each phone gets up to **3 tries** (the first run plus 2 retries) for temporary problems: the phone went offline, the AI provider was rate-limited or slow, the server restarted, or the run was interrupted. Other failures, such as the agent saying it could not finish, stop at once with a plain reason.
- A phone that is **busy** with another task waits its turn without using a try.
- An **offline** phone is waited for up to **10 minutes** (60 seconds for *"any N phones"*), then counted as failed.
- When a mission ends you can **Retry failed**, **Run again** on all phones, or **Continue** a phone that ran out of steps.

### Answers

When a task you started from the chat finishes, Vector posts an **Answer** card: your question, a one-line answer written from what the phones reported, and one row per phone with its value. A phone that failed shows **No answer**, never a made-up value. **Copy answer** copies it; **Retry N failed** reruns the phones that failed.

### Send files to phones

Use **Attach** (or drag a file onto the message box) to send a file to every **@phone** and **#tag** in the message, or to **all online phones** if you name none.

- Up to **100 MB** per file and up to 1000 phones per send. The file is uploaded once and every phone downloads the same copy.
- It lands in `Downloads/VectorAutomation` on each phone.
- Offline phones get it when they reconnect (files are kept 7 days). Each phone shows Sending, Receiving, Saved or Failed, and **Retry N failed** resends only to the phones that need it.
- Sending a newer build of the **Vector app itself** updates the phones. The card shows each phone's progress (Update downloaded, Installing, Updated, or *Tap to install on phone* / *Allow installs on phone* when the phone needs you). The update must be signed with the same key as the installed app.

### Alerts

The **Alerts** chip by the message box counts phones that need a look, grouped as *Needs attention now*, *Worth checking* and *Minor*. Alerts come from each phone's network readings (see *Network info*) and from comparing phones in the same proxy lane. Most alerts have a **Fix** button that writes the command into the message box for you to review; nothing runs until you press Send. SIM and WebRTC alerts have no Fix, and neither does a phone whose name is shared by another phone (rename it first). **Refresh all** asks every phone for a fresh reading.

## Tags and lanes

### Tags

Give a phone a tag with the **+ tag** chip on its card on the **Device Fleet** page: up to **20 characters** in one of 8 colours. Save an empty tag to remove it. The Fleet page can filter by tag, including *untagged*.

Use the tag with **#** in Mission Control to target every **ready** phone that has it, for example `#uk check the IP`. A tag with no ready phones gives a clear message instead of starting nothing.

### Lanes

A **lane** is a proxy that several phones share, so they share one exit IP. Each lane has:

- **Phones at once**: while the lane rotates its IP, how many of its phones may run a task at the same time (default 1). The others wait in the lane queue, shown as *In proxy queue*. When rotation is set to never, there is no queue and every phone starts at once.
- **Rotation** and **settle seconds**, described under *Proxy rotation*.

Phones without a proxy do not queue. On the Device Fleet page, phone cards are grouped by lane. Tasks that never use the internet can skip the lane queue.

## Proxy rotation

FLEET does **not** set up proxies on your phones. Put the proxy into each phone's own proxy app once; FLEET then manages *when* the lane's IP changes.

### Set up a lane

On **Device Fleet**, open **Proxies** and add one:

- **Name**, for example *UK mobile 1*.
- **Rotation URL**: the link your proxy provider gives you to change the IP. FLEET calls it with an HTTP GET. Only `http://` and `https://` public URLs are accepted. The URL is never shown back to the browser after saving.

Then assign phones to it from each phone's proxy picker, or select several and use **Assign selected to**.

### When the IP rotates

- **After every N finished tasks** on the lane: every task, every 2, 3, 5 or 10 tasks, or never. Finished, failed and cancelled tasks all count.
- **Rotate now** on the lane rotates at once and checks that the link works.
- The **Proxy rotation ON/OFF** switch in Mission Control sets all lanes to rotate after every task, or never.
- You can ask Vector in the chat to change a lane's rotation or *phones at once*; it always asks you to confirm first.

Automatic rotations are at least **60 seconds** apart; one that falls inside that gap waits for the next finished task. **Rotate now** is not held back by the gap. Rotation is not time-based.

### What a rotation does

- A rotation counts as successful when the provider answers with HTTP 2xx within 20 seconds. If the reply contains the new IP, FLEET shows it (*Rotated to 1.2.3.4*).
- Each time a place frees up in the lane, the next phone waits the lane's **settle seconds** (default 5) before it starts, giving a new IP time to settle.
- 5 seconds after a rotation, every phone on the lane re-reads its network info, so you can see the new IP.
- If a rotation fails, the lane holds its next phone and retries with growing waits (from 5 seconds up to 5 minutes).

## Network info

Each phone reports what its network looks like, so you can catch a proxy that is not applied or a phone whose settings do not match its IP.

### What each phone reports

| Reading | Notes |
|---|---|
| Public IP | The address the server sees the phone's report come from |
| Direct IP | Read without the proxy |
| WebRTC IP | What a website using WebRTC (STUN) would see |
| DNS, Private DNS | |
| Language and region | The phone's language list and region |
| SIM and network country | |
| Timezone, automatic time | |
| Phone clock | Compared with the server's clock |

FLEET adds the country of each IPv4 address and keeps the last 20 public IPs the phone used. Network readings need **Vector 0.28 or newer**.

### When phones report

On connect, every 15 minutes, 5 seconds after their lane's proxy rotates, a few seconds after a mission they ran finishes, and whenever you press **Refresh**. Offline phones keep their last reading.

### What gets flagged

- The phone's **timezone** does not belong to the IP's country.
- The phone's **region or language** points to a different country than the IP.
- The **SIM** country differs from the IP's country.
- A proxy is set, but the public IP equals the direct IP: the **proxy is not being used**.
- The **WebRTC IP** differs from the public IP (the proxy only carries web traffic).
- The **clock** is off by more than 60 seconds, which can break sign-ins and one-time codes.
- In a lane with at least 3 phones reporting within 30 minutes of each other, a phone whose **IP or language differs from the majority**.

These are hints, not verdicts on how a phone should be set up.

### Where to see it

- **Android Devices** › *Network & locale*: a table of every phone with search, a *Needs a look* filter, **Export CSV** and **Refresh all**. Expand a row for IP history and the reasons it was flagged.
- **Device Fleet**: a network panel on each phone card.
- **Mission Control**: the **Alerts** sheet.

## Screenshots and the vision helper

The AI always gets the screen's **element list** (buttons, fields and text that Android describes). Screenshots help with what the list cannot describe, such as unlabelled icons, games and some web pages.

### Screenshot setting

**Settings › Agent engine › Screenshots to the AI**:

| Option | What it does |
|---|---|
| When it gets stuck (recommended) | Element list, plus a screenshot when the AI is going back and forth or its actions change nothing |
| Every step | A screenshot after every action. Each step costs roughly 10–15% more |
| Off | Cheapest. Screenshots only on screens the element list cannot describe at all; the AI can miss unlabelled icons |

Per run, the AI can ask for up to 3 screenshots itself, and up to 8 are sent automatically when it is stuck or the screen cannot be described.

### Which models see screenshots

Anthropic and Google models always can. OpenRouter models are checked against OpenRouter's catalog. Other providers are matched by model name (GPT-4o, GPT-4.1, GPT-5, Claude, Gemini, Llama 4, Qwen-VL and similar). Anything unknown is treated as **text only**, and no images are sent to it, because a text-only model cannot read them and they would only cost tokens.

### The vision helper

If your main model is text only, add a **vision helper** under **Settings › Agent engine › Screen reader (vision model)**. It must be one of your own models that can read images. When the screen needs reading, the helper lists up to 30 things on screen that can be tapped, with their positions, so the text-only model taps by item instead of guessing. It is not used when the main model can see screenshots itself, and its tokens count in the run's total. Up to 25 helper reads per run.

### Did the AI see the screen?

- Before you send, Mission Control shows **Sees screens**, **Text only + vision helper**, or **Text only — screenshots won't be seen** with an *Add vision helper* link. If screenshots are on and nothing can read them, the first send asks *Run anyway?*
- During a run, each step shows whether its screenshot was seen by the AI, read by the helper, or not used, and why.
- After a run, a line says how many screenshots the AI saw.

## Flows

A flow is a saved run that replays **without the AI**: it costs no tokens and runs as fast as the phone.

### Save and replay

1. Run a task on the **Android Agent** page. When it finishes, press **Save as flow**.
2. Open **Flows** and replay it on any online phone.

Only the phone actions are kept: open app, open URL, taps, swipes, back/home and waits. Steps that failed in the original run are left out.

### Limits

- Taps replay at the **same screen positions** as the recording, so a flow is reliable only on phones with the same screen size and layout. Flows with taps are marked *position-dependent*.
- **Typed text is not replayed** (it is never stored). Typing steps are skipped.
- A replay runs on **one phone** at a time and stops at the first step that fails. If that happens, the screen has changed since recording: run the original instruction with the agent and save it again.
- Flows cannot be started from the Mission Control chat.

## Troubleshooting

### A phone shows "Service needed"

Accessibility was turned off on the phone, by someone or by Android itself (for example when the app is reinstalled). Vector posts a notification, *"Vector needs one setting back"*; tap it and turn **Use Vector** on again. Tasks sent to that phone stop with a message saying its accessibility service needs turning back on.

### A phone shows Offline or keeps reconnecting

- Make sure **Unrestricted battery** is on, and **Autostart** on phones that have it. These are the usual cause.
- Vector retries by itself and starts a fresh connection after two minutes offline. The app's *Not connected* card says why and offers a fix: **Fix date and time** for a wrong clock, **Unpair and pair again** if the server refused the phone's token, or **Reconnect now**.
- If the dashboard says the phone is *reconnecting*, the server may have just restarted. Try again in a few seconds.
- A mission waits up to 10 minutes for an offline phone before counting it as failed.

### Xiaomi: "Don't cover the earphone area"

Xiaomi's pocket mode shows this warning when the proximity sensor is covered, and blocks every tap. The agent recognises it, ends the run and reports that the sensor is covered. Uncover the top of the phone, or turn off **Settings › Lock screen › Pocket mode** (*Prevent accidental touches*).

### Android 10 limits

- **Screenshots need screen sharing**, and Android turns it off after every restart or update. Vector re-asks by itself and sends one reminder; tap it to turn sharing back on. Android 11 and newer do not need this.
- **Pressing Enter needs Android 11.** On Android 10 the AI taps the Search, Go or Done button instead.

### Locked phones

Vector wakes the screen and dismisses a lock screen **without** a PIN. A **PIN, pattern, password or fingerprint lock is never bypassed**: the phone stops at the lock screen. Phones you run from FLEET should have no screen lock. After a restart task, a phone with a PIN stays at the lock screen.

### Updates fail to install

- *Allow installs on phone*: turn on **Install unknown apps** for Vector on that phone.
- *Signed with a different key*: the APK you sent was signed with a different key from the installed app. Android only updates an app with a build signed by the same key.
- *Not enough storage*: free space on the phone and send it again.

### Why did a run fail?

Every failed run has a plain reason. The common ones:

| Reason | What to do |
|---|---|
| AI provider rate limit hit / used up its daily limit | Add a backup model, or use a paid model |
| AI provider key or credit problem | Check the key and credit in Settings |
| Screen stopped changing / kept repeating the same action | The AI got stuck; check the final screenshot, then rephrase the task or turn screenshots on |
| Reached the step limit | Use **Continue**, or split the task |
| Phone went offline | See *A phone shows Offline or keeps reconnecting* |
| Agent said it could not finish | Read its reason in the run; often a sign-in, a payment or a missing app |
| A replay step failed | The screen changed since the flow was recorded; save the flow again |

## What FLEET does not do

Knowing the limits up front saves wasted runs.

- **It is not perfect.** Apps change, networks drop and screens differ between phones. Runs can fail; when they do, you get a specific reason, the final screenshot and the step-by-step log.
- **No silent app installs.** Play Store apps are installed by opening the store listing and tapping Install. Paid apps, sign-ins and payment screens are left to you.
- **No unlocking secure lock screens**, and no root or system-level access.
- **No proxy setup on phones.** FLEET rotates IPs through your provider's link; the proxy itself is set in each phone's own proxy app.
- **Your own AI key.** Runs use the AI provider you add, with its limits and costs.
- **Flows replay screen positions**, one phone at a time, without typed text (see *Flows*).

### Acceptable use

FLEET is for legitimate tasks on **your own phones and your own accounts**. Do not use it for bulk or fanned-out account creation, fabricated identities or "warm-up" history, fake engagement or reviews, solving or bypassing CAPTCHAs, hacking, or getting into accounts and devices you do not control. Human-only steps such as a CAPTCHA, a selfie or ID check, a fingerprint or a payment approval are for you to complete on the phone.
