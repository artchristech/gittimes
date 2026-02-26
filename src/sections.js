const SECTIONS = {
  frontPage: {
    id: "frontPage",
    label: "Front Page",
    budget: { secondary: 7, quickHits: 10 },
    query: null,
  },
  ai: {
    id: "ai",
    label: "AI",
    budget: { secondary: 3, quickHits: 5 },
    query: {
      topics: [
        "ai", "machine-learning", "deep-learning", "llm", "gpt",
        "neural-network", "nlp", "computer-vision", "generative-ai", "transformers",
      ],
      languages: ["Jupyter Notebook"],
    },
  },
  robotics: {
    id: "robotics",
    label: "Robotics",
    budget: { secondary: 3, quickHits: 5 },
    query: {
      topics: [
        "robotics", "robot", "ros", "autonomous", "drone",
        "embedded", "iot", "arduino", "sensor",
      ],
      languages: [],
    },
  },
  cyber: {
    id: "cyber",
    label: "Cyber",
    budget: { secondary: 3, quickHits: 5 },
    query: {
      topics: [
        "security", "cybersecurity", "hacking", "pentest",
        "vulnerability", "exploit", "ctf", "malware", "encryption",
      ],
      languages: [],
    },
  },
  systems: {
    id: "systems",
    label: "Systems",
    budget: { secondary: 3, quickHits: 5 },
    query: {
      topics: [],
      languages: ["Rust", "Go", "C", "C++", "Zig"],
    },
  },
  diy: {
    id: "diy",
    label: "DIY",
    budget: { secondary: 3, quickHits: 5 },
    query: {
      topics: [
        "diy", "maker", "hardware", "3d-printing",
        "home-automation", "self-hosted", "homelab", "raspberry-pi",
      ],
      languages: [],
    },
  },
  xPulse: {
    id: "xPulse",
    label: "X Pulse",
    budget: { secondary: 0, quickHits: 0 },
    query: null,
    isXPulse: true,
  },
};

const SECTION_ORDER = ["frontPage", "ai", "robotics", "cyber", "systems", "diy", "xPulse"];

module.exports = { SECTIONS, SECTION_ORDER };
