export type PathwayNodeKind = "main" | "optional";

export type PathwayNodeDefinition = {
  key: string;
  code: string;
  title: string;
  shortTitle: string;
  aliases: string[];
  icon: string;
  kind: PathwayNodeKind;
  order: number;
  landKey: string;
  x: number;
  y: number;
  branchFrom?: string;
  requires?: string;
};

export type PathwayLandDefinition = {
  key: string;
  title: string;
  subtitle: string;
  asset: string;
  x: number;
  y: number;
  width: number;
  startOrder: number;
  endOrder: number;
};

export const PATHWAY_STAGE = {
  width: 2260,
  height: 780,
};

export const PATHWAY_LANDS: PathwayLandDefinition[] = [
  {
    key: "launch-meadow",
    title: "Launch Meadow",
    subtitle: "Start your coding adventure",
    asset: "/pathway/launch-meadow.png",
    x: 145,
    y: 78,
    width: 390,
    startOrder: 1,
    endOrder: 3,
  },
  {
    key: "creator-district",
    title: "Creator District",
    subtitle: "Build, design and create",
    asset: "/pathway/creator-district.png",
    x: 610,
    y: 54,
    width: 465,
    startOrder: 4,
    endOrder: 6,
  },
  {
    key: "python-core",
    title: "Python Core",
    subtitle: "Level up your coding",
    asset: "/pathway/python-core.png",
    x: 1165,
    y: 55,
    width: 430,
    startOrder: 7,
    endOrder: 9,
  },
  {
    key: "future-frontier",
    title: "Future Frontier",
    subtitle: "Become future ready",
    asset: "/pathway/future-frontier.png",
    x: 1690,
    y: 52,
    width: 430,
    startOrder: 10,
    endOrder: 12,
  },
];

export const MAIN_PATHWAY: PathwayNodeDefinition[] = [
  {
    key: "coding-knight",
    code: "CK",
    title: "Coding Knight",
    shortTitle: "Coding Knight",
    aliases: ["CK", "Coding Knight"],
    icon: "🛡️",
    kind: "main",
    order: 1,
    landKey: "launch-meadow",
    x: 150,
    y: 485,
  },
  {
    key: "digital-literacy",
    code: "DL",
    title: "Digital Literacy",
    shortTitle: "Digital Literacy",
    aliases: ["DL", "Digital Literacy"],
    icon: "💡",
    kind: "main",
    order: 2,
    landKey: "launch-meadow",
    x: 320,
    y: 435,
  },
  {
    key: "visual-programming",
    code: "VP",
    title: "Coding Knight",
    shortTitle: "Coding Knight",
    aliases: ["VP", "Coding Knight"],
    icon: "🧩",
    kind: "main",
    order: 3,
    landKey: "launch-meadow",
    x: 495,
    y: 455,
  },
  {
    key: "game-development",
    code: "GD",
    title: "Game Development",
    shortTitle: "Game Development",
    aliases: ["GD", "Game Development"],
    icon: "🎮",
    kind: "main",
    order: 4,
    landKey: "creator-district",
    x: 675,
    y: 515,
  },
  {
    key: "web-development",
    code: "WD",
    title: "Web Development",
    shortTitle: "Web Development",
    aliases: ["WD", "Web Development"],
    icon: "🌐",
    kind: "main",
    order: 5,
    landKey: "creator-district",
    x: 860,
    y: 465,
  },
  {
    key: "python-start-y1",
    code: "PTSY1",
    title: "Python Start – Year 1",
    shortTitle: "Python Start (Year 1)",
    aliases: [
      "PTSY1",
      "Python Start Year 1",
      "Python Start - Year 1",
      "Python Start – Year 1",
      "Python Start (Year 1)",
    ],
    icon: "🐍",
    kind: "main",
    order: 6,
    landKey: "creator-district",
    x: 1055,
    y: 500,
  },
  {
    key: "python-start-y2",
    code: "PTSY2",
    title: "Python Start – Year 2",
    shortTitle: "Python Start (Year 2)",
    aliases: [
      "PTSY2",
      "Python Start Year 2",
      "Python Start - Year 2",
      "Python Start – Year 2",
      "Python Start (Year 2)",
    ],
    icon: "🐍",
    kind: "main",
    order: 7,
    landKey: "python-core",
    x: 1240,
    y: 435,
  },
  {
    key: "python-pro-y1",
    code: "PTPY1",
    title: "Python Pro – Year 1",
    shortTitle: "Python Pro (Year 1)",
    aliases: [
      "PTPY1",
      "Python Pro Year 1",
      "Python Pro - Year 1",
      "Python Pro – Year 1",
      "Python Pro (Year 1)",
    ],
    icon: "🐍",
    kind: "main",
    order: 8,
    landKey: "python-core",
    x: 1425,
    y: 465,
  },
  {
    key: "python-pro-y2",
    code: "PTPY2",
    title: "Python Pro – Year 2",
    shortTitle: "Python Pro (Year 2)",
    aliases: [
      "PTPY2",
      "Python Pro Year 2",
      "Python Pro - Year 2",
      "Python Pro – Year 2",
      "Python Pro (Year 2)",
    ],
    icon: "🐍",
    kind: "main",
    order: 9,
    landKey: "python-core",
    x: 1610,
    y: 505,
  },
  {
    key: "frontend-development",
    code: "FED",
    title: "Front-End Development",
    shortTitle: "Front-End Development",
    aliases: [
      "FED",
      "Front-End Development",
      "Front End Development",
      "Frontend Development",
    ],
    icon: "⌨️",
    kind: "main",
    order: 10,
    landKey: "future-frontier",
    x: 1785,
    y: 455,
  },
  {
    key: "cs50x",
    code: "CS50X",
    title: "CS50x",
    shortTitle: "CS50x",
    aliases: ["CS50X", "CS-50X", "CS50x"],
    icon: "CS50x",
    kind: "main",
    order: 11,
    landKey: "future-frontier",
    x: 1960,
    y: 475,
  },
  {
    key: "cs50p",
    code: "CS50P",
    title: "CS50P",
    shortTitle: "CS50P",
    aliases: ["CS50P", "CS-50P", "CS50p"],
    icon: "CS50P",
    kind: "main",
    order: 12,
    landKey: "future-frontier",
    x: 2125,
    y: 500,
  },
];

