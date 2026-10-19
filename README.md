# Medicine Shelf

A free, private web app that families install on their phones to track how much medicine they have and when to reorder. It has no accounts and no server. Medicine Shelf never sends a family's list anywhere; only what they choose to export (a backup file, a calendar entry, a printout) leaves the app.

## What's in this folder

| File | What it is |
|---|---|
| `index.html` | The app |
| `shelf-math.js` | The date and supply math, kept separate so it can be tested |
| `tests/run.mjs` | Tests for that math: `TZ=America/New_York node tests/run.mjs` (no installs needed) |
| `manifest.webmanifest`, `icon-*.png`, `apple-touch-icon.png` | Let phones install it to the home screen with its own icon |
| `sw.js` | Lets the app open with no internet |
| `flyer.html` + `qrcode.js` | Printable one-page flyer with a QR code that points to wherever you host the app |

## Hosting it

Upload the whole folder, unchanged, to any static web host that serves **HTTPS**. Phones refuse to install or run offline over plain HTTP. Free options:

- **GitHub Pages**: make a public repo, upload the files, then Settings → Pages → deploy from the main branch. The link looks like `https://yourname.github.io/medicine-shelf/`.
- **Netlify Drop** (app.netlify.com/drop): drag the folder in and you get a link in seconds.
- **Cloudflare Pages**: same idea, with a free custom domain if you want one.

Opening `index.html` straight from your computer works for a quick look, but it won't install or work offline until it's on an HTTPS host.

## The flyer

Open `flyer.html` from your hosted link (for example `https://yourname.github.io/medicine-shelf/flyer.html`). It fills in the app's link and draws the QR code. **Scan it with a phone before printing a stack**, then print on letter paper. The "Shared by" line is blank so any office can write in its name.

## Updating the app later

Phones keep a copy of the app so it works offline. After you change any file, open `sw.js` and bump the number in `medicine-shelf-v6` (to v7, then v8, and so on). Run the tests first. Phones pick up the new version the second time they open the app.

Families' data is not affected by updates. It lives in their browser under the key `medicine-shelf.v1`. If you ever change the data format, keep reading the old one.

## Known limits (tell offices and families)

- **Data lives on one phone.** A lost phone or cleared browser data erases the list. The app asks people to save a backup file once they have two or more medicines, and nudges again after 60 days.
- **iPhone users must add it to the home screen.** Safari can erase site data after about 7 days without a visit, but not for home-screen apps. The app shows iPhone users how to do this on their first visit.
- **No sync.** Two caregivers on two phones keep separate lists. Restoring a backup on another phone copies the list across, but changes don't flow back.
- **Calendar reminders are one-time files.** "Add to calendar" makes a calendar file for the current order date. After a refill the date moves, so add it again and delete the old event. Apple Calendar keeps the 9 a.m. alert in the file; Google Calendar on Android may ignore it and use its own default alert for all-day events.
- **Printing from the home-screen app** works on most phones but varies by model. If the Print button does nothing, open the same link in the regular browser and print from there.
- **Dates are estimates.** Insurance refill rules vary; the default assumes a refill is allowed after 75% of the last fill is used. Users can change this per medicine, or enter the next refill date their pharmacy gave them, which replaces the estimate until the next pickup.
- **Exports are copies.** Backup files, calendar entries and printed lists contain medicine names and dates. They are outside the app's protection once made.

## Before a doctor's office hands it out

- Have someone in the office try it on an iPhone and an Android phone: install it, add a medicine, record a refill, print the medication list.
- The app and flyer say it tracks supply only and gives no medical or dosing advice. The office may want its own review of that wording.
- Because no patient data reaches the office or the host, the office isn't storing health information through it. That's worth confirming with whoever handles the office's privacy policies.

## License

The app is yours to share. `qrcode.js` is by Kazuhiko Arase, MIT license (notice kept at the top of the file).
