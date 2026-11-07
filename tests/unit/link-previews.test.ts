import { test } from "node:test";
import assert from "node:assert/strict";
import { isBot } from "../../src/lib/ad-rules";

// Chat apps fetch a link the moment it is pasted, to draw its preview. That is not a person opening it, so it must not
// count as a share, a referral click, a client-link view or a paid advert click.
test("link previews from chat apps and social networks are not counted as people", () => {
  for (const ua of [
    "WhatsApp/2.23.20.0 A",
    "WhatsApp/2.2412.54 i",
    "TelegramBot (like TwitterBot)",
    "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
    "Twitterbot/1.0",
    "LinkedInBot/1.0 (compatible; Mozilla/5.0; Apache-HttpClient +http://www.linkedin.com)",
    "Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)",
    "Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_11_1) AppleWebKit/601.2.4 (KHTML, like Gecko) Version/9.0.1 Safari/601.2.4 facebookexternalhit/1.1 Facebot Twitterbot/1.0",
    "Mozilla/5.0 (compatible; Embedly/0.2; +http://support.embed.ly/)",
    "Pinterestbot/1.0",
    "curl/8.5.0",
    "",
  ]) assert.equal(isBot(ua), true, ua);
  assert.equal(isBot(null), true);
});

test("real phones and browsers are counted", () => {
  for (const ua of [
    "Mozilla/5.0 (Linux; Android 14; SM-A546E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0",
    // WhatsApp's and Instagram's own in-app browsers are people opening the link.
    "Mozilla/5.0 (Linux; Android 13; TECNO KJ5) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/128.0.6613.146 Mobile Safari/537.36 Instagram 349.0.0.39.106 Android",
  ]) assert.equal(isBot(ua), false, ua);
});
