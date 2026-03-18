require("dotenv").config();

const { runPipeline } = require("./src/pipeline");
const { render } = require("./src/render");
const { closeDb } = require("./src/db");

async function main() {
  const githubToken = process.env.GITHUB_TOKEN;
  const xaiKey = process.env.XAI_API_KEY;

  if (!githubToken) {
    console.error("Missing GITHUB_TOKEN in .env");
    process.exit(1);
  }
  if (!xaiKey) {
    console.error("Missing XAI_API_KEY in .env");
    process.exit(1);
  }

  console.log("=== The Git Times Generator ===\n");

  const { content } = await runPipeline(githubToken, xaiKey);

  // Render to static HTML
  await render(content);

  console.log("\nDone! Open the file in your browser to view the newspaper.");
  closeDb();
}

main().catch((err) => {
  console.error("Generation failed:", err.message);
  closeDb();
  process.exit(1);
});
