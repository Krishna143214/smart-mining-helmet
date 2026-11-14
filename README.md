# MineWatch – Smart Mining Helmet Dashboard

## Files
- `index.html` – dashboard markup and CDN dependencies
- `css/style.css` – all dashboard styling
- `js/app.js` – Firebase Authentication, Realtime Database listeners, map, charts, buzzer control, and CSV export

## Run locally
1. Keep the folder structure unchanged.
2. Open this folder in VS Code.
3. Use the Live Server extension and open `index.html`.
4. Sign in with the Email/Password Firebase Authentication account created in the Smart Mining Helmet project.

## Firebase configuration
The Firebase web configuration is in `js/app.js`. The dashboard uses the existing project ID `mining-helmet-13d03` and database URL. The API key is a Firebase web API key, not a password. Do not put the device account password in this file.

The page reads:
- `/MiningHelmet/live`
- `/MiningHelmet/history`
- `/MiningHelmet/commands/dashboardBuzzer`

The buzzer toggle writes a Boolean (`true` or `false`) to `/MiningHelmet/commands/dashboardBuzzer`. The ESP8266 must be running and polling this path.

## External libraries
Chart.js, Leaflet, OpenStreetMap tiles, Firebase Web SDK, and Google Fonts are loaded from their CDNs, so an internet connection is required.
