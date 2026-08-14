/**
 * Inline SVG pipeline diagram for the "How it works" section:
 *
 *   Photo / Location -> Vision (multimodal ID) -> Finance resolver -> Answer + Sources
 *
 * Pure SVG + CSS (`.diagram__dot` keyframes live in globals.css) — a small
 * flow-dot travels each connector on a loop to suggest a live pipeline.
 * No JS, no external assets. Reduced-motion users get a static diagram
 * (see the global `prefers-reduced-motion` rule).
 */

type Node = {
  step: string;
  title: string;
  lines: string[];
  variant: "jade" | "blue";
  icon: "pin" | "eye" | "bars" | "check";
};

const nodes: Node[] = [
  {
    step: "01",
    title: "Identify",
    lines: ["Camera or map → public", "ticker or private comparable"],
    variant: "jade",
    icon: "pin",
  },
  {
    step: "02",
    title: "Local research",
    lines: ["Company from the image,", "or the local economy"],
    variant: "blue",
    icon: "eye",
  },
  {
    step: "03",
    title: "Finance agent",
    lines: ["Briefs, memos, saved chats", "on names you care about"],
    variant: "jade",
    icon: "bars",
  },
  {
    step: "04",
    title: "Analytics",
    lines: ["Trends and levels so you", "can think about a position"],
    variant: "blue",
    icon: "check",
  },
];

// Layout constants (SVG user units).
const NODE_W = 220;
const NODE_H = 220;
const GAP = 80;
const MARGIN = 20;
const TOP = 40;
const CY = TOP + NODE_H / 2; // 150

function centerX(i: number) {
  return MARGIN + i * (NODE_W + GAP) + NODE_W / 2;
}
function leftX(i: number) {
  return MARGIN + i * (NODE_W + GAP);
}

function Icon({ kind }: { kind: Node["icon"] }) {
  const common = {
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.7,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  switch (kind) {
    case "pin":
      return (
        <g {...common}>
          <path d="M12 21s7-7.6 7-12.6A7 7 0 0 0 5 8.4C5 13.4 12 21 12 21Z" />
          <circle cx="12" cy="8.4" r="2.5" />
        </g>
      );
    case "eye":
      return (
        <g {...common}>
          <path d="M2.2 12S6 5.3 12 5.3 21.8 12 21.8 12 18 18.7 12 18.7 2.2 12 2.2 12Z" />
          <circle cx="12" cy="12" r="3.1" />
        </g>
      );
    case "bars":
      return (
        <g {...common}>
          <path d="M3 20h18" />
          <path d="M6.5 20v-6M12 20V7.5M17.5 20v-9.5" />
        </g>
      );
    case "check":
      return (
        <g {...common}>
          <circle cx="12" cy="12" r="8.6" />
          <path d="M8.1 12.3l2.5 2.5 5.3-5.6" />
        </g>
      );
  }
}

export function HowItWorksDiagram() {
  const width = MARGIN * 2 + nodes.length * NODE_W + (nodes.length - 1) * GAP;
  const height = TOP * 2 + NODE_H;

  return (
    <div className="diagram">
      <svg
        className="diagram__svg"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-labelledby="diagram-title diagram-desc"
      >
        <title id="diagram-title">How Mapvest turns the world into a researched position</title>
        <desc id="diagram-desc">
          A four-step product loop. Step one, identify: camera or map matches a place or photo to a
          public ticker or a private-company comparable. Step two, local research: agentic research
          on the company or the local economy. Step three, finance agent: briefs, memos, and saved
          chats. Step four, analytics: charts for trends and levels so you can think about a
          position.
        </desc>

        <defs>
          <marker
            id="diagram-arrow"
            viewBox="0 0 8 8"
            refX="6"
            refY="4"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path d="M0 0 L8 4 L0 8 Z" className="diagram__arrowhead" />
          </marker>
        </defs>

        {/* connectors, drawn first so nodes sit on top */}
        {nodes.slice(0, -1).map((_, i) => {
          const x1 = leftX(i) + NODE_W;
          const x2 = leftX(i + 1);
          return (
            <g key={`conn-${i}`}>
              <line
                x1={x1}
                y1={CY}
                x2={x2 - 10}
                y2={CY}
                className="diagram__line"
                markerEnd="url(#diagram-arrow)"
              />
              <g transform={`translate(${x1} ${CY})`}>
                <circle
                  r="4"
                  className="diagram__dot"
                  style={{ ["--flow-delay" as string]: `${i * 0.5}s` }}
                />
              </g>
            </g>
          );
        })}

        {nodes.map((n, i) => {
          const x = leftX(i);
          const cx = centerX(i);
          return (
            <g key={n.step} className={`diagram__node diagram__node--${n.variant}`}>
              <rect
                x={x}
                y={TOP}
                width={NODE_W}
                height={NODE_H}
                rx="20"
                className="diagram__card"
              />
              <text x={x + 22} y={TOP + 30} className="diagram__step">
                {n.step}
              </text>
              <g
                className="diagram__icon"
                transform={`translate(${cx - 16} ${TOP + 26}) scale(1.35)`}
              >
                <Icon kind={n.icon} />
              </g>
              <text x={cx} y={TOP + 108} textAnchor="middle" className="diagram__title">
                {n.title}
              </text>
              <line
                x1={cx - 34}
                y1={TOP + 122}
                x2={cx + 34}
                y2={TOP + 122}
                className="diagram__rule"
              />
              {n.lines.map((line, li) => (
                <text
                  key={li}
                  x={cx}
                  y={TOP + 146 + li * 20}
                  textAnchor="middle"
                  className="diagram__sub"
                >
                  {line}
                </text>
              ))}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