export const OPTIONAL_PATHWAY: PathwayNodeDefinition[] = [
  {
    key: "digital-design",
    code: "DD",
    title: "Digital Design",
    shortTitle: "Digital Design",
    aliases: ["DD", "Digital Design", "Graphic Design"],
    icon: "🎨",
    kind: "optional",
    order: 1,
    landKey: "creator-district",
    x: 840,
    y: 700,
    branchFrom: "web-development",
  },
  {
    key: "digital-design-advanced",
    code: "DDA",
    title: "Digital Design Advanced",
    shortTitle: "Digital Design Advanced",
    aliases: [
      "DDA",
      "Digital Design Advanced",
      "Graphic Design Advanced",
      "Graphic Design (Advanced)",
    ],
    icon: "✨",
    kind: "optional",
    order: 2,
    landKey: "creator-district",
    x: 1060,
    y: 720,
    branchFrom: "digital-design",
    requires: "digital-design",
  },
  {
    key: "game-development-advanced",
    code: "GDA",
    title: "Game Development Advanced",
    shortTitle: "Game Development Advanced",
    aliases: [
      "GDA",
      "AGD",
      "Game Development Advanced",
      "Advanced Game Development",
    ],
    icon: "🎮",
    kind: "optional",
    order: 3,
    landKey: "creator-district",
    x: 620,
    y: 700,
    branchFrom: "game-development",
  },
  {
    key: "unity-game-design",
    code: "UGD",
    title: "Unity Game Design",
    shortTitle: "Unity Game Design",
    aliases: ["UGD", "Unity Game Design", "Unity"],
    icon: "◈",
    kind: "optional",
    order: 4,
    landKey: "python-core",
    x: 1325,
    y: 710,
    branchFrom: "python-start-y2",
  },
];

export const ALL_PATHWAY_NODES = [...MAIN_PATHWAY, ...OPTIONAL_PATHWAY];
