import { runBrowserJourney } from "../src/core/qa/browser";
const journey = (process.argv[2] ?? "home_to_cart") as "home_to_cart" | "mobile_home" | "checkout_open";
runBrowserJourney(journey, { baseUrl: process.argv[3] }).then((r) => { console.log(JSON.stringify(r, null, 2)); process.exit(0); }).catch((e) => { console.error(e); process.exit(1); });
