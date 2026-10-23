# Medicine Shelf

A free, private web app that families install on their phones to track how much medicine they have and when to reorder. It has no accounts and no server. Medicine Shelf never sends a family's list anywhere; only what they choose to export (a backup file, a calendar entry, a printout) leaves the app.

## What's in this folder

| File | What it is |
|---|---|
| `index.html` | The app's page and styles |
| `app.js` | Everything the app does (kept out of the page so the security policy can block any other script) |
| `shelf-math.js` | The date and supply math, kept separate so it can be tested |
| `tests/run.mjs` | Tests for the math, refills, decimals, the shared data checks, damaged-data handling, the undo window, expiry, recount reminders and the "Needs doing today" list: `TZ=America/New_York node tests/run.mjs` (no installs needed) |
| `manifest.webmanifest`, `icon-*.png`, `apple-touch-icon.png` | Let phones install it to the home screen with its own icon |
| `sw.js` | Lets the app open with no internet |
| `flyer.html` + `flyer.js` + `qrcode.js` | Printable one-page flyer with a QR code that points to wherever you host the app |
| `install-guide.html` | Printable family setup guide in large type: open the app, add it to the home screen, add the first person and medicine, save a backup |

## Hosting it

Upload the whole folder, unchanged, to any static web host that serves **HTTPS**. Phones refuse to install or run offline over plain HTTP. Free options:

- **GitHub Pages**: make a public repo, upload the files, then Settings → Pages → deploy from the main branch. The link looks like `https://yourname.github.io/medicine-shelf/`.
- **Netlify Drop** (app.netlify.com/drop): drag the folder in and you get a link in seconds.
- **Cloudflare Pages**: same idea, with a free custom domain if you want one.

Opening `index.html` straight from your computer works for a quick look, but it won't install or work offline until it's on an HTTPS host.

## The flyer

Open `flyer.html` from your hosted link (for example `https://yourname.github.io/medicine-shelf/flyer.html`). It fills in the app's link and draws the QR code. **Scan it with a phone before printing a stack**, then print on letter paper. The "Shared by" line is blank so any office can write in its name.

## The setup guide

Open `install-guide.html` from your hosted link (for example `https://yourname.github.io/medicine-shelf/install-guide.html`). It is a large-type walkthrough a family can follow on letter paper: open the app, put it on the home screen, add the first person and medicine, and save a backup. Print it and hand it out with the flyer. The "Shared by" line is blank so any office can write in its name. The app link printed on the guide is the published page, `https://frankoo6.github.io/medicine-shelf/`. The app's first screen and the Tools section each have a small link to this page, and so does the flyer page (on screen only, above the print button).

## Updating the app later

Phones keep a copy of the app so it works offline. After you change any file, open `sw.js` and raise the version number at the end of the `CACHE` name by one (for example `medicine-shelf-v6` becomes `medicine-shelf-v7`). Run the tests first. A phone downloads the new version in the background as one complete set of files and keeps using the old set until the person taps **Reload now** on the "A new version of Medicine Shelf is ready" banner (or fully closes the app and opens it again). It never mixes old and new files. If you forget to raise the number, phones keep the old version.

Families' data is not affected by updates. It lives in their browser under the key `medicine-shelf.v1`. If you ever change the data format, raise `DATA_VERSION` in `app.js` and add a step to `migrate()`, so older lists and backups still load.

## How the app protects a family's list

- **A list it can't read is never overwritten.** If the saved data is damaged, the app keeps a copy under `medicine-shelf.v1.unreadable`, stops saving, and offers Restore a backup, Save the damaged copy as a file, or Start a new list (which still keeps the copy).
- **Restore and Erase can be undone for 7 days.** The list from before is kept under `medicine-shelf.v1.previous`, with Undo right away and a "Bring back the earlier list" banner for a week.
- **The same checks for the saved list and for backups** (`cleanList` in `shelf-math.js`). Every person and medicine gets its own id, broken optional fields are fixed, and a refill marked ready with no date goes back to requested. On the phone nothing is dropped: a medicine whose count, schedule, reorder number or person can't be worked out shows a "Needs fixing" card that says what's wrong. A backup file leaves damaged entries out and says how many; files from a newer app version are refused.
- **Removing a medicine or a person can be undone** right after, from the message at the bottom.
- **Two windows can't overwrite each other.** Every save raises a revision number (`meta.rev`). If the list was changed in another tab or window, the older window refuses its own save, shows the latest list and asks the person to make the change again. Open windows also refresh when another one saves.
- **Security policy.** Each page has a Content-Security-Policy that only lets this site's own scripts run and blocks plugins, frames and form posts. GitHub Pages can't send security headers, so protection that only works as a header (such as blocking the app from being shown inside another site's frame) isn't available there.

## Known limits (tell offices and families)

- **Data lives on one phone.** A lost phone or cleared browser data erases the list. The app asks people to save a backup file after their first medicine, asks them to confirm they kept the file, and reminds them again after 60 days or several changes.
- **iPhone users must add it to the home screen.** Safari can erase site data after about 7 days without a visit, but not for home-screen apps. The app shows iPhone users how to do this on their first visit.
- **No sync.** Two caregivers on two phones keep separate lists. Tools → "Using the list on two phones" walks through copying a list to another phone with a backup file; after that, changes don't flow between them. There is deliberately no account or server, so nothing leaves the phone.
- **Calendar reminders are one-time files.** "Add to calendar" makes a calendar file for the current order date. After a refill the date moves, so add it again. Each medicine keeps the same event id, so calendars that follow the standard (Apple Calendar, Outlook) replace the old reminder; Google Calendar's file import may add a second one, which you delete by hand. After a refill, the app offers "Update calendar" for medicines already on the calendar. Apple Calendar keeps the 9 a.m. alert in the file; Google Calendar on Android may ignore it and use its own default alert for all-day events.
- **Printing from the home-screen app** works on most phones but varies by model. If the Print button does nothing, open the same link in the regular browser and print from there.
- **Dates are estimates.** Days left and the run-out date assume every dose is taken as scheduled, so missed or extra doses make them drift. Each card says when it was last counted by hand, and after 90 days (changeable per medicine under Timing, 7 to 365) the card and the "Needs doing today" list ask for a recount. Insurance refill rules vary; the default assumes a refill is allowed after 75% of the last fill is used. Users can change this per medicine, or enter the next refill date their pharmacy gave them, which replaces the estimate until the next pickup.
- **Expiry dates are optional and typed in by hand.** The app warns 30 days ahead and adds a calendar reminder two weeks ahead, but only if the date was entered. It tracks one date per medicine, not one per package.
- **Daily schedules only.** "How many a day" can be a fraction (0.5 for every other day), but weekly or alternating doses aren't modeled yet; enter the average a day.
- **Exports are copies.** Backup files, calendar entries and printed lists contain medicine names and dates. They are outside the app's protection once made. Tools → "Keep calendar reminders private" (a setting on each phone) makes calendar entries say only "Check medicine supply", with no names, pharmacy or Rx numbers; reminders already added keep their old wording until they're added again.

## Before a doctor's office hands it out

- Have someone in the office try it on an iPhone and an Android phone: install it, add a medicine, record a refill, print the medication list.
- The app and flyer say it tracks supply only and gives no medical or dosing advice. The office may want its own review of that wording.
- Because no patient data reaches the office or the host, the office isn't storing health information through it. That's worth confirming with whoever handles the office's privacy policies.

## License

The app is yours to share. `qrcode.js` is by Kazuhiko Arase, MIT license (notice kept at the top of the file).
