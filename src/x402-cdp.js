/**
 * Coinbase CDP facilitator auth for the GitTimes x402 paywall.
 *
 * The CDP facilitator (https://api.cdp.coinbase.com/platform/v2/x402) settles
 * EIP-3009 payments fee-free on Base (it sponsors gas), but authenticates each
 * request with a short-lived JWT signed by your CDP API key — bound to the exact
 * HTTP method + host + path, expiring in ~120s, so it is minted per request.
 *
 * This is the ONLY piece that needs the `@coinbase/cdp-sdk` dependency, and it
 * is `require`d lazily so the rest of the API stays dependency-light: it loads
 * only when CDP keys are configured (X402_FACILITATOR_AUTH === "cdp"). Install
 * it on the box that runs the paid API:  npm install @coinbase/cdp-sdk
 *
 * Env (read in src/x402.js config()): CDP_API_KEY_ID, CDP_API_KEY_SECRET.
 */

let _generateJwt = null;

function loadGenerateJwt() {
  if (_generateJwt) return _generateJwt;
  // `generateJwt` is exported from the SDK's auth entrypoint; fall back to root.
  const tried = ["@coinbase/cdp-sdk/auth", "@coinbase/cdp-sdk"];
  for (const mod of tried) {
    try {
      const m = require(mod);
      if (typeof m.generateJwt === "function") {
        _generateJwt = m.generateJwt;
        return _generateJwt;
      }
    } catch {
      /* try next entrypoint */
    }
  }
  throw new Error(
    "CDP facilitator is configured (CDP_API_KEY_ID/CDP_API_KEY_SECRET set) but " +
      "@coinbase/cdp-sdk is not installed. Run: npm install @coinbase/cdp-sdk"
  );
}

/**
 * Build the `Authorization` header for one CDP facilitator call.
 * @param {object} c        config() output (needs cdpKeyId, cdpKeySecret, facilitatorUrl)
 * @param {string} endpoint "/verify" | "/settle"
 * @returns {Promise<{Authorization:string}>}
 */
async function cdpAuthHeader(c, endpoint) {
  const generateJwt = loadGenerateJwt();
  const u = new URL(`${c.facilitatorUrl}${endpoint}`);
  const jwt = await generateJwt({
    apiKeyId: c.cdpKeyId,
    apiKeySecret: c.cdpKeySecret,
    requestMethod: "POST",
    requestHost: u.host,
    requestPath: u.pathname,
    expiresIn: 120,
  });
  return { Authorization: `Bearer ${jwt}` };
}

module.exports = { cdpAuthHeader, loadGenerateJwt };
