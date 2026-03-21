/**
 * Newsletter sender — calls the Worker's /newsletter/send endpoint
 * after a new edition is published.
 */

async function sendNewsletter({ workerUrl, newsletterSecret, edition }) {
  const res = await fetch(workerUrl + "/newsletter/send", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + newsletterSecret,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(edition),
    signal: AbortSignal.timeout(15_000),
  });

  const data = await res.json();
  if (!data.ok) throw new Error(data.error || "Newsletter send failed");
  return data.sent;
}

module.exports = { sendNewsletter };
