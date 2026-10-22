// Prints a new pair of push notification (VAPID) keys for the environment file.
import { generateVapidKeys } from "../src/lib/webpush";

const k = generateVapidKeys();
console.log(`VAPID_PUBLIC_KEY="${k.publicKey}"`);
console.log(`VAPID_PRIVATE_KEY="${k.privateKey}"`);
console.log("# Keep these for good: changing them means everyone has to turn notifications on again.");
